package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ListFilter narrows a list; an empty field matches everything.
type ListFilter struct {
	Phase  domain.Phase
	Status domain.Status
}

func (f ListFilter) matches(a domain.Assessment, now time.Time) bool {
	return (f.Phase == "" || a.PhaseAt(now) == f.Phase) && (f.Status == "" || a.Status == f.Status)
}

// Detail gives the teacher the whole assessment: the composition, the students and the history (RN-01, RN-15).
func (s *Service) Detail(ctx context.Context, actor Actor, classID, id uuid.UUID) (Detail, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Detail{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Detail{}, err
	}
	summary, err := s.summarize(ctx, a)
	if err != nil {
		return Detail{}, err
	}
	d := Detail{Summary: summary}

	items, err := s.repo.Items(ctx, a.ID)
	if err != nil {
		return Detail{}, err
	}
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.QuestionID
	}
	contents, err := s.ports.Questions.Contents(ctx, ids)
	if err != nil {
		return Detail{}, err
	}
	d.Items = make([]ItemView, len(items))
	for i, it := range items {
		c := contents[it.QuestionID]
		d.Items[i] = ItemView{Item: it, Title: c.Title, Kind: c.Kind, Difficulty: c.Difficulty}
	}
	if d.Rules, err = s.repo.Rules(ctx, a.ID); err != nil {
		return Detail{}, err
	}

	if a.Audience == domain.AudienceSelected {
		chosen, err := s.repo.StudentIDs(ctx, a.ID)
		if err != nil {
			return Detail{}, err
		}
		active, err := s.ports.Students.ActiveStudents(ctx, a.ClassID)
		if err != nil {
			return Detail{}, err
		}
		byID := make(map[uuid.UUID]Student, len(active))
		for _, st := range active {
			byID[st.ID] = st
		}
		for _, id := range chosen {
			if st, ok := byID[id]; ok {
				d.Students = append(d.Students, st)
			}
		}
	}

	events, err := s.repo.Events(ctx, a.ID)
	if err != nil {
		return Detail{}, err
	}
	actors := make([]uuid.UUID, len(events))
	for i, e := range events {
		actors[i] = e.ActorID
	}
	names, err := s.ports.Users.Names(ctx, actors)
	if err != nil {
		return Detail{}, err
	}
	d.Events = make([]EventView, len(events))
	for i, e := range events {
		d.Events[i] = EventView{Event: e, ActorName: names[e.ActorID]}
	}
	return d, nil
}

// Public gives the student the public form of an assessment she is eligible for, and no other: whoever is not eligible gets the same answer as
// for an assessment that does not exist (RN-08, RN-09).
func (s *Service) Public(ctx context.Context, actor Actor, classID, id uuid.UUID) (Public, error) {
	if err := s.studentOf(ctx, actor, classID); err != nil {
		return Public{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Public{}, err
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return Public{}, err
	}
	if !eligible[actor.UserID] {
		return Public{}, domain.ErrAssessmentNotFound
	}
	return publicOf(a, s.now()), nil
}

// List gives the teacher the assessments of the class, newest start first.
func (s *Service) List(ctx context.Context, actor Actor, classID uuid.UUID, filter ListFilter) ([]Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return nil, err
	}
	all, err := s.repo.ListByClass(ctx, classID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	out := make([]Summary, 0, len(all))
	for _, a := range all {
		if !filter.matches(a, now) {
			continue
		}
		sum, err := s.summarize(ctx, a)
		if err != nil {
			return nil, err
		}
		out = append(out, sum)
	}
	return out, nil
}

// ListPublic gives the student the assessments she is eligible for, in the public form.
func (s *Service) ListPublic(ctx context.Context, actor Actor, classID uuid.UUID, filter ListFilter) ([]Public, error) {
	if err := s.studentOf(ctx, actor, classID); err != nil {
		return nil, err
	}
	all, err := s.repo.ListByClass(ctx, classID)
	if err != nil {
		return nil, err
	}
	return s.publicOf(ctx, actor.UserID, all, filter)
}

// publicOf keeps the assessments of the list the student is eligible for, in the public form.
func (s *Service) publicOf(ctx context.Context, student uuid.UUID, list []domain.Assessment, filter ListFilter) ([]Public, error) {
	now := s.now()
	out := make([]Public, 0, len(list))
	for _, a := range list {
		if !filter.matches(a, now) {
			continue
		}
		eligible, err := s.eligible(ctx, a)
		if err != nil {
			return nil, err
		}
		if eligible[student] {
			out = append(out, publicOf(a, now))
		}
	}
	return out, nil
}

// Preview shows the teacher the whole assessment: every question with its statement and answer key, in any phase; for a draw, the rules, the
// stock and a sample that is not stored (RN-16).
func (s *Service) Preview(ctx context.Context, actor Actor, classID, id uuid.UUID) (Preview, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Preview{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return Preview{}, err
	}
	var p Preview
	if a.Composition == domain.CompositionDraw {
		if p.Rules, err = s.repo.Rules(ctx, a.ID); err != nil {
			return Preview{}, err
		}
		page, err := s.ports.Questions.Pool(ctx, QuestionFilter{ModuleID: a.ModuleID, PageSize: 1})
		if err != nil {
			return Preview{}, err
		}
		p.Stock = page.Stock
		for _, r := range p.Rules {
			drawn, err := s.ports.Questions.Sample(ctx, a.ModuleID, r.Difficulty, r.Quantity)
			if err != nil {
				return Preview{}, err
			}
			p.Sample = append(p.Sample, drawn...)
		}
		return p, nil
	}
	items, err := s.repo.Items(ctx, a.ID)
	if err != nil {
		return Preview{}, err
	}
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.QuestionID
	}
	contents, err := s.ports.Questions.Contents(ctx, ids)
	if err != nil {
		return Preview{}, err
	}
	p.Questions = make([]PreviewQuestion, len(items))
	for i, it := range items {
		p.Questions[i] = PreviewQuestion{Position: it.Position, Weight: it.Weight, QuestionContent: contents[it.QuestionID]}
	}
	return p, nil
}

// PreviewQuestion is a question of the preview with its place and its weight.
type PreviewQuestion struct {
	Position int
	Weight   domain.Score
	QuestionContent
}

// Preview is the whole assessment for the teacher (RN-16).
type Preview struct {
	Questions []PreviewQuestion
	Rules     []domain.DrawRule
	Stock     map[domain.Difficulty]int
	Sample    []QuestionContent
}

// EligibleQuestions gives the teacher the questions she can pick from and the stock by level, for a module assigned to the class (RN-05, RN-07).
func (s *Service) EligibleQuestions(ctx context.Context, actor Actor, classID uuid.UUID, filter QuestionFilter) (QuestionPage, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return QuestionPage{}, err
	}
	if _, ok, err := s.ports.Modules.ModuleOfClass(ctx, classID, filter.ModuleID); err != nil {
		return QuestionPage{}, err
	} else if !ok {
		return QuestionPage{}, domain.ErrModuleNotAssigned
	}
	return s.ports.Questions.Pool(ctx, filter)
}

// CalendarResult is what the calendar takes from the assessments: the summaries for the teacher and the administrator, the public form for the
// student (RN-17).
type CalendarResult struct {
	Summaries []Summary
	Public    []Public
}

// Calendar gives the assessments whose period crosses the days from to to, inclusive, for the classes the actor may see: the teacher the ones she
// owns, the administrator all, the student the ones where she has an ACTIVE enrollment, with only what she is eligible for (RN-17).
func (s *Service) Calendar(ctx context.Context, actor Actor, classIDs []uuid.UUID, from, to time.Time) (CalendarResult, error) {
	first, last := dayStart(from, 0), dayStart(to, 1)

	visible, err := s.visibleClasses(ctx, actor, classIDs)
	if err != nil {
		return CalendarResult{}, err
	}
	var res CalendarResult
	if len(visible) == 0 {
		return res, nil
	}
	list, err := s.repo.ListInRange(ctx, visible, first, last)
	if err != nil {
		return CalendarResult{}, err
	}
	if actor.Role == authn.RoleStudent {
		res.Public, err = s.publicOf(ctx, actor.UserID, list, ListFilter{})
		return res, err
	}
	for _, a := range list {
		sum, err := s.summarize(ctx, a)
		if err != nil {
			return CalendarResult{}, err
		}
		res.Summaries = append(res.Summaries, sum)
	}
	return res, nil
}

// dayStart is midnight, in Brasília, of the day of t plus the given number of days.
func dayStart(t time.Time, plusDays int) time.Time {
	y, m, d := t.In(domain.Location()).Date()
	return time.Date(y, m, d+plusDays, 0, 0, 0, 0, domain.Location())
}

// visibleClasses keeps the classes of the request the actor may see: the administrator all of them, the teacher the ones she owns, the student the
// ones where she is active. A class that does not exist is left out.
func (s *Service) visibleClasses(ctx context.Context, actor Actor, classIDs []uuid.UUID) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for _, id := range classIDs {
		class, err := s.ports.Classes.Class(ctx, id)
		if err != nil {
			if errors.Is(err, domain.ErrClassNotFound) {
				continue
			}
			return nil, err
		}
		switch actor.Role {
		case authn.RoleAdmin:
			out = append(out, id)
		case authn.RoleTeacher:
			if class.TeacherID == actor.UserID {
				out = append(out, id)
			}
		case authn.RoleStudent:
			active, err := s.activeSet(ctx, id)
			if err != nil {
				return nil, err
			}
			if active[actor.UserID] {
				out = append(out, id)
			}
		}
	}
	return out, nil
}

// AccessOf says whether a student may enter the assessment now (RN-14). It is what the attempts will ask: ALLOWED only for an eligible student
// with the assessment SCHEDULED and RUNNING; otherwise the reason, by this order: not eligible, canceled, not open yet, ended.
func (s *Service) AccessOf(ctx context.Context, studentID, id uuid.UUID) (domain.Access, error) {
	a, err := s.repo.Find(ctx, id)
	if err != nil {
		return "", err
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return "", err
	}
	return s.accessFor(ctx, a, studentID, eligible)
}

// accessFor is the decision of AccessOf for one student (SPEC-076 RN-08, SPEC-083 RN-05). The reasons come in this order: not eligible, canceled,
// not open yet, ended, not started and, last, not cleared.
func (s *Service) accessFor(ctx context.Context, a domain.Assessment, studentID uuid.UUID, eligible map[uuid.UUID]bool) (domain.Access, error) {
	switch {
	case !eligible[studentID]:
		return domain.AccessNotEligible, nil
	case a.Status == domain.StatusCanceled:
		return domain.AccessCanceled, nil
	}
	switch a.PhaseAt(s.now()) {
	case domain.PhaseUpcoming:
		return domain.AccessNotOpenYet, nil
	case domain.PhaseEnded:
		return domain.AccessEnded, nil
	}
	if a.Modality == domain.ModalityInPerson && a.StartedAt == nil {
		return domain.AccessNotStarted, nil
	}
	if !a.RequiresClearance {
		return domain.AccessAllowed, nil
	}
	row, err := s.clearanceOf(ctx, a.ID, studentID)
	if err != nil {
		return "", err
	}
	if row == nil || row.Status != domain.ClearanceApproved {
		return domain.AccessNotCleared, nil
	}
	return domain.AccessAllowed, nil
}

// InScheduledAssessment tells the bank of questions whether a SCHEDULED manual assessment lists the question, so the bank refuses to take it away
// (RN-18).
func (s *Service) InScheduledAssessment(ctx context.Context, questionID uuid.UUID) (bool, error) {
	return s.repo.InScheduledManual(ctx, questionID)
}

// DrawDemand tells the bank of questions the biggest quantity of each level that a SCHEDULED draw of the module asks for, with the levels in the
// words of the bank, so the bank keeps the stock a scheduled draw needs (RN-18).
func (s *Service) DrawDemand(ctx context.Context, moduleID uuid.UUID) (map[string]int, error) {
	demand, err := s.repo.DrawDemand(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(demand))
	for level, n := range demand {
		out[string(level)] = n
	}
	return out, nil
}
