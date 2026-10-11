package repository

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// bankSQL hashes the bank of exercises of a module (SPEC-024 RN-13): every exercise that is not deleted, with its links and its
// place in the trail, in the order of the id so the text is deterministic, and the snapshot of the bank. Any change to them changes the hash.
const bankSQL = `SELECT encode(sha256(convert_to(jsonb_build_object(
    'bankSetup', m.bank_setup,
    'exercises', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'usage', q.usage, 'difficulty', q.difficulty, 'status', q.status, 'title', q.title,
        'statement', q.statement, 'hint', q.hint, 'explanation', q.explanation, 'scenarioId', q.scenario_id,
        'referenceSolution', q.reference_solution, 'validationConditions', q.validation_conditions, 'choices', q.choices,
        'answerKey', q.answer_key, 'hints', q.hints, 'endConditions', q.end_conditions,
        'inAssessment', q.in_assessment, 'exclusiveAssessment', q.exclusive_assessment, 'dependsOn', q.depends_on,
        'trailOrder', i.sequence_order, 'mandatory', i.is_mandatory) ORDER BY q.id)
        FROM questions q LEFT JOIN module_exercise_items i ON i.exercise_id = q.id AND i.module_id = q.module_id
        WHERE q.module_id = m.id AND q.deleted_at IS NULL), '[]'::jsonb))::text, 'UTF8')), 'hex') AS hash,
    EXISTS (SELECT 1 FROM questions q WHERE q.module_id = m.id AND q.deleted_at IS NULL) AS has_exercises
FROM course_modules m WHERE m.id = ?`

// bankHash returns the hash of the bank of exercises of the module, and whether the module has any exercise.
func (r *Repository) bankHash(ctx context.Context, moduleID uuid.UUID) (hash string, has bool, err error) {
	var row struct {
		Hash         string
		HasExercises bool
	}
	res := r.db.Conn(ctx).Raw(bankSQL, moduleID).Scan(&row)
	if res.Error != nil {
		return "", false, res.Error
	}
	if res.RowsAffected == 0 {
		return "", false, service.ErrNotFound
	}
	return row.Hash, row.HasExercises, nil
}

// latestResult returns the newest result of the kind, or nil when there is none.
func (r *Repository) latestResult(ctx context.Context, moduleID uuid.UUID, kind domain.TestKind) (*domain.ModuleTestResult, error) {
	var res domain.ModuleTestResult
	q := r.db.Conn(ctx).Where("module_id = ? AND kind = ?", moduleID, kind).Order("created_at DESC, id DESC").Limit(1).Find(&res)
	if q.Error != nil || q.RowsAffected == 0 {
		return nil, q.Error
	}
	return &res, nil
}

// testState reads the results and the current hashes; draftHash is the hash of the draft when the caller already has it.
func (r *Repository) testState(ctx context.Context, moduleID uuid.UUID, draftHash string) (domain.TestState, error) {
	st := domain.TestState{DraftHash: draftHash}
	var err error
	if st.DraftHash == "" {
		if _, st.DraftHash, err = r.draft(ctx, moduleID); err != nil {
			return st, err
		}
	}
	if st.BankHash, st.HasExercises, err = r.bankHash(ctx, moduleID); err != nil {
		return st, err
	}
	if st.Module, err = r.latestResult(ctx, moduleID, domain.TestModule); err != nil {
		return st, err
	}
	st.Bank, err = r.latestResult(ctx, moduleID, domain.TestExerciseBank)
	return st, err
}

// TestState reads the latest result of each test and the hashes of the current state of the module.
func (r *Repository) TestState(ctx context.Context, moduleID uuid.UUID) (domain.TestState, error) {
	return r.testState(ctx, moduleID, "")
}

// SaveTestResult stores the result with the hash of what its kind covers now: the draft for MODULE, the bank for EXERCISE_BANK.
func (r *Repository) SaveTestResult(ctx context.Context, res domain.ModuleTestResult) (domain.ModuleTestResult, error) {
	var err error
	if res.Kind == domain.TestModule {
		_, res.ContentHash, err = r.draft(ctx, res.ModuleID)
	} else {
		res.ContentHash, _, err = r.bankHash(ctx, res.ModuleID)
	}
	if err != nil {
		return res, err
	}
	return res, r.db.Conn(ctx).Create(&res).Error
}
