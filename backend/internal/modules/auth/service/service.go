// Package service implements authentication, sessions, password recovery and
// the admin seed (SPEC-003).
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/logger"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

// Users is the part of the user module this service depends on.
type Users interface {
	FindByID(ctx context.Context, id uuid.UUID) (userdomain.User, error)
	FindByIdentifier(ctx context.Context, id userdomain.Identifier) (userdomain.User, error)
	FindByEmail(ctx context.Context, email string) (userdomain.User, error)
	Create(ctx context.Context, u *userdomain.User) error
	SetPassword(ctx context.Context, id uuid.UUID, hash string, mustChange bool) error
}

// Store persists sessions and reset tokens. ErrNotFound must be returned for
// missing records.
type Store interface {
	CreateSession(ctx context.Context, s *domain.Session) error
	FindSessionByTokenHash(ctx context.Context, hash string) (domain.Session, error)
	TouchSession(ctx context.Context, id uuid.UUID, at time.Time) error
	EndSession(ctx context.Context, id uuid.UUID, status domain.SessionStatus, at time.Time) error
	EndUserSessions(ctx context.Context, userID, except uuid.UUID, status domain.SessionStatus, at time.Time) (int64, error)
	CreateResetToken(ctx context.Context, t *domain.PasswordResetToken) error
	FindResetTokenByHash(ctx context.Context, hash string) (domain.PasswordResetToken, error)
	MarkResetTokenUsed(ctx context.Context, id uuid.UUID, at time.Time) error
}

// Auditor records security audit entries.
type Auditor interface {
	Record(ctx context.Context, e AuditEntry)
}

// Mailer enqueues e-mails for asynchronous delivery.
type Mailer interface {
	Enqueue(msg mailer.Message) error
}

// TxRunner runs a function inside a database transaction.
type TxRunner interface {
	WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error
}

// Hasher hashes and verifies passwords.
type Hasher interface {
	Hash(password string) (string, error)
	Verify(password, encoded string) bool
}

// Deps groups the service dependencies.
type Deps struct {
	Users     Users
	Store     Store
	NotFound  error
	Auditor   Auditor
	Mailer    Mailer
	Tx        TxRunner
	Hasher    Hasher
	PublicURL string
	Log       *zap.Logger
	Now       func() time.Time
}

// Service is the auth use-case layer.
type Service struct {
	Deps
	dummyHash string
}

// New creates the service. It precomputes the hash used to equalize timing
// when the user does not exist (RN-04).
func New(d Deps) (*Service, error) {
	if d.Now == nil {
		d.Now = time.Now
	}
	dummy, err := d.Hasher.Hash("timing-equalization-placeholder")
	if err != nil {
		return nil, fmt.Errorf("compute dummy hash: %w", err)
	}
	return &Service{Deps: d, dummyHash: dummy}, nil
}

// LoginResult is a successful login.
type LoginResult struct {
	Token   string
	Session domain.Session
	User    userdomain.User
}

// Login authenticates by e-mail or academic id and opens a session. Every
// failure returns domain.ErrInvalidCredentials; the reason goes to the audit.
func (s *Service) Login(ctx context.Context, id userdomain.Identifier, rawIdentifier, password string, req domain.RequestInfo) (LoginResult, error) {
	u, err := s.Users.FindByIdentifier(ctx, id)
	if errors.Is(err, userdomain.ErrNotFound) {
		s.Hasher.Verify(password, s.dummyHash)
		s.audit(ctx, nil, domain.EventLoginFailedUnknownUser, rawIdentifier, req, nil)
		return LoginResult{}, domain.ErrInvalidCredentials
	}
	if err != nil {
		return LoginResult{}, err
	}

	hash := s.dummyHash
	if u.HasPassword() {
		hash = *u.PasswordHash
	}
	passwordOK := s.Hasher.Verify(password, hash) && u.HasPassword()

	switch {
	case !u.HasPassword() || u.Status != userdomain.StatusActive:
		s.audit(ctx, &u.ID, domain.EventLoginFailedAccountNotActive, rawIdentifier, req,
			map[string]any{"status": u.Status, "has_password": u.HasPassword()})
		return LoginResult{}, domain.ErrInvalidCredentials
	case !passwordOK:
		s.audit(ctx, &u.ID, domain.EventLoginFailedWrongPassword, rawIdentifier, req, nil)
		return LoginResult{}, domain.ErrInvalidCredentials
	}

	raw, tokenHash, err := newToken()
	if err != nil {
		return LoginResult{}, err
	}
	sessionID, err := uuid.NewV7()
	if err != nil {
		return LoginResult{}, err
	}
	now := s.Now().UTC()
	session := domain.Session{
		ID:             sessionID,
		UserID:         u.ID,
		TokenHash:      tokenHash,
		IPAddress:      req.IP,
		UserAgent:      req.UserAgent,
		Status:         domain.SessionActive,
		LastActivityAt: now,
		ExpiresAt:      now.Add(domain.AbsoluteTimeout),
		CreatedAt:      now,
	}
	if err := s.Store.CreateSession(ctx, &session); err != nil {
		return LoginResult{}, fmt.Errorf("create session: %w", err)
	}
	s.audit(ctx, &u.ID, domain.EventLoginSucceeded, rawIdentifier, req, map[string]any{"session_id": session.ID})
	return LoginResult{Token: raw, Session: session, User: u}, nil
}

// RecordRateLimited audits a login blocked by the rate limiter.
func (s *Service) RecordRateLimited(ctx context.Context, rawIdentifier string, req domain.RequestInfo) {
	s.audit(ctx, nil, domain.EventLoginBlockedRateLimit, rawIdentifier, req, nil)
}

// Authenticate implements authn.Validator (RN-07): it resolves the token,
// expires idle or too old sessions and refreshes the activity timestamp.
func (s *Service) Authenticate(ctx context.Context, token string) (authn.Principal, error) {
	session, err := s.Store.FindSessionByTokenHash(ctx, hashToken(token))
	if errors.Is(err, s.NotFound) {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	if err != nil {
		return authn.Principal{}, err
	}
	if session.Status != domain.SessionActive {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}

	now := s.Now().UTC()
	switch {
	case session.AbsoluteExpired(now):
		return authn.Principal{}, s.expire(ctx, session, domain.SessionExpiredAbsolute, domain.EventSessionExpiredAbsolute, authn.ReasonAbsolute, now)
	case session.IdleExpired(now):
		return authn.Principal{}, s.expire(ctx, session, domain.SessionExpiredIdle, domain.EventSessionExpiredIdle, authn.ReasonIdle, now)
	}

	u, err := s.Users.FindByID(ctx, session.UserID)
	if errors.Is(err, userdomain.ErrNotFound) || (err == nil && u.Status != userdomain.StatusActive) {
		return authn.Principal{}, authn.ErrNotAuthenticated
	}
	if err != nil {
		return authn.Principal{}, err
	}
	if err := s.Store.TouchSession(ctx, session.ID, now); err != nil {
		return authn.Principal{}, fmt.Errorf("touch session: %w", err)
	}
	return authn.Principal{
		UserID:             u.ID,
		SessionID:          session.ID,
		Role:               string(u.Role),
		MustChangePassword: u.MustChangePassword,
		SessionCreatedAt:   session.CreatedAt,
		SessionExpiresAt:   session.ExpiresAt,
	}, nil
}

func (s *Service) expire(ctx context.Context, session domain.Session, status domain.SessionStatus, event domain.EventType, reason string, now time.Time) error {
	if err := s.Store.EndSession(ctx, session.ID, status, now); err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	s.audit(ctx, &session.UserID, event, "", domain.RequestInfo{IP: session.IPAddress, UserAgent: session.UserAgent},
		map[string]any{"session_id": session.ID})
	return &authn.SessionExpiredError{Reason: reason}
}

// Logout ends the current session.
func (s *Service) Logout(ctx context.Context, p authn.Principal, req domain.RequestInfo) error {
	if err := s.Store.EndSession(ctx, p.SessionID, domain.SessionRevokedLogout, s.Now().UTC()); err != nil {
		return fmt.Errorf("end session: %w", err)
	}
	s.audit(ctx, &p.UserID, domain.EventLogout, "", req, map[string]any{"session_id": p.SessionID})
	return nil
}

// Me returns the user of the principal.
func (s *Service) Me(ctx context.Context, p authn.Principal) (userdomain.User, error) {
	return s.Users.FindByID(ctx, p.UserID)
}

// ForgotPassword creates a reset token and enqueues the e-mail when the
// identifier matches an active account. The caller always answers 202, so
// the result never reveals whether the account exists (RN-10).
func (s *Service) ForgotPassword(ctx context.Context, id userdomain.Identifier, rawIdentifier string, req domain.RequestInfo) error {
	u, err := s.Users.FindByIdentifier(ctx, id)
	if errors.Is(err, userdomain.ErrNotFound) {
		s.audit(ctx, nil, domain.EventPasswordResetRequested, rawIdentifier, req, map[string]any{"matched": false})
		return nil
	}
	if err != nil {
		return err
	}
	if u.Status != userdomain.StatusActive {
		s.audit(ctx, &u.ID, domain.EventPasswordResetRequested, rawIdentifier, req,
			map[string]any{"matched": true, "sent": false, "status": u.Status})
		return nil
	}

	raw, tokenHash, err := newToken()
	if err != nil {
		return err
	}
	tokenID, err := uuid.NewV7()
	if err != nil {
		return err
	}
	now := s.Now().UTC()
	if err := s.Store.CreateResetToken(ctx, &domain.PasswordResetToken{
		ID: tokenID, UserID: u.ID, TokenHash: tokenHash, ExpiresAt: now.Add(domain.ResetTokenTTL), CreatedAt: now,
	}); err != nil {
		return fmt.Errorf("create reset token: %w", err)
	}

	sent := true
	if err := s.Mailer.Enqueue(resetPasswordEmail(u.Email, s.PublicURL, raw)); err != nil {
		sent = false
		logger.FromContext(ctx, s.Log).Error("could not enqueue password reset e-mail", zap.Error(err))
	}
	s.audit(ctx, &u.ID, domain.EventPasswordResetRequested, rawIdentifier, req,
		map[string]any{"matched": true, "sent": sent})
	return nil
}

// ResetPassword consumes a reset token and sets the new password; in the same
// transaction it clears the must-change flag and revokes every session
// (RN-11). It returns the number of revoked sessions.
func (s *Service) ResetPassword(ctx context.Context, token, newPassword string, req domain.RequestInfo) (int64, error) {
	t, err := s.Store.FindResetTokenByHash(ctx, hashToken(token))
	if errors.Is(err, s.NotFound) {
		return 0, domain.ErrResetTokenInvalid
	}
	if err != nil {
		return 0, err
	}
	now := s.Now().UTC()
	if !t.Usable(now) {
		return 0, domain.ErrResetTokenInvalid
	}
	u, err := s.Users.FindByID(ctx, t.UserID)
	if err != nil {
		return 0, err
	}
	if err := domain.CheckPassword(newPassword, u.Email, deref(u.AcademicID)); err != nil {
		return 0, err
	}
	hash, err := s.Hasher.Hash(newPassword)
	if err != nil {
		return 0, err
	}

	var revoked int64
	err = s.Tx.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := s.Store.MarkResetTokenUsed(ctx, t.ID, now); err != nil {
			if errors.Is(err, s.NotFound) {
				return domain.ErrResetTokenInvalid
			}
			return err
		}
		if err := s.Users.SetPassword(ctx, u.ID, hash, false); err != nil {
			return err
		}
		revoked, err = s.Store.EndUserSessions(ctx, u.ID, uuid.Nil, domain.SessionRevokedPasswordReset, now)
		return err
	})
	if err != nil {
		return 0, err
	}
	s.audit(ctx, &u.ID, domain.EventPasswordResetCompleted, "", req, map[string]any{"sessions_revoked": revoked})
	return revoked, nil
}

// ChangePassword replaces the password of the principal, clears the
// must-change flag and revokes the other sessions.
func (s *Service) ChangePassword(ctx context.Context, p authn.Principal, current, newPassword string, req domain.RequestInfo) error {
	u, err := s.Users.FindByID(ctx, p.UserID)
	if err != nil {
		return err
	}
	if !u.HasPassword() || !s.Hasher.Verify(current, *u.PasswordHash) {
		return domain.ErrInvalidCredentials
	}
	if err := domain.CheckPassword(newPassword, u.Email, deref(u.AcademicID)); err != nil {
		return err
	}
	if current == newPassword {
		return &domain.PolicyError{Violations: []string{domain.ViolationSameAsCurrent}}
	}
	hash, err := s.Hasher.Hash(newPassword)
	if err != nil {
		return err
	}
	now := s.Now().UTC()
	var revoked int64
	err = s.Tx.WithinTransaction(ctx, func(ctx context.Context) error {
		if err := s.Users.SetPassword(ctx, u.ID, hash, false); err != nil {
			return err
		}
		revoked, err = s.Store.EndUserSessions(ctx, u.ID, p.SessionID, domain.SessionRevokedPasswordReset, now)
		return err
	})
	if err != nil {
		return err
	}
	s.audit(ctx, &u.ID, domain.EventPasswordChanged, "", req, map[string]any{"sessions_revoked": revoked})
	return nil
}

// RevokeOtherSessions ends every active session of the user except keep
// (RN-12). It has no endpoint; a future spec triggers it when an attempt
// starts.
func (s *Service) RevokeOtherSessions(ctx context.Context, userID, keep uuid.UUID, req domain.RequestInfo) (int64, error) {
	n, err := s.Store.EndUserSessions(ctx, userID, keep, domain.SessionRevokedConcurrency, s.Now().UTC())
	if err != nil {
		return 0, err
	}
	s.audit(ctx, &userID, domain.EventSessionRevokedConcurrency, "", req,
		map[string]any{"kept_session_id": keep, "sessions_revoked": n})
	return n, nil
}

// SeedAdmin creates the default administrator when it does not exist (RN-03).
// An existing account is never modified.
func (s *Service) SeedAdmin(ctx context.Context, email, initialPassword string) (bool, error) {
	_, err := s.Users.FindByEmail(ctx, email)
	if err == nil {
		return false, nil
	}
	if !errors.Is(err, userdomain.ErrNotFound) {
		return false, err
	}
	if err := domain.CheckPassword(initialPassword, email, ""); err != nil {
		return false, fmt.Errorf("ADMIN_INITIAL_PASSWORD: %w", err)
	}
	hash, err := s.Hasher.Hash(initialPassword)
	if err != nil {
		return false, err
	}
	u := userdomain.User{
		Email:              email,
		PasswordHash:       &hash,
		Role:               userdomain.RoleAdmin,
		Status:             userdomain.StatusActive,
		MustChangePassword: true,
	}
	if err := s.Users.Create(ctx, &u); err != nil {
		return false, fmt.Errorf("create admin: %w", err)
	}
	s.audit(ctx, &u.ID, domain.EventAdminSeeded, email, domain.RequestInfo{IP: "system", UserAgent: "system"}, nil)
	return true, nil
}

func (s *Service) audit(ctx context.Context, userID *uuid.UUID, event domain.EventType, identifier string, req domain.RequestInfo, meta map[string]any) {
	s.Auditor.Record(ctx, AuditEntry{UserID: userID, Event: event, Identifier: identifier, Request: req, Metadata: meta})
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
