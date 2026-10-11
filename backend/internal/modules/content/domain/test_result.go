package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// TestKind is which test of a module a result belongs to (SPEC-024 RN-13).
type TestKind string

// Test kinds.
const (
	// TestModule is the test of the content of the module; it covers the draft (its hash is the one of SPEC-021).
	TestModule TestKind = "MODULE"
	// TestExerciseBank is the test of the bank of exercises of the module (SPEC-023 12).
	TestExerciseBank TestKind = "EXERCISE_BANK"
)

// MaxTestSummary is the largest summary of a result, in bytes (SPEC-024 4).
const MaxTestSummary = 64 << 10

// ValidTestKind reports whether k is a known kind.
func ValidTestKind(k TestKind) bool { return k == TestModule || k == TestExerciseBank }

// ModuleTestResult is the outcome of a test the teacher ran, with the hash of what it covered at that moment.
type ModuleTestResult struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	ModuleID    uuid.UUID `gorm:"type:uuid"`
	Kind        TestKind
	ContentHash string
	Passed      bool
	Summary     json.RawMessage `gorm:"type:jsonb"`
	TestedBy    uuid.UUID       `gorm:"type:uuid"`
	CreatedAt   time.Time
}

func (ModuleTestResult) TableName() string { return "module_test_results" }

// valid is true for a passed result of exactly the state that exists now.
func (r *ModuleTestResult) valid(hash string) bool {
	return r != nil && r.Passed && r.ContentHash == hash
}

// TestState is what decides whether a module can be published: the latest result of each test and the hashes of the
// current state. A result is stale when its hash is not the current one.
type TestState struct {
	Module, Bank *ModuleTestResult
	DraftHash    string
	BankHash     string
	HasExercises bool
}

// ModulePassed reports whether the test of the content passed for the current draft.
func (s TestState) ModulePassed() bool { return s.Module.valid(s.DraftHash) }

// BankPassed reports whether the test of the bank passed for the current bank; a module without exercises needs none.
func (s TestState) BankPassed() bool { return !s.HasExercises || s.Bank.valid(s.BankHash) }

// Missing lists the tests that still have to be run (and passed) before publishing.
func (s TestState) Missing() []TestKind {
	var out []TestKind
	if !s.ModulePassed() {
		out = append(out, TestModule)
	}
	if !s.BankPassed() {
		out = append(out, TestExerciseBank)
	}
	return out
}
