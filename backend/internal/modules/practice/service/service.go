// Package service implements exercise practice: scenario delivery, server-side
// grading and progress (SPEC-014).
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
)

// ErrInvalidSnapshot means the submitted state is not a serialized machine.
var ErrInvalidSnapshot = errors.New("snapshot is not a valid serialized machine")

// ErrNotFound must be returned by the store for missing progress.
var ErrNotFound = errors.New("progress not found")

// Content is the part of the content module this service uses.
type Content interface {
	PracticeItem(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (contentservice.PracticeItem, error)
	TopicScenario(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error)
	ModulePracticeItems(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) ([]contentservice.PracticeItem, error)
}

// Store persists progress.
type Store interface {
	FindProgress(ctx context.Context, userID, questionID uuid.UUID) (domain.Progress, error)
	SaveProgress(ctx context.Context, p *domain.Progress) error
	ListModuleProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.Progress, error)
}

// Service is the practice use-case layer.
type Service struct {
	content Content
	store   Store
	now     func() time.Time
}

// New creates the service.
func New(content Content, store Store) *Service {
	return &Service{content: content, store: store, now: time.Now}
}

// Scenario returns the starting state of a practice exercise (RN-01).
func (s *Service) Scenario(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error) {
	item, err := s.content.PracticeItem(ctx, questionID, v)
	if err != nil {
		return nil, err
	}
	return item.Snapshot, nil
}

// CheckResult is what the student learns from a check: no conditions.
type CheckResult struct {
	Passed      bool
	CompletedAt *time.Time
}

// Check grades the submitted final state on the server and records the
// result for the student (RN-02, RN-03). v.UserID must be set.
func (s *Service) Check(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer, snapshot json.RawMessage) (CheckResult, error) {
	if v.UserID == nil {
		return CheckResult{}, contentservice.ErrAuthRequired
	}
	item, err := s.content.PracticeItem(ctx, questionID, v)
	if err != nil {
		return CheckResult{}, err
	}
	machine, err := parseMachine(snapshot)
	if err != nil {
		return CheckResult{}, err
	}
	verdict, err := contentdomain.Grade(machine, item.Conditions)
	if err != nil {
		return CheckResult{}, fmt.Errorf("grade question %s: %w", questionID, err)
	}

	progress, err := s.progressOf(ctx, *v.UserID, questionID)
	if err != nil {
		return CheckResult{}, err
	}
	progress.Record(verdict.Passed, s.now().UTC())
	if err := s.store.SaveProgress(ctx, &progress); err != nil {
		return CheckResult{}, fmt.Errorf("save progress: %w", err)
	}
	return CheckResult{Passed: verdict.Passed, CompletedAt: progress.CompletedAt}, nil
}

// ModuleProgress lists the student's progress in a module.
func (s *Service) ModuleProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.Progress, error) {
	return s.store.ListModuleProgress(ctx, userID, moduleID)
}

func parseMachine(snapshot json.RawMessage) (*contentdomain.Machine, error) {
	var machine contentdomain.Machine
	if err := json.Unmarshal(snapshot, &machine); err != nil ||
		machine.Format != contentdomain.MachineFormat || machine.Version != contentdomain.MachineVersion {
		return nil, ErrInvalidSnapshot
	}
	return &machine, nil
}

// progressOf loads the student's progress on a question, or starts a new one.
func (s *Service) progressOf(ctx context.Context, userID, questionID uuid.UUID) (domain.Progress, error) {
	progress, err := s.store.FindProgress(ctx, userID, questionID)
	if errors.Is(err, ErrNotFound) {
		id, idErr := uuid.NewV7()
		if idErr != nil {
			return domain.Progress{}, idErr
		}
		return domain.Progress{ID: id, UserID: userID, QuestionID: questionID}, nil
	}
	return progress, err
}

// TopicScenario returns the prepared machine of the module topic, or nil for
// the default machine (SPEC-016 5.1).
func (s *Service) TopicScenario(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error) {
	return s.content.TopicScenario(ctx, moduleID, v)
}

// ModuleCheckResult lists the exercises the submitted machine satisfies and
// the student's completions in the module.
type ModuleCheckResult struct {
	Passed   []uuid.UUID
	Progress []domain.Progress
}

// CheckModule grades every practical exercise of the module against the
// student's machine and records the approvals (SPEC-016 5.2, RN-01): failures
// are not recorded, so the automatic check never counts attempts.
func (s *Service) CheckModule(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer, snapshot json.RawMessage) (ModuleCheckResult, error) {
	if v.UserID == nil {
		return ModuleCheckResult{}, contentservice.ErrAuthRequired
	}
	items, err := s.content.ModulePracticeItems(ctx, moduleID, v)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	machine, err := parseMachine(snapshot)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	passed := []uuid.UUID{}
	for _, item := range items {
		verdict, err := contentdomain.Grade(machine, item.Conditions)
		if err != nil {
			return ModuleCheckResult{}, fmt.Errorf("grade question %s: %w", item.QuestionID, err)
		}
		if !verdict.Passed {
			continue
		}
		passed = append(passed, item.QuestionID)
		progress, err := s.progressOf(ctx, *v.UserID, item.QuestionID)
		if err != nil {
			return ModuleCheckResult{}, err
		}
		if progress.CompletedAt != nil {
			continue
		}
		progress.Complete(s.now().UTC())
		if err := s.store.SaveProgress(ctx, &progress); err != nil {
			return ModuleCheckResult{}, fmt.Errorf("save progress: %w", err)
		}
	}
	all, err := s.store.ListModuleProgress(ctx, *v.UserID, moduleID)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	return ModuleCheckResult{Passed: passed, Progress: all}, nil
}
