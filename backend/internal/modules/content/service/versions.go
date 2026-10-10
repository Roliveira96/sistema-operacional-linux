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
	// PublishGated stores the draft as the next version, but only when gate accepts the state of the tests read in the
	// same transaction as the draft (RN-13); the error of gate is returned and nothing is stored.
	PublishGated(ctx context.Context, moduleID, by uuid.UUID, note string, gate func(domain.TestState) error) (domain.ModuleVersion, error)
	// TestState reads the latest results and the hashes of the current state of the module.
	TestState(ctx context.Context, moduleID uuid.UUID) (domain.TestState, error)
	// SaveTestResult stores a result with the hash of what the kind covers at this moment.
	SaveTestResult(ctx context.Context, r domain.ModuleTestResult) (domain.ModuleTestResult, error)
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

// VersionList is the list of versions with what the screen needs to enable publishing (SPEC-024 5).
type VersionList struct {
	Versions              []VersionSummary
	HasUnpublishedChanges bool
	// ModuleTestPassed and ExerciseBankTestPassed tell that the latest result of the test passed and is valid for the current
	// state; the second is also true when the module has no exercises.
	ModuleTestPassed       bool
	ExerciseBankTestPassed bool
}

// List returns the versions, the newest first, with the current one marked, and whether the draft has unpublished changes.
func (s *Versions) List(ctx context.Context, who Actor, moduleID uuid.UUID) (VersionList, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return VersionList{}, err
	}
	list, changed, err := s.store.ListVersions(ctx, moduleID)
	if err != nil {
		return VersionList{}, err
	}
	if len(list) > 0 {
		list[0].Current = true
	}
	state, err := s.store.TestState(ctx, moduleID)
	if err != nil {
		return VersionList{}, err
	}
	return VersionList{Versions: list, HasUnpublishedChanges: changed, ModuleTestPassed: state.ModulePassed(), ExerciseBankTestPassed: state.BankPassed()}, nil
}

// Publish stores the draft as the next version, when the tests of the module passed for the current state (SPEC-024 RN-13).
func (s *Versions) Publish(ctx context.Context, who Actor, moduleID uuid.UUID, note string) (domain.ModuleVersion, error) {
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return domain.ModuleVersion{}, err
	}
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > domain.MaxVersionNote {
		return domain.ModuleVersion{}, ErrNoteTooLong
	}
	v, err := s.store.PublishGated(ctx, moduleID, who.UserID, note, requireTests)
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

// requireTests is the gate of the publication: it refuses a state whose tests are missing, failed or stale.
func requireTests(state domain.TestState) error {
	if missing := state.Missing(); len(missing) > 0 {
		return &MissingTestsError{Tests: missing}
	}
	return nil
}

// InitialVersionStore publishes the first version without the gate of the tests (SPEC-021 RN-11).
type InitialVersionStore interface {
	PublishVersion(ctx context.Context, moduleID, by uuid.UUID, note string) (domain.ModuleVersion, error)
}

// InitialVersions creates the version 1 of a new module, so a module is never without a published version.
type InitialVersions struct{ store InitialVersionStore }

// NewInitialVersions creates the service.
func NewInitialVersions(store InitialVersionStore) *InitialVersions {
	return &InitialVersions{store: store}
}

// CreateInitialVersion publishes the draft of a just created module as version 1; a module that already has versions is left alone.
func (s *InitialVersions) CreateInitialVersion(ctx context.Context, moduleID, by uuid.UUID) error {
	_, err := s.store.PublishVersion(ctx, moduleID, by, "Initial version")
	if errors.Is(err, ErrNoChanges) {
		return nil
	}
	return err
}
