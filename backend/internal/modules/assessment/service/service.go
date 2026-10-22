// Package service implements the assessments of a class on the calendar (SPEC-075): creating and converting a lesson, the manual and the draw
// composition, the audience, freezing, rescheduling, canceling, the private notes, the preview, the lists and the access decision.
package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/htmlsafe"
)

// Actor is who makes a request.
type Actor struct {
	UserID uuid.UUID
	Role   string
}

// ClassInfo is what the assessments need from a class.
type ClassInfo struct{ ID, TeacherID uuid.UUID }

// Classes reads a class. It answers domain.ErrClassNotFound for one that does not exist.
type Classes interface {
	Class(ctx context.Context, id uuid.UUID) (ClassInfo, error)
}

// Student is a student of a class.
type Student struct {
	ID         uuid.UUID
	Name       string
	AcademicID string
}

// Students gives the students of a class with an ACTIVE enrollment (RN-08).
type Students interface {
	ActiveStudents(ctx context.Context, classID uuid.UUID) ([]Student, error)
}

// Lesson is a lesson of the schedule, with its period already in instants.
type Lesson struct {
	ID, ClassID      uuid.UUID
	StartsAt, EndsAt time.Time
	Canceled         bool
	Topic            string
	ModuleID         *uuid.UUID
}

// Lessons reads a lesson of the schedule, whatever its class. It answers domain.ErrSessionNotFound for one that does not exist (RN-04).
type Lessons interface {
	Lesson(ctx context.Context, id uuid.UUID) (Lesson, error)
}

// Module is a teaching module.
type Module struct {
	ID    uuid.UUID
	Title string
}

// Modules says whether a module is assigned to a class (RN-05).
type Modules interface {
	ModuleOfClass(ctx context.Context, classID, moduleID uuid.UUID) (Module, bool, error)
}

// Question is a question of the bank of a module.
type Question struct {
	ID         uuid.UUID
	Title      string
	Kind       string
	Difficulty domain.Difficulty
}

// QuestionContent is a question with what only the teacher sees: the statement, the answer key and the explanation (RN-16).
type QuestionContent struct {
	Question
	Statement, AnswerKey, Explanation string
	StudentView                       StudentView
}

// StudentView is what the student receives of a question, without the answer key (SPEC-081 RN-01, RN-02). Only the fields of the kind of the
// question are filled: the alternatives of a single choice, the columns of a matching, the size of a descriptive answer and, for the first two,
// whether they are shuffled. A true or false and a practical question have only the statement.
type StudentView struct {
	Choices   []StudentChoice
	Columns   *StudentColumns
	Shuffle   *bool
	MaxLength *int
}

// StudentChoice is an alternative of a single choice question: its id and its filtered html.
type StudentChoice struct{ ID, HTML string }

// StudentItem is an item of a column of a matching question: its id and its text.
type StudentItem struct{ ID, Text string }

// StudentColumns are the two columns of a matching question, each in the order of the teacher.
type StudentColumns struct{ Left, Right []StudentItem }

// QuestionFilter picks questions of a module.
type QuestionFilter struct {
	ModuleID   uuid.UUID
	Difficulty domain.Difficulty
	Kind       string
	Query      string
	Page       int
	PageSize   int
}

// QuestionPage is a page of eligible questions with the stock by level, which counts all of them whatever the filter.
type QuestionPage struct {
	Items []Question
	Total int
	Stock map[domain.Difficulty]int
}

// Questions reads the bank of the modules. A question is eligible when it is of the module, published, in the assessment bank and not deleted
// (RN-05).
type Questions interface {
	// Eligible answers which of ids are eligible in the module.
	Eligible(ctx context.Context, moduleID uuid.UUID, ids []uuid.UUID) ([]Question, error)
	Pool(ctx context.Context, f QuestionFilter) (QuestionPage, error)
	Contents(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]QuestionContent, error)
	// Scenario gives the machine a question starts from, or nil when it has none of its own (SPEC-084 RN-01).
	Scenario(ctx context.Context, questionID uuid.UUID) (json.RawMessage, error)
	// Sample draws n eligible questions of the level.
	Sample(ctx context.Context, moduleID uuid.UUID, level domain.Difficulty, n int) ([]QuestionContent, error)
}

// HomologationCheck says whether an assessment has homologated grades (RN-12). The grades module does not exist yet, so the composition root plugs
// one that answers "none".
type HomologationCheck interface {
	HasHomologated(ctx context.Context, assessmentID uuid.UUID) (bool, error)
}

// AttemptCheck says whether a student already started the attempt of an assessment (SPEC-076 RN-07). The attempts do not exist yet, so the
// composition root plugs one that answers "nobody started" until the spec of the attempts.
type AttemptCheck interface {
	HasStarted(ctx context.Context, assessmentID, studentID uuid.UUID) (bool, error)
}

// Users gives the names of users, for who changed what (RN-15).
type Users interface {
	Names(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error)
}

// Ports are what the assessments read from the other modules, declared here and implemented by them (ARCHITECTURE.md, section 3.2).
type Ports struct {
	Classes      Classes
	Students     Students
	Lessons      Lessons
	Modules      Modules
	Questions    Questions
	Homologation HomologationCheck
	Attempts     AttemptCheck
	Users        Users
}

// Replacements are the parts of an assessment that a save replaces as a whole; nil leaves the part as it is.
type Replacements struct {
	Items    *[]domain.Item
	Rules    *[]domain.DrawRule
	Students *[]uuid.UUID
}

// Repository is the persistence the service needs.
type Repository interface {
	// Create stores the assessment with its composition and its event in one transaction.
	Create(ctx context.Context, a *domain.Assessment, items []domain.Item, rules []domain.DrawRule, students []uuid.UUID, e domain.Event) error
	Find(ctx context.Context, id uuid.UUID) (domain.Assessment, error)
	Items(ctx context.Context, id uuid.UUID) ([]domain.Item, error)
	Rules(ctx context.Context, id uuid.UUID) ([]domain.DrawRule, error)
	StudentIDs(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error)
	Events(ctx context.Context, id uuid.UUID) ([]domain.Event, error)
	// Save writes the assessment, replaces what Replacements carries and appends the event, in one transaction.
	Save(ctx context.Context, a *domain.Assessment, rep Replacements, e *domain.Event) error
	// Clearances gives the decisions of the teacher about the students of the assessment (SPEC-076).
	Clearances(ctx context.Context, assessmentID uuid.UUID) ([]domain.Clearance, error)
	// SaveClearances writes the decisions, one row for each student with the last one winning, and appends the event, in one transaction (RN-12).
	SaveClearances(ctx context.Context, assessmentID uuid.UUID, rows []domain.Clearance, e domain.Event) error
	// SaveNotes writes only the private notes: not updated_by, not updated_at, no event (RN-13).
	SaveNotes(ctx context.Context, id uuid.UUID, notes *string) error
	ListByClass(ctx context.Context, classID uuid.UUID) ([]domain.Assessment, error)
	// ListInRange gives the assessments whose period crosses [from, to).
	ListInRange(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.Assessment, error)
	HasActiveForLesson(ctx context.Context, lessonID uuid.UUID) (bool, error)
	// InScheduledManual tells whether a SCHEDULED manual assessment lists the question (RN-18).
	InScheduledManual(ctx context.Context, questionID uuid.UUID) (bool, error)
	// DrawDemand gives, by level, the biggest quantity a SCHEDULED draw of the module asks for (RN-18).
	DrawDemand(ctx context.Context, moduleID uuid.UUID) (map[domain.Difficulty]int, error)
}

// Service implements the use cases of the assessments.
type Service struct {
	repo     Repository
	ports    Ports
	now      func() time.Time
	richText *htmlsafe.Sanitizer
}

// New creates the service. now is the clock of the server.
func New(repo Repository, ports Ports, now func() time.Time) *Service {
	return &Service{repo: repo, ports: ports, now: now, richText: htmlsafe.NewRichText()}
}

// instructions filters the instructions of an assessment like the syllabus of a class (SPEC-077 RN-01): no images, videos, scripts or event
// attributes. Text with nothing visible is stored empty. The limit is checked by the domain, on what is stored.
func (s *Service) instructions(markup string) string {
	filtered := strings.TrimSpace(s.richText.Sanitize(markup))
	if htmlsafe.PlainText(filtered) == "" {
		return ""
	}
	return filtered
}

// Now is the clock of the server, for the answers that carry it (countdowns count by it).
func (s *Service) Now() time.Time { return s.now() }

// writableClass returns the class when the actor may write in it: its teacher or an administrator (RN-01).
func (s *Service) writableClass(ctx context.Context, actor Actor, classID uuid.UUID) (ClassInfo, error) {
	if actor.Role != authn.RoleTeacher && actor.Role != authn.RoleAdmin {
		return ClassInfo{}, domain.ErrForbidden
	}
	class, err := s.ports.Classes.Class(ctx, classID)
	if err != nil {
		return ClassInfo{}, err
	}
	if actor.Role != authn.RoleAdmin && class.TeacherID != actor.UserID {
		return ClassInfo{}, domain.ErrForbidden
	}
	return class, nil
}

// studentOf checks that the actor is a student with an ACTIVE enrollment in the class. A student without one gets domain.ErrClassNotFound, so
// the class is not revealed (SPEC-042 RN-08).
func (s *Service) studentOf(ctx context.Context, actor Actor, classID uuid.UUID) error {
	if actor.Role != authn.RoleStudent {
		return domain.ErrForbidden
	}
	if _, err := s.ports.Classes.Class(ctx, classID); err != nil {
		return err
	}
	active, err := s.activeSet(ctx, classID)
	if err != nil {
		return err
	}
	if !active[actor.UserID] {
		return domain.ErrClassNotFound
	}
	return nil
}

// assessmentOf loads an assessment and checks that it belongs to the class.
func (s *Service) assessmentOf(ctx context.Context, classID, id uuid.UUID) (domain.Assessment, error) {
	a, err := s.repo.Find(ctx, id)
	if err != nil {
		return domain.Assessment{}, err
	}
	if a.ClassID != classID {
		return domain.Assessment{}, domain.ErrAssessmentNotFound
	}
	return a, nil
}

func (s *Service) activeSet(ctx context.Context, classID uuid.UUID) (map[uuid.UUID]bool, error) {
	students, err := s.ports.Students.ActiveStudents(ctx, classID)
	if err != nil {
		return nil, err
	}
	set := make(map[uuid.UUID]bool, len(students))
	for _, st := range students {
		set[st.ID] = true
	}
	return set, nil
}

// eligible gives the ids of the students who may do the assessment: with an ACTIVE enrollment and, in SELECTED, on the list (RN-08).
func (s *Service) eligible(ctx context.Context, a domain.Assessment) (map[uuid.UUID]bool, error) {
	active, err := s.activeSet(ctx, a.ClassID)
	if err != nil {
		return nil, err
	}
	if a.Audience != domain.AudienceSelected {
		return active, nil
	}
	chosen, err := s.repo.StudentIDs(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]bool, len(chosen))
	for _, id := range chosen {
		if active[id] {
			out[id] = true
		}
	}
	return out, nil
}

// ---- what the service answers ----

// Public is an assessment as the student gets it: nothing but this, in any phase (RN-09).
type Public struct {
	ID, ClassID      uuid.UUID
	ClassSessionID   *uuid.UUID
	Title            string
	Description      string
	Type             domain.Type
	Status           domain.Status
	Phase            domain.Phase
	StartsAt, EndsAt time.Time
	DurationMinutes  *int
	MaxScore         domain.Score
	CancelReason     *string
}

// Summary is an assessment as the teacher and the administrator get it.
type Summary struct {
	Public
	ModuleID            uuid.UUID
	ModuleTitle         string
	Composition         domain.Composition
	Audience            domain.Audience
	Modality            domain.Modality
	RequiresClearance   bool
	ClearanceCounts     ClearanceCounts
	EligibleStudents    int
	TotalQuestions      int
	Frozen              bool
	TeacherPrivateNotes *string
	CreatedBy           uuid.UUID
	CreatedByName       string
	UpdatedBy           uuid.UUID
	UpdatedByName       string
	UpdatedAt           time.Time
	CanceledBy          *uuid.UUID
	CanceledAt          *time.Time
	// StartedAt, StartedBy and StartedByName are the start of an in-person exam by the teacher; empty until it happens (SPEC-083 RN-07).
	StartedAt     *time.Time
	StartedBy     *uuid.UUID
	StartedByName string
}

// ItemView is a question of the composition with what the teacher needs to recognize it.
type ItemView struct {
	domain.Item
	Title      string
	Kind       string
	Difficulty domain.Difficulty
}

// EventView is an event of the history with the name of who did it.
type EventView struct {
	domain.Event
	ActorName string
}

// Detail is the whole assessment for the teacher: the summary, the composition, the students and the history.
type Detail struct {
	Summary
	Items    []ItemView
	Rules    []domain.DrawRule
	Students []Student
	Events   []EventView
}

func publicOf(a domain.Assessment, now time.Time) Public {
	p := Public{
		ID: a.ID, ClassID: a.ClassID, ClassSessionID: a.ClassSessionID, Title: a.Title, Description: a.Description, Type: a.Type, Status: a.Status,
		Phase: a.PhaseAt(now), StartsAt: a.StartsAt, EndsAt: a.EndsAt, DurationMinutes: a.DurationMinutes, MaxScore: a.MaxScore,
	}
	if a.Status == domain.StatusCanceled {
		p.CancelReason = a.CancelReason
	}
	return p
}

// summarize builds the summary of the teacher: it reads the composition, the audience, the module and the names.
func (s *Service) summarize(ctx context.Context, a domain.Assessment) (Summary, error) {
	sum := Summary{
		Public: publicOf(a, s.now()), ModuleID: a.ModuleID, Composition: a.Composition, Audience: a.Audience, Frozen: a.Frozen(s.now()),
		Modality: a.Modality, RequiresClearance: a.RequiresClearance,
		TeacherPrivateNotes: a.TeacherPrivateNotes, CreatedBy: a.CreatedBy, UpdatedBy: a.UpdatedBy, UpdatedAt: a.UpdatedAt,
		CanceledBy: a.CanceledBy, CanceledAt: a.CanceledAt, StartedAt: a.StartedAt, StartedBy: a.StartedBy,
	}
	if module, ok, err := s.ports.Modules.ModuleOfClass(ctx, a.ClassID, a.ModuleID); err != nil {
		return Summary{}, err
	} else if ok {
		sum.ModuleTitle = module.Title
	}
	if a.Composition == domain.CompositionDraw {
		if a.DrawTotal != nil {
			sum.TotalQuestions = *a.DrawTotal
		}
	} else {
		items, err := s.repo.Items(ctx, a.ID)
		if err != nil {
			return Summary{}, err
		}
		sum.TotalQuestions = len(items)
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return Summary{}, err
	}
	sum.EligibleStudents = len(eligible)
	if sum.ClearanceCounts, err = s.clearanceCounts(ctx, a, eligible); err != nil {
		return Summary{}, err
	}

	ids := []uuid.UUID{a.CreatedBy, a.UpdatedBy}
	if a.CanceledBy != nil {
		ids = append(ids, *a.CanceledBy)
	}
	if a.StartedBy != nil {
		ids = append(ids, *a.StartedBy)
	}
	names, err := s.ports.Users.Names(ctx, ids)
	if err != nil {
		return Summary{}, err
	}
	sum.CreatedByName, sum.UpdatedByName = names[a.CreatedBy], names[a.UpdatedBy]
	if a.StartedBy != nil {
		sum.StartedByName = names[*a.StartedBy]
	}
	return sum, nil
}
