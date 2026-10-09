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
	var machine contentdomain.Machine
	if err := json.Unmarshal(snapshot, &machine); err != nil ||
		machine.Format != contentdomain.MachineFormat || machine.Version != contentdomain.MachineVersion {
		return CheckResult{}, ErrInvalidSnapshot
	}
	verdict, err := contentdomain.Grade(&machine, item.Conditions)
	if err != nil {
		return CheckResult{}, fmt.Errorf("grade question %s: %w", questionID, err)
	}

	progress, err := s.store.FindProgress(ctx, *v.UserID, questionID)
	if errors.Is(err, ErrNotFound) {
		id, idErr := uuid.NewV7()
		if idErr != nil {
			return CheckResult{}, idErr
		}
		progress = domain.Progress{ID: id, UserID: *v.UserID, QuestionID: questionID}
	} else if err != nil {
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
