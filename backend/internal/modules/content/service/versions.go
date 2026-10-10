package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Version errors (SPEC-021).
var (
	// ErrNoChanges means the draft is the same as the latest version.
	ErrNoChanges       = errors.New("the draft has no changes since the latest version")
	ErrVersionNotFound = errors.New("version not found")
	ErrNoteTooLong     = errors.New("the note of a version has at most 200 characters")
)

// VersionSummary is one row of the list of versions.
type VersionSummary struct {
	Number     int       `json:"number"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"createdAt"`
	CreatedBy  string    `json:"createdBy"`
	BlockCount int       `json:"blockCount"`
	Current    bool      `json:"current"`
}

// VersionStore is the persistence of the versions.
type VersionStore interface {
	ModuleTeacher(ctx context.Context, moduleID uuid.UUID) (uuid.UUID, error)
	ListVersions(ctx context.Context, moduleID uuid.UUID) ([]VersionSummary, bool, error)
	PublishVersion(ctx context.Context, moduleID, by uuid.UUID, note string) (domain.ModuleVersion, error)
	RestoreVersion(ctx context.Context, moduleID uuid.UUID, number int, now time.Time) error
	ListBlocks(ctx context.Context, moduleID uuid.UUID) ([]domain.ContentBlock, error)
	ModuleSetup(ctx context.Context, moduleID uuid.UUID) (json.RawMessage, error)
}

// Versions publishes, lists and restores the versions of a module (SPEC-021 RN-05, RN-07).
type Versions struct {
	store VersionStore
	log   *zap.Logger
	now   func() time.Time
}

// NewVersions creates the service.
func NewVersions(store VersionStore, log *zap.Logger) *Versions {
	return &Versions{store: store, log: log.Named("versions"), now: microNow}
}

// authorize lets ADMIN and the TEACHER who owns the module through.
func (s *Versions) authorize(ctx context.Context, moduleID uuid.UUID, who Actor) error {
	owner, err := s.store.ModuleTeacher(ctx, moduleID)
	if errors.Is(err, ErrNotFound) {
		return ErrModuleNotFound
	}
	if err != nil {
		return err
	}
	if who.Role == "ADMIN" || (who.Role == "TEACHER" && owner == who.UserID) {
		return nil
	}
	return ErrForbidden
}

// List returns the versions, the newest first, with the current one marked, and whether the draft has unpublished changes.
func (s *Versions) List(ctx context.Context, who Actor, moduleID uuid.UUID) ([]VersionSummary, bool, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return nil, false, err
	}
	list, changed, err := s.store.ListVersions(ctx, moduleID)
	if len(list) > 0 {
		list[0].Current = true
	}
	return list, changed, err
}

// Publish stores the draft as the next version.
func (s *Versions) Publish(ctx context.Context, who Actor, moduleID uuid.UUID, note string) (domain.ModuleVersion, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return domain.ModuleVersion{}, err
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > domain.MaxVersionNote {
		return domain.ModuleVersion{}, ErrNoteTooLong
	}
	v, err := s.store.PublishVersion(ctx, moduleID, who.UserID, note)
	if err == nil {
		s.log.Info("module published", zap.String("userId", who.UserID.String()), zap.String("moduleId", moduleID.String()), zap.Int("version", v.Number))
	}
	return v, err
}

// Restore copies a version into the draft; it does not publish.
func (s *Versions) Restore(ctx context.Context, who Actor, moduleID uuid.UUID, number int) ([]domain.ContentBlock, json.RawMessage, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return nil, nil, err
	}
	if err := s.store.RestoreVersion(ctx, moduleID, number, s.now()); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil, ErrVersionNotFound
		}
		return nil, nil, err
	}
	s.log.Info("module version restored", zap.String("userId", who.UserID.String()), zap.String("moduleId", moduleID.String()), zap.Int("version", number))
	blocks, err := s.store.ListBlocks(ctx, moduleID)
	if err != nil {
		return nil, nil, err
	}
	setup, err := s.store.ModuleSetup(ctx, moduleID)
	return blocks, setup, err
}
