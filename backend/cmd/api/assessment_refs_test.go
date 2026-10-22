package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	assessmentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	assessmentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	classgroupdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classgrouprepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	coursemoduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	coursemodulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	scheduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

var ctx = context.Background()

func str(s string) *string { return &s }

// ---- the class, its students and the names ----

type fakeClassReader struct {
	class   classgroupdomain.ClassGroup
	err     error
	members []classgrouprepository.EnrollmentWithUser
	names   map[uuid.UUID]string
}

func (f fakeClassReader) Lookup(context.Context, uuid.UUID) (classgroupdomain.ClassGroup, error) {
	return f.class, f.err
}

func (f fakeClassReader) ActiveMembers(context.Context, uuid.UUID) ([]classgrouprepository.EnrollmentWithUser, error) {
	return f.members, f.err
}

func (f fakeClassReader) UserNames(context.Context, []uuid.UUID) (map[uuid.UUID]string, error) {
	return f.names, f.err
}

// Covers SPEC-075 RN-01, RN-08, RN-15: the assessments see the class by its teacher, the students with an active enrollment by id, name and RA
// (an absent name or RA is empty), and the names of users.
func TestAssessmentClasses_MapsTheClassTheStudentsAndTheNames(t *testing.T) {
	teacher, ana, bruno := uuid.New(), uuid.New(), uuid.New()
	reader := fakeClassReader{
		class: classgroupdomain.ClassGroup{Model: database.Model{ID: uuid.New()}, TeacherID: teacher},
		members: []classgrouprepository.EnrollmentWithUser{
			{Enrollment: classgroupdomain.Enrollment{UserID: ana}, UserName: str("Ana"), UserAcademicID: str("1000001")},
			{Enrollment: classgroupdomain.Enrollment{UserID: bruno}},
		},
		names: map[uuid.UUID]string{teacher: "Profa. Sediane"},
	}
	a := assessmentClasses{classes: reader}

	class, err := a.Class(ctx, reader.class.ID)
	require.NoError(t, err)
	assert.Equal(t, assessmentservice.ClassInfo{ID: reader.class.ID, TeacherID: teacher}, class)

	students, err := a.ActiveStudents(ctx, reader.class.ID)
	require.NoError(t, err)
	assert.Equal(t, []assessmentservice.Student{{ID: ana, Name: "Ana", AcademicID: "1000001"}, {ID: bruno}}, students)

	names, err := a.Names(ctx, []uuid.UUID{teacher})
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]string{teacher: "Profa. Sediane"}, names)

	missing := assessmentClasses{classes: fakeClassReader{err: classgroupdomain.ErrClassNotFound}}
	_, err = missing.Class(ctx, uuid.New())
	assert.ErrorIs(t, err, assessmentdomain.ErrClassNotFound, "the error of the class module becomes the one of the assessments")
}

// ---- the lessons ----

type fakeLessonReader struct {
	session scheduledomain.ClassSession
	err     error
}

func (f fakeLessonReader) Lesson(context.Context, uuid.UUID) (scheduledomain.ClassSession, error) {
	return f.session, f.err
}

func clock(s string) scheduledomain.Clock {
	c, err := scheduledomain.ParseClock(s)
	if err != nil {
		panic(err)
	}
	return c
}

// Covers SPEC-075 RN-04: a lesson reaches the assessments with its period in instants (the date with the start and the end of the lesson, in
// Brasília), whether it was canceled, its topic and its module.
func TestAssessmentLessons_BuildsTheInstantsFromTheDateAndTheClock(t *testing.T) {
	module := uuid.New()
	session := scheduledomain.ClassSession{
		Model: database.Model{ID: uuid.New()}, ClassID: uuid.New(), Date: time.Date(2026, 10, 26, 0, 0, 0, 0, scheduledomain.Location()),
		StartTime: clock("08:20"), EndTime: clock("10:00"), Status: scheduledomain.SessionScheduled, Topic: str("Permissões"), ModuleID: &module,
	}
	l := assessmentLessons{schedule: fakeLessonReader{session: session}}

	got, err := l.Lesson(ctx, session.ID)
	require.NoError(t, err)
	assert.Equal(t, session.ID, got.ID)
	assert.Equal(t, session.ClassID, got.ClassID)
	assert.True(t, got.StartsAt.Equal(time.Date(2026, 10, 26, 8, 20, 0, 0, scheduledomain.Location())))
	assert.True(t, got.EndsAt.Equal(time.Date(2026, 10, 26, 10, 0, 0, 0, scheduledomain.Location())))
	assert.False(t, got.Canceled)
	assert.Equal(t, "Permissões", got.Topic)
	require.NotNil(t, got.ModuleID)
	assert.Equal(t, module, *got.ModuleID)

	session.Status, session.Topic, session.ModuleID = scheduledomain.SessionCanceled, nil, nil
	got, err = assessmentLessons{schedule: fakeLessonReader{session: session}}.Lesson(ctx, session.ID)
	require.NoError(t, err)
	assert.True(t, got.Canceled)
	assert.Empty(t, got.Topic)
	assert.Nil(t, got.ModuleID)

	_, err = assessmentLessons{schedule: fakeLessonReader{err: scheduledomain.ErrSessionNotFound}}.Lesson(ctx, uuid.New())
	assert.ErrorIs(t, err, assessmentdomain.ErrSessionNotFound)
}

// ---- the modules ----

type fakeModuleReader struct {
	details coursemodulerepository.ModuleDetails
	err     error
	access  coursemoduleservice.UserAccessContext
}

func (f *fakeModuleReader) GetModuleByID(_ context.Context, _ uuid.UUID, access coursemoduleservice.UserAccessContext) (coursemodulerepository.ModuleDetails, error) {
	f.access = access
	return f.details, f.err
}

// Covers SPEC-075 RN-05: a module is of a class when the class is among the ones it is assigned to; a module that does not exist is not assigned
// to anyone. The module is read as an administrator, because the assessments decide who may use it themselves.
func TestAssessmentModules_OnlyTheModuleAssignedToTheClass(t *testing.T) {
	classID, otherClass := uuid.New(), uuid.New()
	reader := &fakeModuleReader{details: coursemodulerepository.ModuleDetails{
		Module:           coursemoduledomain.CourseModule{ID: uuid.New(), Title: "Permissões"},
		AssignedClassIDs: []uuid.UUID{classID},
	}}
	m := assessmentModules{modules: reader}

	module, ok, err := m.ModuleOfClass(ctx, classID, reader.details.Module.ID)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, assessmentservice.Module{ID: reader.details.Module.ID, Title: "Permissões"}, module)
	assert.True(t, reader.access.IsAdmin)

	_, ok, err = m.ModuleOfClass(ctx, otherClass, reader.details.Module.ID)
	require.NoError(t, err)
	assert.False(t, ok, "a class that is not among the assigned ones")

	_, ok, err = assessmentModules{modules: &fakeModuleReader{err: coursemoduledomain.ErrModuleNotFound}}.ModuleOfClass(ctx, classID, uuid.New())
	require.NoError(t, err)
	assert.False(t, ok, "a module that does not exist")
}

// ---- the questions ----

type fakeBank struct {
	items []contentservice.ExerciseRecord
	err   error
	who   contentservice.Actor
}

func (f *fakeBank) List(_ context.Context, who contentservice.Actor, _ uuid.UUID) (contentservice.ExerciseBank, error) {
	f.who = who
	return contentservice.ExerciseBank{Items: f.items}, f.err
}

type fakeQuestionReader struct {
	questions map[uuid.UUID]contentdomain.Question
}

func (f fakeQuestionReader) Question(_ context.Context, id uuid.UUID) (contentdomain.Question, error) {
	q, ok := f.questions[id]
	if !ok {
		return contentdomain.Question{}, contentservice.ErrQuestionNotFound
	}
	return q, nil
}

func question(level, status string, inAssessment bool, title string) contentservice.ExerciseRecord {
	return contentservice.ExerciseRecord{Question: contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindPractical, Difficulty: level, Status: status, InAssessment: inAssessment, Title: title,
		Statement: "<p>Enunciado de " + title + "</p>", Explanation: str("Porque " + title),
		ReferenceSolution: json.RawMessage(`{"steps":[{"command":"mkdir /a"}]}`),
	}}
}

// Covers SPEC-075 RN-05, RN-07: only published questions that are in the assessment bank are eligible; the pool filters them by level, kind and
// text, pages them, and counts the stock by level whatever the filter.
func TestAssessmentQuestions_EligiblePoolAndStock(t *testing.T) {
	e1, e2, m1, h1 := question("EASY", "PUBLISHED", true, "Criar pasta"), question("EASY", "PUBLISHED", true, "Apagar pasta"),
		question("MEDIUM", "PUBLISHED", true, "Permissão octal"), question("HARD", "PUBLISHED", true, "Dono e grupo")
	draft, outside := question("EASY", "DRAFT", true, "Rascunho"), question("EASY", "PUBLISHED", false, "Só da prática")
	bank := &fakeBank{items: []contentservice.ExerciseRecord{e1, draft, m1, e2, outside, h1}}
	q := assessmentQuestions{bank: bank, questions: fakeQuestionReader{}}
	module := uuid.New()

	ok, err := q.Eligible(ctx, module, []uuid.UUID{e1.ID, draft.ID, outside.ID, uuid.New(), h1.ID})
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{e1.ID, h1.ID}, []uuid.UUID{ok[0].ID, ok[1].ID}, "the draft, the one outside the bank and the unknown are out")
	assert.Len(t, ok, 2)
	assert.Equal(t, "ADMIN", bank.who.Role, "the bank is read as an administrator; the assessments decide who may use it")

	page, err := q.Pool(ctx, assessmentservice.QuestionFilter{ModuleID: module})
	require.NoError(t, err)
	assert.Equal(t, 4, page.Total)
	assert.Len(t, page.Items, 4)
	assert.Equal(t, map[assessmentdomain.Difficulty]int{assessmentdomain.DifficultyEasy: 2, assessmentdomain.DifficultyMedium: 1, assessmentdomain.DifficultyHard: 1}, page.Stock)

	easy, err := q.Pool(ctx, assessmentservice.QuestionFilter{ModuleID: module, Difficulty: assessmentdomain.DifficultyEasy})
	require.NoError(t, err)
	assert.Equal(t, 2, easy.Total)
	assert.Equal(t, page.Stock, easy.Stock, "the stock does not follow the filter")

	text, err := q.Pool(ctx, assessmentservice.QuestionFilter{ModuleID: module, Query: "PERMISSÃO"})
	require.NoError(t, err)
	require.Len(t, text.Items, 1)
	assert.Equal(t, "Permissão octal", text.Items[0].Title, "the text is searched in the title, without regard to case")

	paged, err := q.Pool(ctx, assessmentservice.QuestionFilter{ModuleID: module, Page: 2, PageSize: 3})
	require.NoError(t, err)
	assert.Equal(t, 4, paged.Total)
	assert.Len(t, paged.Items, 1, "the second page of three has the fourth question")

	none, err := q.Pool(ctx, assessmentservice.QuestionFilter{ModuleID: module, Kind: "THEORETICAL_BOOLEAN"})
	require.NoError(t, err)
	assert.Empty(t, none.Items)
}

// Covers SPEC-075 RN-16: the content of a question for the teacher carries the statement, the explanation and an answer key: the one the kind
// reveals, or the reference solution for a practical question; one that does not exist is left out.
func TestAssessmentQuestions_ContentsHaveTheAnswerKey(t *testing.T) {
	practical := question("EASY", "PUBLISHED", true, "Criar pasta").Question
	boolean := contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindTheoreticalBoolean, Difficulty: "EASY", Title: "rm -r", Statement: "<p>Apaga a pasta?</p>",
		AnswerKey: json.RawMessage(`{"correct":false}`),
	}
	q := assessmentQuestions{questions: fakeQuestionReader{questions: map[uuid.UUID]contentdomain.Question{practical.ID: practical, boolean.ID: boolean}}}

	got, err := q.Contents(ctx, []uuid.UUID{practical.ID, boolean.ID, uuid.New()})
	require.NoError(t, err)
	require.Len(t, got, 2, "the unknown one is left out")
	assert.Equal(t, "<p>Enunciado de Criar pasta</p>", got[practical.ID].Statement)
	assert.Equal(t, "Porque Criar pasta", got[practical.ID].Explanation)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /a"}]}`, got[practical.ID].AnswerKey, "the reference solution")
	assert.Equal(t, "false", got[boolean.ID].AnswerKey, "the answer the kind reveals")
	assert.Equal(t, assessmentdomain.DifficultyEasy, got[boolean.ID].Difficulty)
	assert.Empty(t, got[boolean.ID].Explanation)
}

// Covers SPEC-081 RN-01, RN-02, CA-14, CA-15: the content of a question carries what the student receives, by kind: the alternatives and whether
// they are shuffled, the two columns without the pairs, the size of a descriptive answer; a true or false and a practical question carry nothing
// more than the statement. Whatever the teacher keeps (the correct choice, the pairs, the expected answer, the explanation) has no place in it.
func TestAssessmentQuestions_ContentsCarryWhatTheStudentReceivesAndNeverTheAnswer(t *testing.T) {
	yes, no, size, bigger := true, false, 300, contentdomain.DefaultAnswerSize
	single := contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindTheoreticalSingle, Difficulty: "EASY", Title: "Qual lista?", Statement: "<p>Qual lista?</p>",
		Choices: json.RawMessage(`[{"id":"a","html":"<p>ls</p>"},{"id":"b","html":"<p>cd</p>"}]`), AnswerKey: json.RawMessage(`{"correct":"b"}`),
		Explanation: str("porque cd muda"), ShuffleChoices: true,
	}
	kept := single
	kept.ID, kept.ShuffleChoices = uuid.New(), false
	matching := contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindTheoreticalMatching, Difficulty: "MEDIUM", Title: "Ligue", Statement: "<p>Ligue</p>",
		Choices:   json.RawMessage(`{"left":[{"id":"l1","text":"ls"},{"id":"l2","text":"cd"}],"right":[{"id":"r1","text":"lista"},{"id":"r2","text":"muda"}]}`),
		AnswerKey: json.RawMessage(`{"pairs":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"}]}`), ShuffleChoices: true,
	}
	discursive := contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindDiscursive, Difficulty: "HARD", Title: "Explique", Statement: "<p>Explique</p>",
		AnswerKey: json.RawMessage(`{"expectedAnswer":"<p>a resposta</p>","maxLength":300}`),
	}
	unsized := discursive
	unsized.ID, unsized.AnswerKey = uuid.New(), json.RawMessage(`{"expectedAnswer":"<p>a resposta</p>"}`)
	boolean := contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindTheoreticalBoolean, Difficulty: "EASY", Title: "rm -r", Statement: "<p>Apaga?</p>",
		AnswerKey: json.RawMessage(`{"correct":false}`),
	}
	practical := question("EASY", "PUBLISHED", true, "Criar pasta").Question
	all := map[uuid.UUID]contentdomain.Question{}
	var ids []uuid.UUID
	for _, c := range []contentdomain.Question{single, kept, matching, discursive, unsized, boolean, practical} {
		all[c.ID] = c
		ids = append(ids, c.ID)
	}
	q := assessmentQuestions{questions: fakeQuestionReader{questions: all}}

	got, err := q.Contents(ctx, ids)
	require.NoError(t, err)
	choices := []assessmentservice.StudentChoice{{ID: "a", HTML: "<p>ls</p>"}, {ID: "b", HTML: "<p>cd</p>"}}
	assert.Equal(t, assessmentservice.StudentView{Choices: choices, Shuffle: &yes}, got[single.ID].StudentView, "the alternatives, with no mark of the right one")
	assert.Equal(t, assessmentservice.StudentView{Choices: choices, Shuffle: &no}, got[kept.ID].StudentView, "the teacher keeps her order")
	assert.Equal(t, assessmentservice.StudentView{
		Columns: &assessmentservice.StudentColumns{
			Left:  []assessmentservice.StudentItem{{ID: "l1", Text: "ls"}, {ID: "l2", Text: "cd"}},
			Right: []assessmentservice.StudentItem{{ID: "r1", Text: "lista"}, {ID: "r2", Text: "muda"}},
		},
		Shuffle: &yes,
	}, got[matching.ID].StudentView, "the columns in the order of the teacher, without the pairs")
	assert.Equal(t, assessmentservice.StudentView{MaxLength: &size}, got[discursive.ID].StudentView, "only the size of the answer")
	assert.Equal(t, assessmentservice.StudentView{MaxLength: &bigger}, got[unsized.ID].StudentView, "the default size when the teacher did not choose one")
	assert.Equal(t, assessmentservice.StudentView{}, got[boolean.ID].StudentView, "a true or false question has only the statement")
	assert.Equal(t, assessmentservice.StudentView{}, got[practical.ID].StudentView, "a practical question has only the statement")
	assert.Contains(t, got[single.ID].AnswerKey, "b", "the answer key and the explanation stay in their own fields, for the teacher")
	assert.Equal(t, "porque cd muda", got[single.ID].Explanation)
}

// Covers SPEC-081 RN-01, D-04: a question of the sample carries what the student receives, like the ones in order.
func TestAssessmentQuestions_SampleCarriesWhatTheStudentReceives(t *testing.T) {
	single := contentdomain.Question{
		ID: uuid.New(), Kind: contentdomain.KindTheoreticalSingle, Difficulty: "EASY", Status: "PUBLISHED", InAssessment: true, Title: "Qual lista?",
		Choices: json.RawMessage(`[{"id":"a","html":"<p>ls</p>"},{"id":"b","html":"<p>cd</p>"}]`), AnswerKey: json.RawMessage(`{"correct":"b"}`),
	}
	q := assessmentQuestions{bank: &fakeBank{items: []contentservice.ExerciseRecord{{Question: single}}}}

	sample, err := q.Sample(ctx, uuid.New(), assessmentdomain.DifficultyEasy, 1)
	require.NoError(t, err)
	require.Len(t, sample, 1)
	assert.Equal(t, []assessmentservice.StudentChoice{{ID: "a", HTML: "<p>ls</p>"}, {ID: "b", HTML: "<p>cd</p>"}}, sample[0].StudentView.Choices)
}

// Covers SPEC-075 RN-16: the sample takes n different eligible questions of the level, or all of them when there are fewer.
func TestAssessmentQuestions_SampleTakesDifferentQuestionsOfTheLevel(t *testing.T) {
	var items []contentservice.ExerciseRecord
	for i := 0; i < 5; i++ {
		items = append(items, question("HARD", "PUBLISHED", true, "difícil"))
	}
	items = append(items, question("EASY", "PUBLISHED", true, "fácil"), question("HARD", "DRAFT", true, "rascunho"))
	q := assessmentQuestions{bank: &fakeBank{items: items}}

	sample, err := q.Sample(ctx, uuid.New(), assessmentdomain.DifficultyHard, 3)
	require.NoError(t, err)
	require.Len(t, sample, 3)
	seen := map[uuid.UUID]bool{}
	for _, c := range sample {
		assert.False(t, seen[c.ID], "no question twice")
		seen[c.ID] = true
		assert.Equal(t, assessmentdomain.DifficultyHard, c.Difficulty)
		assert.Equal(t, "difícil", c.Title)
	}

	all, err := q.Sample(ctx, uuid.New(), assessmentdomain.DifficultyHard, 9)
	require.NoError(t, err)
	assert.Len(t, all, 5, "all of the published ones of the level, none of the draft")
}

// ---- the homologation and the calendar ----

// Covers SPEC-075 RN-12, D-12: until the grades module exists, no assessment has homologated grades.
func TestNoHomologation_NothingIsHomologatedYet(t *testing.T) {
	has, err := noHomologation{}.HasHomologated(ctx, uuid.New())
	require.NoError(t, err)
	assert.False(t, has)
}

type fakeAssessmentCalendar struct {
	result assessmentservice.CalendarResult
	err    error
	actor  assessmentservice.Actor
}

func (f *fakeAssessmentCalendar) Calendar(_ context.Context, actor assessmentservice.Actor, _ []uuid.UUID, _, _ time.Time) (assessmentservice.CalendarResult, error) {
	f.actor = actor
	return f.result, f.err
}

// Covers SPEC-075 RN-17, D-08: the calendar gets, for the student, the public form, and for the teacher the public form with the count of
// eligible students and the composition; the actor goes through, so the assessments decide what each one sees.
func TestScheduleAssessments_TheTeacherGetsTheCountAndTheCompositionTheStudentDoesNot(t *testing.T) {
	brt := time.FixedZone("BRT", -3*3600)
	public := assessmentservice.Public{
		ID: uuid.New(), ClassID: uuid.New(), Title: "Prova 1", Description: "Leia.", Type: assessmentdomain.TypeExam, Status: assessmentdomain.StatusCanceled,
		Phase: assessmentdomain.PhaseUpcoming, StartsAt: time.Date(2026, 10, 21, 9, 0, 0, 0, brt), EndsAt: time.Date(2026, 10, 21, 11, 0, 0, 0, brt),
		MaxScore: assessmentdomain.Points(2.5), CancelReason: str("Greve"),
	}
	calendar := &fakeAssessmentCalendar{result: assessmentservice.CalendarResult{Public: []assessmentservice.Public{public}}}
	a := scheduleAssessments{assessments: calendar}
	actor := scheduleservice.Actor{UserID: uuid.New(), Role: "STUDENT"}

	got, err := a.CalendarAssessments(ctx, actor, []uuid.UUID{public.ClassID}, time.Now(), time.Now())
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, assessmentservice.Actor{UserID: actor.UserID, Role: "STUDENT"}, calendar.actor)
	assert.Equal(t, "Prova 1", got[0].Title)
	assert.Equal(t, "EXAM", got[0].Type)
	assert.Equal(t, "CANCELED", got[0].Status)
	assert.Equal(t, "UPCOMING", got[0].Phase)
	assert.Equal(t, 2.5, got[0].MaxScore)
	assert.Equal(t, public.CancelReason, got[0].CancelReason)
	assert.Nil(t, got[0].EligibleStudents)
	assert.Nil(t, got[0].Composition)

	calendar.result = assessmentservice.CalendarResult{Summaries: []assessmentservice.Summary{{Public: public, Composition: assessmentdomain.CompositionDraw, EligibleStudents: 24}}}
	got, err = a.CalendarAssessments(ctx, scheduleservice.Actor{UserID: uuid.New(), Role: "TEACHER"}, nil, time.Now(), time.Now())
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.NotNil(t, got[0].EligibleStudents)
	assert.Equal(t, 24, *got[0].EligibleStudents)
	require.NotNil(t, got[0].Composition)
	assert.Equal(t, "DRAW", *got[0].Composition)
}
