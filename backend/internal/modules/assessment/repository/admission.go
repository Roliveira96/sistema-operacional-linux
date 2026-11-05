package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Admit stores the admission of the students by the teacher, ignoring who was already admitted, and gives back who was admitted now (SPEC-096 RN-01).
func (r *Repository) Admit(ctx context.Context, assessmentID uuid.UUID, students []uuid.UUID, at time.Time, by uuid.UUID) ([]uuid.UUID, error) {
	added := []uuid.UUID{}
	for _, s := range students {
		var got []uuid.UUID
		err := r.db.Conn(ctx).Raw(`INSERT INTO assessment_admissions (assessment_id, student_id, admitted_at, admitted_by) VALUES (?, ?, ?, ?)
			ON CONFLICT (assessment_id, student_id) DO NOTHING RETURNING student_id`, assessmentID, s, at, by).Scan(&got).Error
		if err != nil {
			return nil, err
		}
		added = append(added, got...)
	}
	return added, nil
}

// Admitted gives the students the teacher admitted to the exam (SPEC-096 RN-01).
func (r *Repository) Admitted(ctx context.Context, assessmentID uuid.UUID) (map[uuid.UUID]bool, error) {
	var ids []uuid.UUID
	if err := r.db.Conn(ctx).Raw(`SELECT student_id FROM assessment_admissions WHERE assessment_id = ?`, assessmentID).Scan(&ids).Error; err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}
