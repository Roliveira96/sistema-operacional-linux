package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// testedState is a module whose two tests passed for the current state.
func testedState() domain.TestState {
	return domain.TestState{
		Module: &domain.ModuleTestResult{Passed: true, ContentHash: "d"}, DraftHash: "d",
		Bank: &domain.ModuleTestResult{Passed: true, ContentHash: "b"}, BankHash: "b", HasExercises: true,
	}
}

func publishWith(t *testing.T, mutate func(*domain.TestState)) ([]domain.TestKind, error) {
	t.Helper()
	s, store, owner, _ := versionFixture()
	mutate(&store.state)
	_, err := s.Publish(context.Background(), owner, uuid.New(), "")
	var missing *MissingTestsError
	if errors.As(err, &missing) {
		return missing.Tests, err
	}
	return nil, err
}

// Covers SPEC-024 CA-17, CA-18, CA-21: publishing without a valid result of the tests is refused and lists what is missing.
func TestVersions_PublishNeedsTheTests(t *testing.T) {
	both := []domain.TestKind{domain.TestModule, domain.TestExerciseBank}
	cases := []struct {
		name    string
		mutate  func(*domain.TestState)
		missing []domain.TestKind
	}{
		{"both valid", func(*domain.TestState) {}, nil},
		{"no results at all", func(s *domain.TestState) { s.Module, s.Bank = nil, nil }, both},
		{"failed module result", func(s *domain.TestState) { s.Module.Passed = false }, []domain.TestKind{domain.TestModule}},
		{"failed bank result", func(s *domain.TestState) { s.Bank.Passed = false }, []domain.TestKind{domain.TestExerciseBank}},
		// CA-18: a result made for another state is stale.
		{"stale module hash", func(s *domain.TestState) { s.DraftHash = "changed" }, []domain.TestKind{domain.TestModule}},
		{"stale bank hash", func(s *domain.TestState) { s.BankHash = "changed" }, []domain.TestKind{domain.TestExerciseBank}},
		{"only the module tested", func(s *domain.TestState) { s.Bank = nil }, []domain.TestKind{domain.TestExerciseBank}},
		{"only the bank tested", func(s *domain.TestState) { s.Module = nil }, []domain.TestKind{domain.TestModule}},
		{"both stale", func(s *domain.TestState) { s.DraftHash, s.BankHash = "x", "y" }, both},
		// CA-21: a module without exercises does not need the test of the bank.
		{"no exercises, no bank result", func(s *domain.TestState) { s.HasExercises, s.Bank = false, nil }, nil},
		{"no exercises, module not tested", func(s *domain.TestState) { s.HasExercises, s.Bank, s.Module = false, nil, nil }, []domain.TestKind{domain.TestModule}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			missing, err := publishWith(t, tc.mutate)
			if tc.missing == nil {
				assert.NoError(t, err)
				return
			}
			assert.Equal(t, tc.missing, missing)
			assert.Error(t, err)
		})
	}
}

func TestMissingTestsError_Message(t *testing.T) {
	err := &MissingTestsError{Tests: []domain.TestKind{domain.TestModule, domain.TestExerciseBank}}
	assert.Contains(t, err.Error(), "MODULE, EXERCISE_BANK")
}

// Covers SPEC-024 CA-17: a refused publication stores no version.
func TestVersions_PublishRefusedStoresNothing(t *testing.T) {
	s, store, owner, _ := versionFixture()
	store.state.Module = nil
	_, err := s.Publish(context.Background(), owner, uuid.New(), "nota")
	require.Error(t, err)
	assert.Empty(t, store.note, "the store never reached the point of saving")
}

// Covers SPEC-024 5: the list tells the screen whether the Publish button can be enabled.
func TestVersions_ListReportsTheTests(t *testing.T) {
	s, store, owner, _ := versionFixture()
	got, err := s.List(context.Background(), owner, uuid.New())
	require.NoError(t, err)
	assert.True(t, got.ModuleTestPassed)
	assert.True(t, got.ExerciseBankTestPassed)

	store.state.DraftHash = "changed"
	store.state.BankHash = "changed"
	got, _ = s.List(context.Background(), owner, uuid.New())
	assert.False(t, got.ModuleTestPassed, "CA-18: the draft changed after the test")
	assert.False(t, got.ExerciseBankTestPassed, "CA-18: the bank changed after the test")

	store.state.HasExercises = false
	got, _ = s.List(context.Background(), owner, uuid.New())
	assert.False(t, got.ModuleTestPassed)
	assert.True(t, got.ExerciseBankTestPassed, "CA-21: no exercises, nothing to test")
}

// Covers SPEC-024 RN-13: the server stamps the result, and only the owner and admins register it.
func TestVersions_RecordTestResult(t *testing.T) {
	s, store, owner, admin := versionFixture()
	ctx := context.Background()
	m := uuid.New()

	r, err := s.RecordTestResult(ctx, owner, m, domain.TestExerciseBank, true, []byte(`{"cards":[]}`))
	require.NoError(t, err)
	assert.Equal(t, "hash-of-EXERCISE_BANK", r.ContentHash, "the hash comes from the store, never from the caller")
	assert.Equal(t, owner.UserID, store.saved.TestedBy)
	assert.Equal(t, m, store.saved.ModuleID)
	assert.True(t, store.saved.Passed)
	assert.JSONEq(t, `{"cards":[]}`, string(store.saved.Summary))
	assert.NotEqual(t, uuid.Nil, store.saved.ID)

	_, err = s.RecordTestResult(ctx, admin, m, domain.TestModule, false, nil)
	require.NoError(t, err)
	assert.Nil(t, store.saved.Summary)
	_, err = s.RecordTestResult(ctx, admin, m, domain.TestModule, false, []byte("null"))
	require.NoError(t, err)
	assert.Nil(t, store.saved.Summary)

	_, err = s.RecordTestResult(ctx, owner, m, "OTHER", true, nil)
	assert.ErrorIs(t, err, ErrInvalidTestKind)
	_, err = s.RecordTestResult(ctx, owner, m, domain.TestModule, true, []byte(`[1]`))
	assert.ErrorIs(t, err, ErrInvalidSummary)
	_, err = s.RecordTestResult(ctx, owner, m, domain.TestModule, true, []byte(`{"a":"`+strings.Repeat("x", domain.MaxTestSummary)+`"}`))
	assert.ErrorIs(t, err, ErrSummaryTooLarge)

	_, err = s.RecordTestResult(ctx, Actor{UserID: uuid.New(), Role: "TEACHER"}, m, domain.TestModule, true, nil)
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = s.RecordTestResult(ctx, Actor{UserID: owner.UserID, Role: "STUDENT"}, m, domain.TestModule, true, nil)
	assert.ErrorIs(t, err, ErrForbidden)
	store.missing = true
	_, err = s.RecordTestResult(ctx, owner, m, domain.TestModule, true, nil)
	assert.ErrorIs(t, err, ErrModuleNotFound)
}
