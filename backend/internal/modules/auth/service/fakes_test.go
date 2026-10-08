package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/mailer"
)

var errNotFound = errors.New("not found")

// fakeUsers is an in-memory Users port.
type fakeUsers struct {
	byID       map[uuid.UUID]userdomain.User
	findErr    error
	setPassErr error
}

func newFakeUsers() *fakeUsers { return &fakeUsers{byID: map[uuid.UUID]userdomain.User{}} }

func (f *fakeUsers) add(u userdomain.User) userdomain.User {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	if u.Status == "" {
		u.Status = userdomain.StatusActive
	}
	f.byID[u.ID] = u
	return u
}

func (f *fakeUsers) FindByID(_ context.Context, id uuid.UUID) (userdomain.User, error) {
	if f.findErr != nil {
		return userdomain.User{}, f.findErr
	}
	u, ok := f.byID[id]
	if !ok {
		return userdomain.User{}, userdomain.ErrNotFound
	}
	return u, nil
}

func (f *fakeUsers) FindByIdentifier(_ context.Context, id userdomain.Identifier) (userdomain.User, error) {
	if f.findErr != nil {
		return userdomain.User{}, f.findErr
	}
	for _, u := range f.byID {
		if (id.IsEmail() && u.Email == id.Email) || (!id.IsEmail() && u.AcademicID != nil && *u.AcademicID == id.AcademicID) {
			return u, nil
		}
	}
	return userdomain.User{}, userdomain.ErrNotFound
}

func (f *fakeUsers) FindByEmail(ctx context.Context, email string) (userdomain.User, error) {
	return f.FindByIdentifier(ctx, userdomain.Identifier{Email: email})
}

func (f *fakeUsers) Create(_ context.Context, u *userdomain.User) error {
	*u = f.add(*u)
	return nil
}

func (f *fakeUsers) SetPassword(_ context.Context, id uuid.UUID, hash string, mustChange bool) error {
	if f.setPassErr != nil {
		return f.setPassErr
	}
	u := f.byID[id]
	u.PasswordHash = &hash
	u.MustChangePassword = mustChange
	f.byID[id] = u
	return nil
}

// fakeStore is an in-memory Store port.
type fakeStore struct {
	sessions  map[uuid.UUID]domain.Session
	tokens    map[uuid.UUID]domain.PasswordResetToken
	failWrite error
	markErr   error
}

func newFakeStore() *fakeStore {
	return &fakeStore{sessions: map[uuid.UUID]domain.Session{}, tokens: map[uuid.UUID]domain.PasswordResetToken{}}
}

func (f *fakeStore) CreateSession(_ context.Context, s *domain.Session) error {
	if f.failWrite != nil {
		return f.failWrite
	}
	f.sessions[s.ID] = *s
	return nil
}

func (f *fakeStore) FindSessionByTokenHash(_ context.Context, hash string) (domain.Session, error) {
	for _, s := range f.sessions {
		if s.TokenHash == hash {
			return s, nil
		}
	}
	return domain.Session{}, errNotFound
}

func (f *fakeStore) TouchSession(_ context.Context, id uuid.UUID, at time.Time) error {
	if f.failWrite != nil {
		return f.failWrite
	}
	s := f.sessions[id]
	s.LastActivityAt = at
	f.sessions[id] = s
	return nil
}

func (f *fakeStore) EndSession(_ context.Context, id uuid.UUID, status domain.SessionStatus, at time.Time) error {
	if f.failWrite != nil {
		return f.failWrite
	}
	s := f.sessions[id]
	if s.Status == domain.SessionActive {
		s.Status = status
		s.RevokedAt = &at
		f.sessions[id] = s
	}
	return nil
}

func (f *fakeStore) EndUserSessions(_ context.Context, userID, except uuid.UUID, status domain.SessionStatus, at time.Time) (int64, error) {
	if f.failWrite != nil {
		return 0, f.failWrite
	}
	var n int64
	for id, s := range f.sessions {
		if s.UserID == userID && s.Status == domain.SessionActive && id != except {
			s.Status = status
			s.RevokedAt = &at
			f.sessions[id] = s
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) CreateResetToken(_ context.Context, t *domain.PasswordResetToken) error {
	if f.failWrite != nil {
		return f.failWrite
	}
	f.tokens[t.ID] = *t
	return nil
}

func (f *fakeStore) FindResetTokenByHash(_ context.Context, hash string) (domain.PasswordResetToken, error) {
	for _, t := range f.tokens {
		if t.TokenHash == hash {
			return t, nil
		}
	}
	return domain.PasswordResetToken{}, errNotFound
}

func (f *fakeStore) MarkResetTokenUsed(_ context.Context, id uuid.UUID, at time.Time) error {
	if f.markErr != nil {
		return f.markErr
	}
	t := f.tokens[id]
	t.UsedAt = &at
	f.tokens[id] = t
	return nil
}

// fakeAuditor records entries in memory.
type fakeAuditor struct {
	mu      sync.Mutex
	entries []AuditEntry
}

func (f *fakeAuditor) Record(_ context.Context, e AuditEntry) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries = append(f.entries, e)
}

func (f *fakeAuditor) events() []domain.EventType {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]domain.EventType, len(f.entries))
	for i, e := range f.entries {
		out[i] = e.Event
	}
	return out
}

// fakeMailer collects enqueued messages.
type fakeMailer struct {
	sent []mailer.Message
	err  error
}

func (f *fakeMailer) Enqueue(msg mailer.Message) error {
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, msg)
	return nil
}

// fakeTx runs the function directly, like a transaction that always commits
// unless the function fails; it records how many transactions ran.
type fakeTx struct{ runs int }

func (f *fakeTx) WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error {
	f.runs++
	return fn(ctx)
}

// fakeHasher is a fast, deterministic Hasher; Argon2Hasher is tested apart.
type fakeHasher struct{ verifyCalls int }

func (f *fakeHasher) Hash(password string) (string, error) { return "hashed:" + password, nil }

func (f *fakeHasher) Verify(password, encoded string) bool {
	f.verifyCalls++
	return encoded == "hashed:"+password
}

type harness struct {
	svc     *Service
	users   *fakeUsers
	store   *fakeStore
	auditor *fakeAuditor
	mail    *fakeMailer
	tx      *fakeTx
	hasher  *fakeHasher
	now     time.Time
}

func newHarness() *harness {
	h := &harness{
		users:   newFakeUsers(),
		store:   newFakeStore(),
		auditor: &fakeAuditor{},
		mail:    &fakeMailer{},
		tx:      &fakeTx{},
		hasher:  &fakeHasher{},
		now:     time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC),
	}
	svc, err := New(Deps{
		Users: h.users, Store: h.store, NotFound: errNotFound, Auditor: h.auditor, Mailer: h.mail,
		Tx: h.tx, Hasher: h.hasher, PublicURL: "http://192.168.3.111:3010", Log: zap.NewNop(),
		Now: func() time.Time { return h.now },
	})
	if err != nil {
		panic(err)
	}
	h.svc = svc
	return h
}

func (h *harness) student(password string) userdomain.User {
	ra := "1234567"
	hash := "hashed:" + password
	return h.users.add(userdomain.User{
		Email: "student@example.com", AcademicID: &ra, PasswordHash: &hash, Role: userdomain.RoleStudent,
	})
}
