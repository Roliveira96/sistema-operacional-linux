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

// ListExercises returns the exercises of the bank: the available ones in the order of the trail, then the reserved ones.
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

// CreateExercise inserts the question.
func (r *Repository) CreateExercise(ctx context.Context, q *domain.Question) error {
	return r.db.Conn(ctx).Create(q).Error
}

// UpdateExercise writes the fields the teacher edits. expected guards against a concurrent change.
func (r *Repository) UpdateExercise(ctx context.Context, moduleID, id uuid.UUID, upd service.ExerciseUpdate, expected *time.Time) (service.ExerciseRecord, error) {
	e := upd.Exercise
	q := r.db.Conn(ctx).Model(&domain.Question{}).Where("id = ? AND module_id = ? AND kind = ?", id, moduleID, domain.KindPractical)
	if expected != nil {
		q = q.Where("updated_at = ?", expected.UTC())
	}
	fields := map[string]any{
		"title": e.Title, "difficulty": e.Difficulty, "statement": e.Statement, "hints": jsonOrNil(e.Hints),
		"reference_solution": jsonOrNil(e.Solution), "end_conditions": jsonOrNil(e.EndConditions), "validation_conditions": string(upd.Catalog),
		"edited_by_teacher_at": upd.Now, "updated_at": upd.Now, "updated_by": upd.By,
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

// SetAvailability changes the set and the publication of an exercise: available means a place at the end of the trail, reserved
// means no place (SPEC-023 RN-03).
func (r *Repository) SetAvailability(ctx context.Context, moduleID, id uuid.UUID, usage, status string, now time.Time) (service.ExerciseRecord, error) {
	err := r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		conn := r.db.Conn(ctx)
		res := conn.Model(&domain.Question{}).Where("id = ? AND module_id = ? AND kind = ?", id, moduleID, domain.KindPractical).
			Updates(map[string]any{"usage": usage, "status": status, "updated_at": now})
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
		case usage == domain.UsageExercise && inTrail == 0:
			var last int
			if err := conn.Table("module_exercise_items").Where("module_id = ?", moduleID).Select("COALESCE(MAX(sequence_order), 0)").Scan(&last).Error; err != nil {
				return err
			}
			return conn.Exec(`INSERT INTO module_exercise_items (id, module_id, exercise_id, sequence_order, is_mandatory, created_at, updated_at)
                VALUES (?, ?, ?, ?, true, ?, ?)`, uuid.New(), moduleID, id, last+1, now, now).Error
		case usage == domain.UsageAssessment && inTrail > 0:
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

// DeleteExercise removes the exercise (logically), its place in the trail and the progress of the students in it (SPEC-023 RN-09).
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

// ExerciseSetups returns the snapshots of the two sets, nil for the one the module has not recorded.
func (r *Repository) ExerciseSetups(ctx context.Context, moduleID uuid.UUID) (exercises, assessment json.RawMessage, err error) {
	var row struct{ ExercisesSetup, AssessmentSetup []byte }
	if err := r.db.Conn(ctx).Raw("SELECT exercises_setup, assessment_setup FROM course_modules WHERE id = ?", moduleID).Scan(&row).Error; err != nil {
		return nil, nil, err
	}
	if len(row.ExercisesSetup) > 0 {
		exercises = json.RawMessage(row.ExercisesSetup)
	}
	if len(row.AssessmentSetup) > 0 {
		assessment = json.RawMessage(row.AssessmentSetup)
	}
	return exercises, assessment, nil
}

// SaveExerciseSetups replaces the snapshots of the two sets.
func (r *Repository) SaveExerciseSetups(ctx context.Context, moduleID uuid.UUID, exercises, assessment json.RawMessage) error {
	return r.db.Conn(ctx).Exec("UPDATE course_modules SET exercises_setup = ?::jsonb, assessment_setup = ?::jsonb WHERE id = ?",
		jsonOrNil(exercises), jsonOrNil(assessment), moduleID).Error
}
