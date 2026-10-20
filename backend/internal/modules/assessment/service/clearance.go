package service

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// ClearanceAction is what the teacher does in one go (SPEC-076 RN-06).
type ClearanceAction string

const (
	// ClearanceApproveAll clears everybody who is waiting and leaves the refused as they are (D-04).
	ClearanceApproveAll ClearanceAction = "APPROVE_ALL"
	// ClearanceUpdate decides student by student.
	ClearanceUpdate ClearanceAction = "UPDATE"
)

// ClearanceDecision is the new state of one student in an update: cleared or refused, with the optional reason of the refusal.
type ClearanceDecision struct {
	StudentID uuid.UUID
	Status    domain.ClearanceStatus
	Reason    string
}

// ClearanceInput is what the teacher sends: the action and, for an update, the students.
type ClearanceInput struct {
	Action   ClearanceAction
	Students []ClearanceDecision
}

// ClearanceCounts are the eligible students by state (RN-13).
type ClearanceCounts struct{ Pending, Approved, Rejected int }

// ClearanceItem is an eligible student with the state of the clearance. Only who was decided has a moment and a name of who decided.
type ClearanceItem struct {
	StudentID       uuid.UUID
	Name            string
	AcademicID      string
	Status          domain.ClearanceStatus
	RejectionReason *string
	ClearedAt       *time.Time
	ClearedByName   string
}

// ClearanceList is what the teacher reads: whether the assessment requires the clearance, the eligible students by name, and the counters.
type ClearanceList struct {
	RequiresClearance bool
	Items             []ClearanceItem
	Counts            ClearanceCounts
}

// OwnClearance is the state of the student who asks, and nobody else's (RN-10).
type OwnClearance struct {
	Status          domain.ClearanceStatus
	RejectionReason *string
}

// MyAccess is what a student gets about their own access to an assessment (RN-09).
type MyAccess struct {
	Allowed           bool
	Reason            domain.Access
	Modality          domain.Modality
	RequiresClearance bool
	// Clearance is only there when the assessment requires the clearance.
	Clearance *OwnClearance
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

// clearanceOf gives the decision about one student, or nil while they are waiting.
func (s *Service) clearanceOf(ctx context.Context, assessmentID, studentID uuid.UUID) (*domain.Clearance, error) {
	rows, err := s.clearanceRows(ctx, assessmentID)
	if err != nil {
		return nil, err
	}
	if row, ok := rows[studentID]; ok {
		return &row, nil
	}
	return nil, nil
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

// clearanceList builds what the teacher reads from the students and the decisions of the moment.
func (s *Service) clearanceList(ctx context.Context, a domain.Assessment) (ClearanceList, error) {
	students, err := s.ports.Students.ActiveStudents(ctx, a.ClassID)
	if err != nil {
		return ClearanceList{}, err
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return ClearanceList{}, err
	}
	rows, err := s.clearanceRows(ctx, a.ID)
	if err != nil {
		return ClearanceList{}, err
	}
	var by []uuid.UUID
	for _, row := range rows {
		by = append(by, row.ClearedBy)
	}
	names, err := s.ports.Users.Names(ctx, by)
	if err != nil {
		return ClearanceList{}, err
	}

	list := ClearanceList{RequiresClearance: a.RequiresClearance, Items: []ClearanceItem{}}
	for _, st := range students {
		if !eligible[st.ID] {
			continue
		}
		item := ClearanceItem{StudentID: st.ID, Name: st.Name, AcademicID: st.AcademicID, Status: domain.ClearancePending}
		if row, ok := rows[st.ID]; ok {
			at := row.ClearedAt
			item.Status, item.RejectionReason, item.ClearedAt, item.ClearedByName = row.Status, row.RejectionReason, &at, names[row.ClearedBy]
		}
		switch item.Status {
		case domain.ClearanceApproved:
			list.Counts.Approved++
		case domain.ClearanceRejected:
			list.Counts.Rejected++
		default:
			list.Counts.Pending++
		}
		list.Items = append(list.Items, item)
	}
	sort.SliceStable(list.Items, func(i, j int) bool {
		return strings.ToLower(list.Items[i].Name) < strings.ToLower(list.Items[j].Name)
	})
	return list, nil
}

// Clearances lists the eligible students with the state of the clearance (RN-04, RN-05, RN-10): only the teacher of the class and the administrator
// read it, in any phase, so the screen can say why there is nothing to decide.
func (s *Service) Clearances(ctx context.Context, actor Actor, classID, id uuid.UUID) (ClearanceList, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return ClearanceList{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return ClearanceList{}, err
	}
	return s.clearanceList(ctx, a)
}

// Decide applies an action of the teacher on the clearance (RN-06, RN-07, RN-11, RN-12): it needs the assessment SCHEDULED, not ended, in person and
// requiring the clearance; everything is checked before anything is written; and the action is one event of the history.
func (s *Service) Decide(ctx context.Context, actor Actor, classID, id uuid.UUID, in ClearanceInput) (ClearanceList, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return ClearanceList{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return ClearanceList{}, err
	}
	now := s.now()
	switch {
	case a.Status == domain.StatusCanceled:
		return ClearanceList{}, domain.ErrAssessmentCanceled
	case a.PhaseAt(now) == domain.PhaseEnded:
		return ClearanceList{}, domain.ErrAssessmentEnded
	case a.Modality != domain.ModalityInPerson || !a.RequiresClearance:
		return ClearanceList{}, domain.ErrClearanceNotRequired
	}

	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return ClearanceList{}, err
	}
	rows, err := s.clearanceRows(ctx, a.ID)
	if err != nil {
		return ClearanceList{}, err
	}

	var changes []domain.Clearance
	switch in.Action {
	case ClearanceApproveAll:
		for student := range eligible {
			if _, decided := rows[student]; !decided {
				changes = append(changes, domain.Clearance{StudentID: student, Status: domain.ClearanceApproved})
			}
		}
	case ClearanceUpdate:
		if changes, err = checkDecisions(in.Students); err != nil {
			return ClearanceList{}, err
		}
		for _, c := range changes {
			if !eligible[c.StudentID] {
				return ClearanceList{}, domain.ErrStudentNotInClass
			}
		}
	default:
		return ClearanceList{}, domain.ErrInvalidClearance
	}

	// who already started the attempt is out of the teacher's hands (RN-07)
	for _, c := range changes {
		started, err := s.ports.Attempts.HasStarted(ctx, a.ID, c.StudentID)
		if err != nil {
			return ClearanceList{}, err
		}
		if started {
			return ClearanceList{}, domain.ErrClearanceLocked
		}
	}

	if len(changes) > 0 {
		for i := range changes {
			changes[i].ClearedBy, changes[i].ClearedAt = actor.UserID, now
		}
		event := domain.Event{Kind: domain.EventClearanceUpdated, ActorID: actor.UserID, CreatedAt: now, ChangedFields: []string{"clearances"}}
		if err := s.repo.SaveClearances(ctx, a.ID, changes, event); err != nil {
			return ClearanceList{}, err
		}
	}
	return s.clearanceList(ctx, a)
}

// checkDecisions validates the list of an update (RN-06): not empty, no student twice, each one cleared or refused, and the reason only on a refusal.
func checkDecisions(sent []ClearanceDecision) ([]domain.Clearance, error) {
	if len(sent) == 0 {
		return nil, domain.ErrInvalidClearance
	}
	seen := make(map[uuid.UUID]bool, len(sent))
	out := make([]domain.Clearance, len(sent))
	for i, d := range sent {
		if seen[d.StudentID] {
			return nil, domain.ErrInvalidClearance
		}
		seen[d.StudentID] = true
		reason, err := domain.CleanClearanceReason(d.Status, d.Reason)
		if err != nil {
			return nil, err
		}
		out[i] = domain.Clearance{StudentID: d.StudentID, Status: d.Status, RejectionReason: reason}
	}
	return out, nil
}

// MyAccess gives the student their own access to the assessment: whether they may enter, why, the modality and, when the assessment requires it,
// their own state of the clearance (RN-09, RN-10). Whoever is not eligible does not find the assessment.
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
	out := MyAccess{Allowed: access == domain.AccessAllowed, Reason: access, Modality: a.Modality, RequiresClearance: a.RequiresClearance}
	if a.RequiresClearance {
		row, err := s.clearanceOf(ctx, a.ID, actor.UserID)
		if err != nil {
			return MyAccess{}, err
		}
		own := OwnClearance{Status: domain.ClearancePending}
		if row != nil {
			own = OwnClearance{Status: row.Status, RejectionReason: row.RejectionReason}
		}
		out.Clearance = &own
	}
	return out, nil
}
