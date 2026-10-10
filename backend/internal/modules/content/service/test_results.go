package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// Test result errors (SPEC-024 RN-13).
var (
	ErrInvalidTestKind = errors.New("the kind of the test must be MODULE or EXERCISE_BANK")
	ErrInvalidSummary  = errors.New("the summary of a test must be a JSON object")
	ErrSummaryTooLarge = errors.New("the summary of a test has at most 64 KB")
)

// MissingTestsError is returned by Publish when a test is missing, failed, or was made for a state that changed since.
type MissingTestsError struct {
	Tests []domain.TestKind
}

func (e *MissingTestsError) Error() string {
	names := make([]string, len(e.Tests))
	for i, k := range e.Tests {
		names[i] = string(k)
	}
	return "the module must pass these tests before publishing: " + strings.Join(names, ", ")
}

// RecordTestResult stores the result of a test the teacher ran in the module screen. The server computes the hash of what
// the kind covers at this moment, so a later change makes the result stale (SPEC-024 RN-13).
func (s *Versions) RecordTestResult(ctx context.Context, who Actor, moduleID uuid.UUID, kind domain.TestKind, passed bool, summary []byte) (domain.ModuleTestResult, error) {
	if !domain.ValidTestKind(kind) {
		return domain.ModuleTestResult{}, ErrInvalidTestKind
	}
	if len(summary) > domain.MaxTestSummary {
		return domain.ModuleTestResult{}, ErrSummaryTooLarge
	}
	if t := strings.TrimSpace(string(summary)); t == "" || t == "null" {
		summary = nil
	} else if t[0] != '{' {
		return domain.ModuleTestResult{}, ErrInvalidSummary
	}
	if err := s.authorize(ctx, moduleID, who); err != nil {
		return domain.ModuleTestResult{}, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return domain.ModuleTestResult{}, err
	}
	saved, err := s.store.SaveTestResult(ctx, domain.ModuleTestResult{
		ID: id, ModuleID: moduleID, Kind: kind, Passed: passed, Summary: summary, TestedBy: who.UserID, CreatedAt: s.now(),
	})
	if err != nil {
		return domain.ModuleTestResult{}, err
	}
	s.log.Info("module test registered", zap.String("userId", who.UserID.String()), zap.String("moduleId", moduleID.String()),
		zap.String("kind", string(kind)), zap.Bool("passed", passed))
	return saved, nil
}
