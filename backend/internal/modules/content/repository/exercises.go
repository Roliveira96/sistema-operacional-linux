package repository

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// exerciseRow is a question of the module with its place in the trail.
type exerciseRow struct {
	domain.Question
	Position  *int
	Mandatory *bool
}

func (r exerciseRow) record() service.ExerciseRecord {
	rec := service.ExerciseRecord{Question: r.Question}
	if r.Position != nil {
		rec.Position = *r.Position
	}
	if r.Mandatory != nil {
		rec.Mandatory = *r.Mandatory
	}
	return rec
}

// exerciseQuery reads the practical questions of a module with the names of who created and changed them and their place in
// the trail (SPEC-023 RN-01).
func (r *Repository) exerciseQuery(ctx context.Context) *gorm.DB {
	return r.db.Conn(ctx).Table("questions q").
		Select(`q.*, COALESCE(NULLIF(cu.name, ''), cu.email, '') AS created_by_name, COALESCE(NULLIF(uu.name, ''), uu.email, '') AS updated_by_name,
            i.sequence_order AS position, i.is_mandatory AS mandatory`).
		Joins("LEFT JOIN users cu ON cu.id = q.created_by").
		Joins("LEFT JOIN users uu ON uu.id = q.updated_by").
		Joins("LEFT JOIN module_exercise_items i ON i.exercise_id = q.id AND i.module_id = q.module_id").
		Where("q.kind = ? AND q.deleted_at IS NULL", domain.KindPractical)
}

// ListExercises returns the exercises of the bank: the ones in the practice in the order of the trail, then the others.
func (r *Repository) ListExercises(ctx context.Context, moduleID uuid.UUID) ([]service.ExerciseRecord, error) {
	var rows []exerciseRow
	if err := r.exerciseQuery(ctx).Where("q.module_id = ?", moduleID).Order("i.sequence_order NULLS LAST, q.created_at, q.id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]service.ExerciseRecord, len(rows))
	for i, row := range rows {
		out[i] = row.record()
	}
	return out, nil
}

// FindExercise returns one exercise of the module.
func (r *Repository) FindExercise(ctx context.Context, moduleID, id uuid.UUID) (service.ExerciseRecord, error) {
	var rows []exerciseRow
	if err := r.exerciseQuery(ctx).Where("q.module_id = ? AND q.id = ?", moduleID, id).Scan(&rows).Error; err != nil {
		return service.ExerciseRecord{}, err
	}
	if len(rows) == 0 {
		return service.ExerciseRecord{}, service.ErrExerciseNotFound
	}
	return rows[0].record(), nil
}

// CreateExercise inserts the question and, when it is in the practice, gives it the last place of the trail.
func (r *Repository) CreateExercise(ctx context.Context, q *domain.Question) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		if err := conn.Create(q).Error; err != nil {
			return err
		}
		if q.Usage != domain.UsageExercise {
			return nil
		}
		return appendToTrail(conn, q.ModuleID, q.ID, q.CreatedAt)
	})
}

// appendToTrail gives the exercise the last place of the trail of the module.
func appendToTrail(conn *gorm.DB, moduleID, id uuid.UUID, now time.Time) error {
	var last int
	if err := conn.Table("module_exercise_items").Where("module_id = ?", moduleID).Select("COALESCE(MAX(sequence_order), 0)").Scan(&last).Error; err != nil {
		return err
	}
	return conn.Exec(`INSERT INTO module_exercise_items (id, module_id, exercise_id, sequence_order, is_mandatory, created_at, updated_at)
        VALUES (?, ?, ?, ?, true, ?, ?)`, uuid.New(), moduleID, id, last+1, now, now).Error
}

// UpdateExercise writes the fields the teacher edits. expected guards against a concurrent change.
func (r *Repository) UpdateExercise(ctx context.Context, moduleID, id uuid.UUID, upd service.ExerciseUpdate, expected *time.Time) (service.ExerciseRecord, error) {
	e := upd.Exercise
	q := r.db.Conn(ctx).Model(&domain.Question{}).Where("id = ? AND module_id = ? AND kind = ?", id, moduleID, domain.KindPractical)
	if expected != nil {
		q = q.Where("updated_at = ?", expected.UTC())
	}
	var dependsOn any
	if upd.DependsOn != nil {
		dependsOn = *upd.DependsOn
	}
	fields := map[string]any{
		"title": e.Title, "difficulty": e.Difficulty, "statement": e.Statement, "hints": jsonOrNil(e.Hints),
		"reference_solution": jsonOrNil(e.Solution), "end_conditions": jsonOrNil(e.EndConditions), "validation_conditions": string(upd.Catalog),
		"depends_on": dependsOn, "edited_by_teacher_at": upd.Now, "updated_at": upd.Now, "updated_by": upd.By,
	}
	res := q.Updates(fields)
	if res.Error != nil {
		return service.ExerciseRecord{}, res.Error
	}
	if res.RowsAffected == 0 {
		// Either the exercise is gone or somebody changed it first.
		if _, err := r.FindExercise(ctx, moduleID, id); err != nil {
			return service.ExerciseRecord{}, err
		}
		return service.ExerciseRecord{}, service.ErrExerciseConflict
	}
	return r.FindExercise(ctx, moduleID, id)
}

// jsonOrNil gives a JSON column its text, or NULL when there is nothing to write.
func jsonOrNil(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	return string(raw)
}

// trailOffset moves the whole trail out of the way, so its places can be given again without colliding on the unique index.
const trailOffset = 1000000

// compactTrail numbers the trail of the module again from 1, keeping its order.
func compactTrail(conn *gorm.DB, moduleID uuid.UUID) error {
	if err := conn.Exec("UPDATE module_exercise_items SET sequence_order = sequence_order + ? WHERE module_id = ?", trailOffset, moduleID).Error; err != nil {
		return err
	}
	return conn.Exec(`UPDATE module_exercise_items t SET sequence_order = r.rn
        FROM (SELECT id, row_number() OVER (ORDER BY sequence_order) AS rn FROM module_exercise_items WHERE module_id = ?) r
        WHERE t.id = r.id`, moduleID).Error
}

// SetLinks links the exercise to the practice (a place at the end of the trail) and to the assessment, or unlinks it, and sets
// its publication. The exercise stays in the bank (SPEC-023 RN-03, 11.1).
func (r *Repository) SetLinks(ctx context.Context, moduleID, id uuid.UUID, links service.ExerciseLinks, status string, now time.Time) (service.ExerciseRecord, error) {
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		res := conn.Model(&domain.Question{}).Where("id = ? AND module_id = ? AND kind = ?", id, moduleID, domain.KindPractical).
			Updates(map[string]any{"usage": links.Usage(), "in_assessment": links.Assessment, "exclusive_assessment": links.Exclusive, "status": status, "updated_at": now})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return service.ErrExerciseNotFound
		}
		var inTrail int64
		if err := conn.Table("module_exercise_items").Where("module_id = ? AND exercise_id = ?", moduleID, id).Count(&inTrail).Error; err != nil {
			return err
		}
		switch {
		case links.Practice && inTrail == 0:
			return appendToTrail(conn, moduleID, id, now)
		case !links.Practice && inTrail > 0:
			if err := conn.Exec("DELETE FROM module_exercise_items WHERE module_id = ? AND exercise_id = ?", moduleID, id).Error; err != nil {
				return err
			}
			return compactTrail(conn, moduleID)
		}
		return nil
	})
	if err != nil {
		return service.ExerciseRecord{}, err
	}
	return r.FindExercise(ctx, moduleID, id)
}

// DeleteExercise removes the exercise (logically), its place in the trail, the progress of the students in it and the
// dependencies on it (SPEC-023 RN-09).
func (r *Repository) DeleteExercise(ctx context.Context, moduleID, id uuid.UUID, now time.Time) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		res := conn.Model(&domain.Question{}).Where("id = ? AND module_id = ? AND kind = ?", id, moduleID, domain.KindPractical).Update("deleted_at", now)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return service.ErrExerciseNotFound
		}
		if err := conn.Exec("DELETE FROM exercise_progress WHERE question_id = ?", id).Error; err != nil {
			return err
		}
		if err := conn.Exec("UPDATE questions SET depends_on = NULL WHERE depends_on = ?", id).Error; err != nil {
			return err
		}
		if err := conn.Exec("DELETE FROM module_exercise_items WHERE module_id = ? AND exercise_id = ?", moduleID, id).Error; err != nil {
			return err
		}
		return compactTrail(conn, moduleID)
	})
}

// ReorderExercises gives the trail the order and the obligation the teacher chose. The list must be exactly the exercises that are in it.
func (r *Repository) ReorderExercises(ctx context.Context, moduleID uuid.UUID, items []service.OrderItem, now time.Time) error {
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		var current []uuid.UUID
		if err := conn.Table("module_exercise_items").Where("module_id = ?", moduleID).Pluck("exercise_id", &current).Error; err != nil {
			return err
		}
		if len(current) != len(items) {
			return service.ErrInvalidExerciseOrder
		}
		want := make([]string, len(current))
		for i, id := range current {
			want[i] = id.String()
		}
		got := make([]string, len(items))
		for i, it := range items {
			got[i] = it.ExerciseID.String()
		}
		sort.Strings(want)
		sort.Strings(got)
		for i := range want {
			if want[i] != got[i] {
				return service.ErrInvalidExerciseOrder
			}
		}
		if err := conn.Exec("UPDATE module_exercise_items SET sequence_order = sequence_order + ? WHERE module_id = ?", trailOffset, moduleID).Error; err != nil {
			return err
		}
		for i, it := range items {
			if err := conn.Exec("UPDATE module_exercise_items SET sequence_order = ?, is_mandatory = ?, updated_at = ? WHERE module_id = ? AND exercise_id = ?",
				i+1, it.Mandatory, now, moduleID, it.ExerciseID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ValidDependency tells whether the exercise `id` (nil when it does not exist yet) can depend on `dependsOn`: the latter must be a
// practical exercise of the module and the chain of dependencies above it must not lead back to `id`.
func (r *Repository) ValidDependency(ctx context.Context, moduleID uuid.UUID, id *uuid.UUID, dependsOn uuid.UUID) (bool, error) {
	conn := r.db.Conn(ctx)
	var found int64
	if err := conn.Table("questions").Where("id = ? AND module_id = ? AND kind = ? AND deleted_at IS NULL", dependsOn, moduleID, domain.KindPractical).Count(&found).Error; err != nil {
		return false, err
	}
	if found == 0 {
		return false, nil
	}
	if id == nil {
		return true, nil
	}
	if *id == dependsOn {
		return false, nil
	}
	var cycle int64
	err := conn.Raw(`WITH RECURSIVE chain AS (
            SELECT id, depends_on FROM questions WHERE id = ?
            UNION
            SELECT q.id, q.depends_on FROM questions q JOIN chain c ON q.id = c.depends_on
        ) SELECT COUNT(*) FROM chain WHERE id = ?`, dependsOn, *id).Scan(&cycle).Error
	return cycle == 0, err
}

// BankSetup returns the snapshot of the bank, or nil when the module has not recorded one (SPEC-023 11.2).
func (r *Repository) BankSetup(ctx context.Context, moduleID uuid.UUID) (json.RawMessage, error) {
	var row struct{ BankSetup []byte }
	if err := r.db.Conn(ctx).Raw("SELECT bank_setup FROM course_modules WHERE id = ?", moduleID).Scan(&row).Error; err != nil {
		return nil, err
	}
	if len(row.BankSetup) == 0 {
		return nil, nil
	}
	return json.RawMessage(row.BankSetup), nil
}

// SaveBankSetup replaces the snapshot of the bank.
func (r *Repository) SaveBankSetup(ctx context.Context, moduleID uuid.UUID, setup json.RawMessage) error {
	return r.db.Conn(ctx).Exec("UPDATE course_modules SET bank_setup = ?::jsonb WHERE id = ?", jsonOrNil(setup), moduleID).Error
}
