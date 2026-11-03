package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// The clearance of the students (SPEC-076) no longer decides who enters: since SPEC-091 RN-03 the start of the teacher is enough. The decisions
// stored before stay in the database, unused (D-02); only the counters of the summary still read them.

// ClearanceCounts are the eligible students by state (SPEC-076 RN-13).
type ClearanceCounts struct{ Pending, Approved, Rejected int }

// MyAccess is what a student gets about their own access to an assessment (SPEC-076 RN-09, SPEC-091 RN-03).
type MyAccess struct {
	Allowed  bool
	Reason   domain.Access
	Modality domain.Modality
}

// clearanceRows gives the decisions of the assessment by student.
func (s *Service) clearanceRows(ctx context.Context, id uuid.UUID) (map[uuid.UUID]domain.Clearance, error) {
	rows, err := s.repo.Clearances(ctx, id)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]domain.Clearance, len(rows))
	for _, row := range rows {
		out[row.StudentID] = row
	}
	return out, nil
}

// clearanceCounts counts the eligible students by state; the decision about who is not eligible is not counted (RN-05).
func (s *Service) clearanceCounts(ctx context.Context, a domain.Assessment, eligible map[uuid.UUID]bool) (ClearanceCounts, error) {
	rows, err := s.clearanceRows(ctx, a.ID)
	if err != nil {
		return ClearanceCounts{}, err
	}
	var counts ClearanceCounts
	for id := range eligible {
		switch rows[id].Status {
		case domain.ClearanceApproved:
			counts.Approved++
		case domain.ClearanceRejected:
			counts.Rejected++
		default:
			counts.Pending++
		}
	}
	return counts, nil
}

// MyAccess gives the student their own access to the assessment: whether they may enter, why and the modality (SPEC-076 RN-09, SPEC-091 RN-03).
// Whoever is not eligible does not find the assessment.
func (s *Service) MyAccess(ctx context.Context, actor Actor, classID, id uuid.UUID) (MyAccess, error) {
	if err := s.studentOf(ctx, actor, classID); err != nil {
		return MyAccess{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return MyAccess{}, err
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return MyAccess{}, err
	}
	if !eligible[actor.UserID] {
		return MyAccess{}, domain.ErrAssessmentNotFound
	}
	access, err := s.accessFor(ctx, a, actor.UserID, eligible)
	if err != nil {
		return MyAccess{}, err
	}
	return MyAccess{Allowed: access == domain.AccessAllowed, Reason: access, Modality: a.Modality}, nil
}
