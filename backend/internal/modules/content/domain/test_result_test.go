package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func passed(hash string) *ModuleTestResult { return &ModuleTestResult{Passed: true, ContentHash: hash} }

// Covers SPEC-024 RN-13, CA-17, CA-18, CA-21: a result counts only when it passed for the current hash.
func TestTestState(t *testing.T) {
	ok := TestState{Module: passed("d"), DraftHash: "d", Bank: passed("b"), BankHash: "b", HasExercises: true}
	assert.Empty(t, ok.Missing())
	assert.True(t, ok.ModulePassed())
	assert.True(t, ok.BankPassed())

	stale := ok
	stale.DraftHash = "d2"
	assert.Equal(t, []TestKind{TestModule}, stale.Missing())

	failed := ok
	failed.Bank = &ModuleTestResult{Passed: false, ContentHash: "b"}
	assert.Equal(t, []TestKind{TestExerciseBank}, failed.Missing())

	none := TestState{DraftHash: "d", BankHash: "b", HasExercises: true}
	assert.Equal(t, []TestKind{TestModule, TestExerciseBank}, none.Missing())

	noExercises := TestState{Module: passed("d"), DraftHash: "d", BankHash: "b"}
	assert.Empty(t, noExercises.Missing(), "a module without exercises does not need the bank test")
	assert.True(t, noExercises.BankPassed())
}

func TestValidTestKind(t *testing.T) {
	assert.True(t, ValidTestKind(TestModule))
	assert.True(t, ValidTestKind(TestExerciseBank))
	assert.False(t, ValidTestKind("module"))
	assert.False(t, ValidTestKind(""))
}

func TestModuleTestResultTableName(t *testing.T) {
	assert.Equal(t, "module_test_results", ModuleTestResult{}.TableName())
}
