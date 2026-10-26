package main

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	assessmentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	assessmentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	classgroupdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classgrouprepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	coursemoduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	coursemodulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	practiceservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	scheduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// What the assessments read from the other modules (SPEC-075 section 3.2) goes through the services of those modules, in the adapters below, and
// never through their repositories. Each adapter asks for the narrow part of the service it uses, so a test can stand in for it.

// classReader is the part of the class service the assessments use.
type classReader interface {
	Lookup(ctx context.Context, classID uuid.UUID) (classgroupdomain.ClassGroup, error)
	ActiveMembers(ctx context.Context, classID uuid.UUID) ([]classgrouprepository.EnrollmentWithUser, error)
	UserNames(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error)
}

// assessmentClasses gives the assessments the class, its students and the names of users.
type assessmentClasses struct{ classes classReader }

func (a assessmentClasses) Class(ctx context.Context, id uuid.UUID) (assessmentservice.ClassInfo, error) {
	class, err := a.classes.Lookup(ctx, id)
	if errors.Is(err, classgroupdomain.ErrClassNotFound) {
		return assessmentservice.ClassInfo{}, assessmentdomain.ErrClassNotFound
	}
	if err != nil {
		return assessmentservice.ClassInfo{}, err
	}
	return assessmentservice.ClassInfo{ID: class.ID, TeacherID: class.TeacherID}, nil
}

func (a assessmentClasses) ActiveStudents(ctx context.Context, classID uuid.UUID) ([]assessmentservice.Student, error) {
	members, err := a.classes.ActiveMembers(ctx, classID)
	if err != nil {
		return nil, err
	}
	out := make([]assessmentservice.Student, len(members))
	for i, m := range members {
		out[i] = assessmentservice.Student{ID: m.UserID}
		if m.UserName != nil {
			out[i].Name = *m.UserName
		}
		if m.UserAcademicID != nil {
			out[i].AcademicID = *m.UserAcademicID
		}
	}
	return out, nil
}

func (a assessmentClasses) Names(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	return a.classes.UserNames(ctx, ids)
}

// lessonReader is the part of the schedule service the assessments use.
type lessonReader interface {
	Lesson(ctx context.Context, id uuid.UUID) (scheduledomain.ClassSession, error)
}

// assessmentLessons gives the assessments a lesson of the schedule, with its period already in instants (SPEC-075 RN-04).
type assessmentLessons struct{ schedule lessonReader }

func (l assessmentLessons) Lesson(ctx context.Context, id uuid.UUID) (assessmentservice.Lesson, error) {
	session, err := l.schedule.Lesson(ctx, id)
	if errors.Is(err, scheduledomain.ErrSessionNotFound) {
		return assessmentservice.Lesson{}, assessmentdomain.ErrSessionNotFound
	}
	if err != nil {
		return assessmentservice.Lesson{}, err
	}
	lesson := assessmentservice.Lesson{
		ID: session.ID, ClassID: session.ClassID, StartsAt: session.StartTime.At(session.Date), EndsAt: session.EndTime.At(session.Date),
		Canceled: session.Status == scheduledomain.SessionCanceled, ModuleID: session.ModuleID,
	}
	if session.Topic != nil {
		lesson.Topic = *session.Topic
	}
	return lesson, nil
}

// moduleReader is the part of the module service the assessments use.
type moduleReader interface {
	GetModuleByID(ctx context.Context, moduleID uuid.UUID, access coursemoduleservice.UserAccessContext) (coursemodulerepository.ModuleDetails, error)
}

// assessmentModules says whether a module is assigned to a class (SPEC-075 RN-05). The module is read as an administrator: the assessments decide
// who may use it.
type assessmentModules struct{ modules moduleReader }

func (m assessmentModules) ModuleOfClass(ctx context.Context, classID, moduleID uuid.UUID) (assessmentservice.Module, bool, error) {
	details, err := m.modules.GetModuleByID(ctx, moduleID, coursemoduleservice.UserAccessContext{Role: authn.RoleAdmin, IsAdmin: true})
	if errors.Is(err, coursemoduledomain.ErrModuleNotFound) {
		return assessmentservice.Module{}, false, nil
	}
	if err != nil {
		return assessmentservice.Module{}, false, err
	}
	for _, id := range details.AssignedClassIDs {
		if id == classID {
			return assessmentservice.Module{ID: details.Module.ID, Title: details.Module.Title}, true, nil
		}
	}
	return assessmentservice.Module{}, false, nil
}

// exerciseBank and questionReader are the parts of the content services the assessments use.
type exerciseBank interface {
	List(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID) (contentservice.ExerciseBank, error)
}

type questionReader interface {
	Question(ctx context.Context, id uuid.UUID) (contentdomain.Question, error)
	QuestionScenario(ctx context.Context, id uuid.UUID) (json.RawMessage, error)
}

// assessmentQuestions gives the assessments the bank of the questions of a module. A question is eligible when it is published and in the
// assessment bank (SPEC-075 RN-05); the bank gives only the ones that were not deleted. The bank is read as an administrator.
type assessmentQuestions struct {
	bank      exerciseBank
	questions questionReader
}

var bankReader = contentservice.Actor{Role: authn.RoleAdmin}

func eligibleQuestion(q contentdomain.Question) bool {
	return q.Status == contentdomain.StatusPublished && q.InAssessment
}

// bankOf reads the bank of the module and splits it: the eligible questions, and the count of the others by reason (SPEC-088 RN-01): the ones
// not published, whatever their link, and the published ones without the link to the assessment.
func (q assessmentQuestions) bankOf(ctx context.Context, moduleID uuid.UUID) ([]contentdomain.Question, assessmentservice.Excluded, error) {
	bank, err := q.bank.List(ctx, bankReader, moduleID)
	if err != nil {
		return nil, assessmentservice.Excluded{}, err
	}
	var out []contentdomain.Question
	var excluded assessmentservice.Excluded
	for _, r := range bank.Items {
		switch {
		case eligibleQuestion(r.Question):
			out = append(out, r.Question)
		case r.Question.Status != contentdomain.StatusPublished:
			excluded.Unpublished++
		default:
			excluded.Unlinked++
		}
	}
	return out, excluded, nil
}

// eligibleOf reads the bank of the module and keeps the eligible questions.
func (q assessmentQuestions) eligibleOf(ctx context.Context, moduleID uuid.UUID) ([]contentdomain.Question, error) {
	out, _, err := q.bankOf(ctx, moduleID)
	return out, err
}

func refOf(q contentdomain.Question) assessmentservice.Question {
	return assessmentservice.Question{ID: q.ID, Title: q.Title, Kind: q.Kind, Difficulty: assessmentdomain.Difficulty(q.Difficulty)}
}

// contentOf is the question for the teacher: the statement, the explanation and an answer key, which is the one the kind reveals or, for a
// practical question, the reference solution (SPEC-075 RN-16).
func contentOf(q contentdomain.Question) assessmentservice.QuestionContent {
	c := assessmentservice.QuestionContent{Question: refOf(q), Statement: q.Statement, StudentView: studentViewOf(q)}
	if q.Explanation != nil {
		c.Explanation = *q.Explanation
	}
	if kind, ok := contentdomain.TypeOf(q.Kind); ok {
		if _, value := kind.Revealed(q); len(value) > 0 {
			c.AnswerKey = string(value)
			return c
		}
	}
	if len(q.ReferenceSolution) > 0 && string(q.ReferenceSolution) != "null" {
		c.AnswerKey = string(json.RawMessage(q.ReferenceSolution))
	}
	return c
}

// studentViewOf is what the student receives of a question, by kind, never the answer: the alternatives of a single choice, the columns of a
// matching without the pairs, the size of a descriptive answer (SPEC-081 RN-01, RN-02). The other kinds have only the statement.
func studentViewOf(q contentdomain.Question) assessmentservice.StudentView {
	var view assessmentservice.StudentView
	shuffle := q.ShuffleChoices
	switch q.Kind {
	case contentdomain.KindTheoreticalSingle:
		var choices []contentdomain.Choice
		_ = json.Unmarshal(q.Choices, &choices)
		for _, c := range choices {
			view.Choices = append(view.Choices, assessmentservice.StudentChoice{ID: c.ID, HTML: c.HTML})
		}
		view.Shuffle = &shuffle
	case contentdomain.KindTheoreticalMatching:
		if cols, ok := contentdomain.ReadColumns(q.Choices); ok {
			view.Columns = &assessmentservice.StudentColumns{Left: studentItems(cols.Left), Right: studentItems(cols.Right)}
		}
		view.Shuffle = &shuffle
	case contentdomain.KindDiscursive:
		_, size := contentdomain.ReadDiscursiveKey(q.AnswerKey)
		view.MaxLength = &size
	}
	return view
}

func studentItems(items []contentdomain.MatchItem) []assessmentservice.StudentItem {
	out := make([]assessmentservice.StudentItem, len(items))
	for i, it := range items {
		out[i] = assessmentservice.StudentItem{ID: it.ID, Text: it.Text}
	}
	return out
}

func (q assessmentQuestions) Eligible(ctx context.Context, moduleID uuid.UUID, ids []uuid.UUID) ([]assessmentservice.Question, error) {
	list, err := q.eligibleOf(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	wanted := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		wanted[id] = true
	}
	var out []assessmentservice.Question
	for _, question := range list {
		if wanted[question.ID] {
			out = append(out, refOf(question))
		}
	}
	return out, nil
}

func (q assessmentQuestions) Pool(ctx context.Context, f assessmentservice.QuestionFilter) (assessmentservice.QuestionPage, error) {
	list, excluded, err := q.bankOf(ctx, f.ModuleID)
	if err != nil {
		return assessmentservice.QuestionPage{}, err
	}
	page := assessmentservice.QuestionPage{Stock: map[assessmentdomain.Difficulty]int{}, Excluded: excluded}
	needle := strings.ToLower(strings.TrimSpace(f.Query))
	var matched []assessmentservice.Question
	for _, question := range list {
		page.Stock[assessmentdomain.Difficulty(question.Difficulty)]++
		if f.Difficulty != "" && assessmentdomain.Difficulty(question.Difficulty) != f.Difficulty {
			continue
		}
		if f.Kind != "" && question.Kind != f.Kind {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(question.Title), needle) {
			continue
		}
		matched = append(matched, refOf(question))
	}
	sort.SliceStable(matched, func(i, j int) bool { return matched[i].Title < matched[j].Title })
	page.Total = len(matched)
	size, number := f.PageSize, f.Page
	if size < 1 {
		size = 20
	}
	if number < 1 {
		number = 1
	}
	from := (number - 1) * size
	if from > len(matched) {
		from = len(matched)
	}
	to := from + size
	if to > len(matched) {
		to = len(matched)
	}
	page.Items = matched[from:to]
	return page, nil
}

func (q assessmentQuestions) Contents(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]assessmentservice.QuestionContent, error) {
	out := make(map[uuid.UUID]assessmentservice.QuestionContent, len(ids))
	for _, id := range ids {
		question, err := q.questions.Question(ctx, id)
		if errors.Is(err, contentservice.ErrQuestionNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[id] = contentOf(question)
	}
	return out, nil
}

// Scenario is the machine a question starts from, read through the content module: nil when the question has none of its own (SPEC-084 RN-01).
func (q assessmentQuestions) Scenario(ctx context.Context, id uuid.UUID) (json.RawMessage, error) {
	return q.questions.QuestionScenario(ctx, id)
}

// Check grades the machine of the simulator against the conditions of a question of command Linux, with the engine and the conditions of the practice, the
// same that grade the exercise of the live class; it writes nothing and gives only whether it passes (SPEC-085 RN-02 to RN-04).
func (q assessmentQuestions) Check(ctx context.Context, id uuid.UUID, snapshot json.RawMessage) (bool, error) {
	question, err := q.questions.Question(ctx, id)
	if errors.Is(err, contentservice.ErrQuestionNotFound) {
		return false, assessmentdomain.ErrQuestionNotFound
	}
	if err != nil {
		return false, err
	}
	if !contentdomain.UsesTerminal(question.Kind) {
		return false, assessmentdomain.ErrInvalidQuestion
	}
	machine, err := practiceservice.ParseMachine(snapshot)
	if errors.Is(err, practiceservice.ErrInvalidSnapshot) {
		return false, assessmentdomain.ErrInvalidSnapshot
	}
	if err != nil {
		return false, err
	}
	var conditions []contentdomain.Condition
	if err := json.Unmarshal(question.ValidationConditions, &conditions); err != nil {
		return false, err
	}
	verdict, err := contentdomain.Grade(machine, conditions)
	if err != nil {
		return false, err
	}
	return verdict.Passed, nil
}

func (q assessmentQuestions) Sample(ctx context.Context, moduleID uuid.UUID, level assessmentdomain.Difficulty, n int) ([]assessmentservice.QuestionContent, error) {
	list, err := q.eligibleOf(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	var ofLevel []contentdomain.Question
	for _, question := range list {
		if assessmentdomain.Difficulty(question.Difficulty) == level {
			ofLevel = append(ofLevel, question)
		}
	}
	rand.Shuffle(len(ofLevel), func(i, j int) { ofLevel[i], ofLevel[j] = ofLevel[j], ofLevel[i] })
	if n > len(ofLevel) {
		n = len(ofLevel)
	}
	out := make([]assessmentservice.QuestionContent, n)
	for i := 0; i < n; i++ {
		out[i] = contentOf(ofLevel[i])
	}
	return out, nil
}

// noHomologation answers that no assessment has homologated grades, until the grades module exists (SPEC-075 RN-12, D-12).
type noHomologation struct{}

func (noHomologation) HasHomologated(context.Context, uuid.UUID) (bool, error) { return false, nil }

// noAttempts answers that nobody started the attempt of an assessment, until the spec of the attempts exists (SPEC-076 RN-07).
type noAttempts struct{}

func (noAttempts) HasStarted(context.Context, uuid.UUID, uuid.UUID) (bool, error) { return false, nil }

// assessmentCalendar is the part of the assessment service the calendar uses.
type assessmentCalendar interface {
	Calendar(ctx context.Context, actor assessmentservice.Actor, classIDs []uuid.UUID, from, to time.Time) (assessmentservice.CalendarResult, error)
}

// scheduleAssessments gives the calendar of the schedule the assessments of the classes in the range. The assessments decide what each role sees:
// the public form for the student, and for the teacher also the count of eligible students and the composition (SPEC-075 RN-17, D-08).
type scheduleAssessments struct{ assessments assessmentCalendar }

func (s scheduleAssessments) CalendarAssessments(ctx context.Context, actor scheduleservice.Actor, classIDs []uuid.UUID, from, to time.Time) ([]scheduleservice.CalendarAssessment, error) {
	res, err := s.assessments.Calendar(ctx, assessmentservice.Actor{UserID: actor.UserID, Role: actor.Role}, classIDs, from, to)
	if err != nil {
		return nil, err
	}
	out := make([]scheduleservice.CalendarAssessment, 0, len(res.Public)+len(res.Summaries))
	for _, p := range res.Public {
		out = append(out, calendarAssessmentOf(p))
	}
	for _, sum := range res.Summaries {
		item := calendarAssessmentOf(sum.Public)
		eligible, composition := sum.EligibleStudents, string(sum.Composition)
		item.EligibleStudents, item.Composition = &eligible, &composition
		out = append(out, item)
	}
	return out, nil
}

func calendarAssessmentOf(p assessmentservice.Public) scheduleservice.CalendarAssessment {
	return scheduleservice.CalendarAssessment{
		ID: p.ID, ClassID: p.ClassID, ClassSessionID: p.ClassSessionID, Title: p.Title, Description: p.Description, Type: string(p.Type),
		Status: string(p.Status), Phase: string(p.Phase), StartsAt: p.StartsAt, EndsAt: p.EndsAt, DurationMinutes: p.DurationMinutes,
		MaxScore: p.MaxScore.Float(), CancelReason: p.CancelReason,
	}
}
