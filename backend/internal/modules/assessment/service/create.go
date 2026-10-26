package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Draw is the draw of the questions: the total and a rule for each level (RN-07).
type Draw struct {
	Total int
	Rules []domain.DrawRule
}

// CreateInput is what the teacher sends to schedule an assessment (SPEC-075 section 5.2). With ClassSessionID, the module, the title and the
// period that were not sent come from the lesson (RN-04).
type CreateInput struct {
	ClassSessionID, ModuleID *uuid.UUID
	Title, Description       string
	Type                     domain.Type
	MaxScore                 domain.Score
	DurationMinutes          *int
	StartsAt, EndsAt         *time.Time
	Composition              domain.Composition
	Items                    []domain.Item
	Draw                     *Draw
	Audience                 domain.Audience
	StudentIDs               []uuid.UUID
	PrivateNotes             *string
	// Modality and RequiresClearance follow the type when they are not sent: an exam is in person and requires the clearance, an assignment is
	// online (SPEC-076 RN-01, RN-02).
	Modality          *domain.Modality
	RequiresClearance *bool
}

// Create schedules an assessment (RN-02 to RN-08, RN-15, RN-19).
func (s *Service) Create(ctx context.Context, actor Actor, classID uuid.UUID, in CreateInput) (Summary, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return Summary{}, err
	}
	now := s.now()

	title, moduleID, startsAt, endsAt := strings.TrimSpace(in.Title), in.ModuleID, in.StartsAt, in.EndsAt
	if in.ClassSessionID != nil {
		lesson, err := s.convertible(ctx, classID, *in.ClassSessionID)
		if err != nil {
			return Summary{}, err
		}
		if title == "" {
			title = strings.TrimSpace(lesson.Topic)
		}
		if moduleID == nil {
			moduleID = lesson.ModuleID
		}
		if startsAt == nil {
			startsAt = &lesson.StartsAt
		}
		if endsAt == nil {
			endsAt = &lesson.EndsAt
		}
	}
	if startsAt == nil || endsAt == nil {
		return Summary{}, domain.ErrInvalidPeriod
	}
	if moduleID == nil {
		return Summary{}, domain.ErrInvalidAssessment
	}
	if err := domain.ValidatePeriod(in.Type, *startsAt, *endsAt, now); err != nil {
		return Summary{}, err
	}
	if _, ok, err := s.ports.Modules.ModuleOfClass(ctx, classID, *moduleID); err != nil {
		return Summary{}, err
	} else if !ok {
		return Summary{}, domain.ErrModuleNotAssigned
	}

	audience := in.Audience
	if audience == "" {
		audience = domain.AudienceAllClass
	}
	modality := domain.DefaultModality(in.Type)
	if in.Modality != nil {
		modality = *in.Modality
	}
	requires := domain.DefaultRequiresClearance(modality)
	if in.RequiresClearance != nil {
		requires = *in.RequiresClearance
	}
	a := domain.Assessment{
		ClassID: classID, ModuleID: *moduleID, ClassSessionID: in.ClassSessionID, Title: title, Description: s.instructions(in.Description), Type: in.Type,
		Status: domain.StatusScheduled, Modality: modality, RequiresClearance: requires, MaxScore: in.MaxScore, DurationMinutes: in.DurationMinutes,
		StartsAt: *startsAt, EndsAt: *endsAt, Composition: in.Composition, Audience: audience, CreatedBy: actor.UserID, UpdatedBy: actor.UserID,
	}
	a.CreatedAt, a.UpdatedAt = now, now
	if in.PrivateNotes != nil {
		notes, err := domain.CleanNotes(*in.PrivateNotes)
		if err != nil {
			return Summary{}, err
		}
		if notes != "" {
			a.TeacherPrivateNotes = &notes
		}
	}
	if err := a.Validate(); err != nil {
		return Summary{}, err
	}

	var items []domain.Item
	var rules []domain.DrawRule
	switch a.Composition {
	case domain.CompositionManual:
		if in.Draw != nil {
			return Summary{}, domain.ErrInvalidAssessment
		}
		var err error
		if items, err = s.checkManual(ctx, a.ModuleID, a.MaxScore, in.Items); err != nil {
			return Summary{}, err
		}
	case domain.CompositionDraw:
		if len(in.Items) > 0 || in.Draw == nil {
			return Summary{}, domain.ErrInvalidAssessment
		}
		if err := s.checkDraw(ctx, a.ModuleID, a.MaxScore, *in.Draw); err != nil {
			return Summary{}, err
		}
		total := in.Draw.Total
		a.DrawTotal, rules = &total, in.Draw.Rules
	}

	students, err := s.checkAudience(ctx, classID, a.Audience, in.StudentIDs)
	if err != nil {
		return Summary{}, err
	}

	event := domain.Event{Kind: domain.EventCreated, ActorID: actor.UserID, CreatedAt: now}
	if err := s.repo.Create(ctx, &a, items, rules, students, event); err != nil {
		return Summary{}, err
	}
	return s.summarize(ctx, a)
}

// convertible reads the lesson an assessment is made from and checks it (RN-04): it is of the class, it was not canceled and it has no active
// assessment yet. The lesson is read, never changed.
func (s *Service) convertible(ctx context.Context, classID, lessonID uuid.UUID) (Lesson, error) {
	lesson, err := s.ports.Lessons.Lesson(ctx, lessonID)
	if err != nil {
		return Lesson{}, err
	}
	if lesson.ClassID != classID {
		return Lesson{}, domain.ErrSessionNotFound
	}
	if lesson.Canceled {
		return Lesson{}, domain.ErrSessionNotConvertible
	}
	taken, err := s.repo.HasActiveForLesson(ctx, lessonID)
	if err != nil {
		return Lesson{}, err
	}
	if taken {
		return Lesson{}, domain.ErrSessionNotConvertible
	}
	return lesson, nil
}

// checkManual validates a manual composition and the eligibility of its questions (RN-05, RN-06), and gives the items in the order sent, with the
// places from 1.
func (s *Service) checkManual(ctx context.Context, moduleID uuid.UUID, max domain.Score, sent []domain.Item) ([]domain.Item, error) {
	if err := domain.ValidateManual(max, sent); err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, len(sent))
	items := make([]domain.Item, len(sent))
	for i, it := range sent {
		ids[i] = it.QuestionID
		items[i] = domain.Item{QuestionID: it.QuestionID, Position: i + 1, Weight: it.Weight}
	}
	ok, err := s.ports.Questions.Eligible(ctx, moduleID, ids)
	if err != nil {
		return nil, err
	}
	if len(ok) != len(ids) {
		return nil, domain.ErrQuestionNotEligible
	}
	return items, nil
}

// checkDraw validates a draw and the stock of the bank for it (RN-07): every level without enough questions is reported.
func (s *Service) checkDraw(ctx context.Context, moduleID uuid.UUID, max domain.Score, draw Draw) error {
	if err := domain.ValidateDraw(max, draw.Total, draw.Rules); err != nil {
		return err
	}
	page, err := s.ports.Questions.Pool(ctx, QuestionFilter{ModuleID: moduleID, PageSize: 1})
	if err != nil {
		return err
	}
	asked := make(map[domain.Difficulty]int, len(draw.Rules))
	for _, r := range draw.Rules {
		asked[r.Difficulty] = r.Quantity
	}
	var short []domain.Shortage
	for _, level := range domain.Levels {
		if asked[level] > page.Stock[level] {
			short = append(short, domain.Shortage{Difficulty: level, Asked: asked[level], Available: page.Stock[level]})
		}
	}
	if len(short) > 0 {
		return &domain.StockError{Short: short}
	}
	return nil
}

// checkAudience validates the audience and gives the ids to store (RN-08): none for ALL_CLASS, and for SELECTED a list without repetition of
// students with an ACTIVE enrollment in the class.
func (s *Service) checkAudience(ctx context.Context, classID uuid.UUID, audience domain.Audience, sent []uuid.UUID) ([]uuid.UUID, error) {
	if audience == domain.AudienceAllClass {
		if len(sent) > 0 {
			return nil, domain.ErrInvalidAssessment
		}
		return nil, nil
	}
	if len(sent) == 0 {
		return nil, domain.ErrInvalidAssessment
	}
	active, err := s.activeSet(ctx, classID)
	if err != nil {
		return nil, err
	}
	seen := make(map[uuid.UUID]bool, len(sent))
	out := make([]uuid.UUID, 0, len(sent))
	for _, id := range sent {
		if !active[id] {
			return nil, domain.ErrStudentNotInClass
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out, nil
}
