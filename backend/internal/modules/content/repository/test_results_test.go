package repository_test

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// gate is the one of the service: it refuses a state with missing tests.
func gate(state domain.TestState) error {
	if m := state.Missing(); len(m) > 0 {
		return &service.MissingTestsError{Tests: m}
	}
	return nil
}

func (f bankFixture) record(t *testing.T, kind domain.TestKind, passed bool) domain.ModuleTestResult {
	t.Helper()
	id, err := uuid.NewV7()
	require.NoError(t, err)
	saved, err := f.repo.SaveTestResult(f.ctx, domain.ModuleTestResult{ID: id, ModuleID: f.module.ID, Kind: kind, Passed: passed,
		Summary: json.RawMessage(`{"cards":[]}`), TestedBy: f.teacher.ID, CreatedAt: f.now})
	require.NoError(t, err)
	return saved
}

func (f bankFixture) state(t *testing.T) domain.TestState {
	t.Helper()
	st, err := f.repo.TestState(f.ctx, f.module.ID)
	require.NoError(t, err)
	return st
}

func (f bankFixture) addBlock(t *testing.T, html string) {
	t.Helper()
	var n int64
	require.NoError(t, f.db.Conn(f.ctx).Table("content_blocks").Where("module_id = ?", f.module.ID).Count(&n).Error)
	b := &domain.ContentBlock{ID: uuid.New(), ModuleID: f.module.ID, BlockType: domain.BlockText, Position: int(n) + 1,
		Payload: json.RawMessage(`{"html":"` + html + `"}`), CreatedAt: f.now, UpdatedAt: f.now}
	require.NoError(t, f.repo.SaveBlock(f.ctx, b))
}

// Covers SPEC-024 CA-18 against PostgreSQL (migration 00019): the hash of the bank changes with anything the test covers.
func TestBankHashChangesWithTheBank(t *testing.T) {
	f := newBank(t)
	st := f.state(t)
	assert.False(t, st.HasExercises)
	empty := st.BankHash
	assert.NotEmpty(t, empty)

	a := f.create(t, "A", practice)
	st = f.state(t)
	assert.True(t, st.HasExercises)
	withA := st.BankHash
	assert.NotEqual(t, empty, withA, "a new exercise")
	assert.Equal(t, withA, f.state(t).BankHash, "the hash is deterministic")

	changes := map[string]string{
		"statement":   "UPDATE questions SET statement = '<p>y</p>' WHERE id = ?",
		"title":       "UPDATE questions SET title = 'Other' WHERE id = ?",
		"difficulty":  "UPDATE questions SET difficulty = 'HARD' WHERE id = ?",
		"conditions":  `UPDATE questions SET validation_conditions = '[]'::jsonb WHERE id = ?`,
		"assessment":  "UPDATE questions SET in_assessment = true, usage = 'EXERCISE' WHERE id = ?",
		"hint":        "UPDATE questions SET hint = 'dica' WHERE id = ?",
		"explanation": "UPDATE questions SET explanation = 'porque' WHERE id = ?",
		"status":      "UPDATE questions SET status = 'PUBLISHED' WHERE id = ?",
		"trail order": "UPDATE module_exercise_items SET sequence_order = 7 WHERE exercise_id = ?",
	}
	prev := withA
	for name, sql := range changes {
		require.NoError(t, f.db.Conn(f.ctx).Exec(sql, a.ID).Error, name)
		now := f.state(t).BankHash
		assert.NotEqual(t, prev, now, name)
		prev = now
	}

	// A depends_on link and the snapshot of the bank are part of it too.
	b := f.create(t, "B", practice)
	prev = f.state(t).BankHash
	require.NoError(t, f.db.Conn(f.ctx).Exec("UPDATE questions SET depends_on = ? WHERE id = ?", a.ID, b.ID).Error)
	assert.NotEqual(t, prev, f.state(t).BankHash, "depends_on")
	prev = f.state(t).BankHash
	require.NoError(t, f.repo.SaveBankSetup(f.ctx, f.module.ID, json.RawMessage(`{"steps":[{"command":"mkdir /banco"}]}`)))
	assert.NotEqual(t, prev, f.state(t).BankHash, "the snapshot of the bank")

	// An exercise that is deleted leaves the bank; the hash is the one of the bank without it.
	prev = f.state(t).BankHash
	require.NoError(t, f.repo.DeleteExercise(f.ctx, f.module.ID, b.ID, f.now))
	assert.NotEqual(t, prev, f.state(t).BankHash, "a deleted exercise")
}

// Covers SPEC-024 CA-18: the hash of the module test is the one of the draft, so a change of a block makes the result stale.
func TestModuleTestResultGoesStaleWhenABlockChanges(t *testing.T) {
	f := newBank(t)
	res := f.record(t, domain.TestModule, true)
	st := f.state(t)
	assert.Equal(t, st.DraftHash, res.ContentHash, "the server stamps the hash of the draft")
	assert.True(t, st.ModulePassed())

	f.addBlock(t, "a")
	st = f.state(t)
	assert.NotEqual(t, res.ContentHash, st.DraftHash)
	assert.False(t, st.ModulePassed(), "a block changed after the test")

	f.record(t, domain.TestModule, true)
	assert.True(t, f.state(t).ModulePassed(), "tested again")
	require.NoError(t, f.db.Conn(f.ctx).Exec("UPDATE content_blocks SET payload = '{\"html\":\"b\"}'::jsonb WHERE module_id = ?", f.module.ID).Error)
	assert.False(t, f.state(t).ModulePassed(), "the payload of a block changed after the test")
}

// Covers SPEC-024 RN-13: the latest result of each kind is the one that counts, and the old ones stay as history.
func TestLatestTestResultWins(t *testing.T) {
	f := newBank(t)
	f.create(t, "A", practice)

	f.record(t, domain.TestExerciseBank, true)
	assert.True(t, f.state(t).BankPassed())
	failed := f.record(t, domain.TestExerciseBank, false)
	st := f.state(t)
	assert.False(t, st.BankPassed(), "the newest result failed")
	assert.Equal(t, failed.ID, st.Bank.ID)
	assert.Nil(t, st.Module, "the other kind has none")
	assert.JSONEq(t, `{"cards":[]}`, string(st.Bank.Summary))

	var rows int64
	require.NoError(t, f.db.Conn(f.ctx).Table("module_test_results").Where("module_id = ?", f.module.ID).Count(&rows).Error)
	assert.EqualValues(t, 2, rows, "the history is kept")

	_, err := f.repo.SaveTestResult(f.ctx, domain.ModuleTestResult{ID: uuid.New(), ModuleID: uuid.New(), Kind: domain.TestModule, TestedBy: f.teacher.ID})
	assert.ErrorIs(t, err, service.ErrNotFound)
	_, err = f.repo.SaveTestResult(f.ctx, domain.ModuleTestResult{ID: uuid.New(), ModuleID: uuid.New(), Kind: domain.TestExerciseBank, TestedBy: f.teacher.ID})
	assert.ErrorIs(t, err, service.ErrNotFound)
	_, err = f.repo.TestState(f.ctx, uuid.New())
	assert.ErrorIs(t, err, service.ErrNotFound)
}

// Covers SPEC-024 CA-17, CA-18, CA-21 and the exemption of the initial load (SPEC-021 RN-08), in the transaction that stores the version.
func TestPublishGatedChecksTheTestsInTheTransaction(t *testing.T) {
	f := newBank(t)
	f.addBlock(t, "a")
	f.create(t, "A", practice)

	var missing *service.MissingTestsError
	_, err := f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "", gate)
	require.True(t, errors.As(err, &missing), "CA-17: nothing was tested")
	assert.Equal(t, []domain.TestKind{domain.TestModule, domain.TestExerciseBank}, missing.Tests)
	latest, err := f.repo.LatestVersion(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, latest.Number, "no version was created")

	f.record(t, domain.TestModule, true)
	_, err = f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "", gate)
	require.True(t, errors.As(err, &missing))
	assert.Equal(t, []domain.TestKind{domain.TestExerciseBank}, missing.Tests, "only one of the two")

	f.record(t, domain.TestExerciseBank, true)
	v, err := f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "ok", gate)
	require.NoError(t, err, "both tests are valid")
	assert.Equal(t, 2, v.Number)

	// CA-18: the edit after the test makes the result stale, so the next publication is refused again.
	require.NoError(t, f.db.Conn(f.ctx).Exec("UPDATE questions SET title = 'Novo' WHERE module_id = ?", f.module.ID).Error)
	f.addBlock(t, "c")
	_, err = f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "", gate)
	require.True(t, errors.As(err, &missing))
	assert.Equal(t, []domain.TestKind{domain.TestModule, domain.TestExerciseBank}, missing.Tests)

	// The initial load does not go through the gate (SPEC-021 RN-08).
	v, err = f.repo.PublishVersion(f.ctx, f.module.ID, f.teacher.ID, "Carga inicial")
	require.NoError(t, err)
	assert.Equal(t, 3, v.Number)

	// No changes is still told as such.
	_, err = f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "", gate)
	assert.ErrorIs(t, err, service.ErrNoChanges)
}

// Covers SPEC-024 CA-21: a module without exercises is published with the test of the content only.
func TestPublishGatedWithoutExercisesNeedsOnlyTheModuleTest(t *testing.T) {
	f := newBank(t)
	f.addBlock(t, "a")
	assert.True(t, f.state(t).BankPassed())

	var missing *service.MissingTestsError
	_, err := f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "", gate)
	require.True(t, errors.As(err, &missing))
	assert.Equal(t, []domain.TestKind{domain.TestModule}, missing.Tests)

	f.record(t, domain.TestModule, true)
	_, err = f.repo.PublishGated(f.ctx, f.module.ID, f.teacher.ID, "", gate)
	require.NoError(t, err)
}
