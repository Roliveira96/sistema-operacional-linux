package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// UpdateInput is what the teacher changes. A field left nil is not changed; the dates have their own operation (RN-11).
type UpdateInput struct {
	Title, Description *string
	ModuleID           *uuid.UUID
	Type               *domain.Type
	MaxScore           *domain.Score
	DurationMinutes    *int
	Composition        *domain.Composition
	Items              *[]domain.Item
	Draw               *Draw
	Audience           *domain.Audience
	StudentIDs         *[]uuid.UUID
	// the modality and the requirement are part of what freezes at the start (SPEC-076 RN-03)
	Modality          *domain.Modality
	RequiresClearance *bool
}

// Update changes the configuration of an assessment (RN-10, RN-15). From the start on, the composition is frozen: only the title, the
// instructions and a wider audience change. Every change is checked again as a whole.
func (s *Service) Update(ctx context.Context, actor Actor, classID, id uuid.UUID, in UpdateInput) (Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Summary{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Summary{}, err
	}
	if a.Status == domain.StatusCanceled {
		return Summary{}, domain.ErrAssessmentCanceled
	}
	now := s.now()
	composes := in.ModuleID != nil || in.Type != nil || in.MaxScore != nil || in.DurationMinutes != nil || in.Composition != nil ||
		in.Items != nil || in.Draw != nil || in.Modality != nil || in.RequiresClearance != nil
	if composes && a.Frozen(now) {
		return Summary{}, domain.ErrAssessmentFrozen
	}

	n := a
	var changed []string
	if in.Title != nil {
		n.Title = strings.TrimSpace(*in.Title)
		changed = append(changed, "title")
	}
	if in.Description != nil {
		n.Description = s.instructions(*in.Description)
		changed = append(changed, "description")
	}
	if in.Type != nil {
		n.Type = *in.Type
		changed = append(changed, "type")
	}
	if in.MaxScore != nil {
		n.MaxScore = *in.MaxScore
		changed = append(changed, "max_score")
	}
	if in.Modality != nil {
		n.Modality = *in.Modality
		changed = append(changed, "modality")
	}
	if in.RequiresClearance != nil {
		n.RequiresClearance = *in.RequiresClearance
		changed = append(changed, "requires_clearance")
	}
	if in.DurationMinutes != nil {
		n.DurationMinutes = in.DurationMinutes
		changed = append(changed, "duration")
	}
	if in.ModuleID != nil {
		if _, ok, err := s.ports.Modules.ModuleOfClass(ctx, classID, *in.ModuleID); err != nil {
			return Summary{}, err
		} else if !ok {
			return Summary{}, domain.ErrModuleNotAssigned
		}
		n.ModuleID = *in.ModuleID
		changed = append(changed, "module")
	}
	if in.Composition != nil {
		n.Composition = *in.Composition
		changed = append(changed, "composition")
	}
	if in.Type != nil {
		if err := domain.ValidatePeriod(n.Type, n.StartsAt, n.EndsAt, now); err != nil {
			return Summary{}, err
		}
	}
	if err := n.Validate(); err != nil {
		return Summary{}, err
	}

	var rep Replacements
	if in.ModuleID != nil || in.MaxScore != nil || in.Composition != nil || in.Items != nil || in.Draw != nil {
		composition, err := s.recompose(ctx, a, &n, in)
		if err != nil {
			return Summary{}, err
		}
		rep.Items, rep.Rules = composition.items, composition.rules
		if in.Items != nil {
			changed = append(changed, "items")
		}
		if in.Draw != nil {
			changed = append(changed, "draw")
		}
	}

	if in.Audience != nil || in.StudentIDs != nil {
		audience := a.Audience
		if in.Audience != nil {
			audience = *in.Audience
		}
		students, err := s.reaudience(ctx, a, audience, in.StudentIDs, a.Frozen(now))
		if err != nil {
			return Summary{}, err
		}
		n.Audience = audience
		rep.Students = &students
		if in.Audience != nil {
			changed = append(changed, "audience")
		}
		if in.StudentIDs != nil {
			changed = append(changed, "students")
		}
	}

	if len(changed) == 0 {
		return s.summarize(ctx, a)
	}
	n.UpdatedBy, n.UpdatedAt = actor.UserID, now
	event := domain.Event{Kind: domain.EventUpdated, ActorID: actor.UserID, CreatedAt: now, ChangedFields: changed}
	if err := s.repo.Save(ctx, &n, rep, &event); err != nil {
		return Summary{}, err
	}
	return s.summarize(ctx, n)
}

type composition struct {
	items *[]domain.Item
	rules *[]domain.DrawRule
}

// recompose checks the whole composition against the new values (RN-05 to RN-07) and says what a save must replace. The part that was not sent
// is the one stored; changing the composition from one kind to the other needs the new part.
func (s *Service) recompose(ctx context.Context, old domain.Assessment, n *domain.Assessment, in UpdateInput) (composition, error) {
	switch n.Composition {
	case domain.CompositionManual:
		if in.Draw != nil {
			return composition{}, domain.ErrInvalidAssessment
		}
		sent := []domain.Item(nil)
		switch {
		case in.Items != nil:
			sent = *in.Items
		case old.Composition == domain.CompositionManual:
			stored, err := s.repo.Items(ctx, old.ID)
			if err != nil {
				return composition{}, err
			}
			sent = stored
		default:
			return composition{}, domain.ErrInvalidAssessment
		}
		items, err := s.checkManual(ctx, n.ModuleID, n.MaxScore, sent)
		if err != nil {
			return composition{}, err
		}
		n.DrawTotal = nil
		if in.Items == nil && old.Composition == domain.CompositionManual {
			return composition{}, nil
		}
		return composition{items: &items, rules: &[]domain.DrawRule{}}, nil

	case domain.CompositionDraw:
		if in.Items != nil {
			return composition{}, domain.ErrInvalidAssessment
		}
		var draw Draw
		switch {
		case in.Draw != nil:
			draw = *in.Draw
		case old.Composition == domain.CompositionDraw && old.DrawTotal != nil:
			stored, err := s.repo.Rules(ctx, old.ID)
			if err != nil {
				return composition{}, err
			}
			draw = Draw{Total: *old.DrawTotal, Rules: stored}
		default:
			return composition{}, domain.ErrInvalidAssessment
		}
		if err := s.checkDraw(ctx, n.ModuleID, n.MaxScore, draw); err != nil {
			return composition{}, err
		}
		total := draw.Total
		n.DrawTotal = &total
		if in.Draw == nil && old.Composition == domain.CompositionDraw {
			return composition{}, nil
		}
		return composition{items: &[]domain.Item{}, rules: &draw.Rules}, nil
	}
	return composition{}, domain.ErrInvalidAssessment
}

// reaudience checks the new audience and gives the list of students to store. Once the assessment started, the audience can only grow: a student
// who was eligible stays eligible (RN-10).
func (s *Service) reaudience(ctx context.Context, old domain.Assessment, audience domain.Audience, sent *[]uuid.UUID, frozen bool) ([]uuid.UUID, error) {
	stored, err := s.repo.StudentIDs(ctx, old.ID)
	if err != nil {
		return nil, err
	}
	var list []uuid.UUID
	switch {
	case sent != nil:
		list = *sent
	case audience == domain.AudienceSelected:
		list = stored
	}
	students, err := s.checkAudience(ctx, old.ClassID, audience, list)
	if err != nil {
		return nil, err
	}
	if frozen && narrows(old.Audience, stored, audience, students) {
		return nil, domain.ErrAssessmentFrozen
	}
	if students == nil {
		students = []uuid.UUID{}
	}
	return students, nil
}

// narrows tells whether the new audience leaves out someone who was in the old one.
func narrows(oldAudience domain.Audience, oldStudents []uuid.UUID, audience domain.Audience, students []uuid.UUID) bool {
	if audience != domain.AudienceSelected {
		return false
	}
	if oldAudience == domain.AudienceAllClass {
		return true
	}
	kept := make(map[uuid.UUID]bool, len(students))
	for _, id := range students {
		kept[id] = true
	}
	for _, id := range oldStudents {
		if !kept[id] {
			return true
		}
	}
	return false
}

// RescheduleInput is the new period, with the reason (RN-11).
type RescheduleInput struct {
	StartsAt, EndsAt time.Time
	Reason           string
}

// Reschedule moves the assessment by the rules of its phase and keeps the old and the new dates in the history (RN-11, RN-15).
func (s *Service) Reschedule(ctx context.Context, actor Actor, classID, id uuid.UUID, in RescheduleInput) (Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Summary{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Summary{}, err
	}
	now := s.now()
	if err := domain.CheckReschedule(a, now, in.StartsAt, in.EndsAt, in.Reason); err != nil {
		return Summary{}, err
	}
	n := a
	n.StartsAt, n.EndsAt = in.StartsAt, in.EndsAt
	if err := n.Validate(); err != nil { // the duration of each student must still fit the new period
		return Summary{}, err
	}
	n.UpdatedBy, n.UpdatedAt = actor.UserID, now
	oldStart, oldEnd, newStart, newEnd := a.StartsAt, a.EndsAt, n.StartsAt, n.EndsAt
	event := domain.Event{
		Kind: domain.EventRescheduled, ActorID: actor.UserID, CreatedAt: now,
		OldStartsAt: &oldStart, OldEndsAt: &oldEnd, NewStartsAt: &newStart, NewEndsAt: &newEnd,
	}
	if reason := strings.TrimSpace(in.Reason); reason != "" {
		event.Reason = &reason
	}
	if err := s.repo.Save(ctx, &n, Replacements{}, &event); err != nil {
		return Summary{}, err
	}
	return s.summarize(ctx, n)
}

// Cancel cancels the assessment with a reason that the class reads (RN-12). It is final, and the lesson it came from is left as it was.
func (s *Service) Cancel(ctx context.Context, actor Actor, classID, id uuid.UUID, reason string) (Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Summary{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Summary{}, err
	}
	if a.Status == domain.StatusCanceled {
		return Summary{}, domain.ErrAssessmentCanceled
	}
	reason, err = domain.CleanReason(reason)
	if err != nil {
		return Summary{}, err
	}
	graded, err := s.ports.Homologation.HasHomologated(ctx, a.ID)
	if err != nil {
		return Summary{}, err
	}
	if graded {
		return Summary{}, domain.ErrGradesHomologated
	}
	now := s.now()
	a.Status, a.CancelReason, a.CanceledBy, a.CanceledAt = domain.StatusCanceled, &reason, &actor.UserID, &now
	a.UpdatedBy, a.UpdatedAt = actor.UserID, now
	event := domain.Event{Kind: domain.EventCanceled, ActorID: actor.UserID, CreatedAt: now, Reason: &reason}
	if err := s.repo.Save(ctx, &a, Replacements{}, &event); err != nil {
		return Summary{}, err
	}
	return s.summarize(ctx, a)
}

// SaveNotes saves the private notes in any phase and status, without counting as a change of the assessment (RN-13). An empty text clears them.
func (s *Service) SaveNotes(ctx context.Context, actor Actor, classID, id uuid.UUID, notes string) (string, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return "", err
	}
	if _, err := s.assessmentOf(ctx, classID, id); err != nil {
		return "", err
	}
	clean, err := domain.CleanNotes(notes)
	if err != nil {
		return "", err
	}
	var stored *string
	if clean != "" {
		stored = &clean
	}
	if err := s.repo.SaveNotes(ctx, id, stored); err != nil {
		return "", err
	}
	return clean, nil
}
