package repository_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

func at(day, hour, minute int) time.Time {
	return time.Date(2026, 10, day, hour, minute, 0, 0, domain.Location())
}

func ptr[T any](v T) *T { return &v }

type env struct {
	ctx     context.Context
	db      *database.DB
	repo    *repository.Repository
	teacher userdomain.User
	student userdomain.User
	class   classdomain.ClassGroup
	module  cmdomain.CourseModule
	bank    map[domain.Difficulty][]uuid.UUID // the questions of the module, published and in the assessment bank
	lesson  uuid.UUID
	now     time.Time
}

// newEnv: a teacher, a student, a class with the module assigned, a bank with 3 easy, 2 medium and 2 hard questions and a lesson on the agenda.
func newEnv(t *testing.T) env {
	t.Helper()
	db := dbtest.Open(t)
	e := env{ctx: context.Background(), db: db, repo: repository.New(db), now: time.Now().UTC().Truncate(time.Microsecond), bank: map[domain.Difficulty][]uuid.UUID{}}

	users := userrepository.New(db)
	tname := "Profa. Sediane"
	e.teacher = userdomain.User{Name: &tname, Email: "prof@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(e.ctx, &e.teacher))
	ra, sname := "1000001", "Ana"
	e.student = userdomain.User{Name: &sname, Email: "ana@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(e.ctx, &e.student))

	e.class = classdomain.ClassGroup{TeacherID: e.teacher.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: at(1, 0, 0), EndDate: at(31, 0, 0), Status: classdomain.ClassStatusActive}
	require.NoError(t, classrepository.New(db).CreateClass(e.ctx, &e.class, []uuid.UUID{e.student.ID}, e.now))

	e.module = cmdomain.CourseModule{TeacherID: e.teacher.ID, Title: "Permissões", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(e.ctx, &e.module, []uuid.UUID{e.class.ID}, e.teacher.ID))

	questions := contentrepository.New(db)
	for level, n := range map[domain.Difficulty]int{domain.DifficultyEasy: 3, domain.DifficultyMedium: 2, domain.DifficultyHard: 2} {
		for i := 0; i < n; i++ {
			by := e.teacher.ID
			q := contentdomain.Question{ID: uuid.New(), ModuleID: e.module.ID, Kind: contentdomain.KindPractical, Usage: contentdomain.UsageAssessment,
				InAssessment: true, Difficulty: string(level), Status: contentdomain.StatusPublished, Title: string(level) + " " + string(rune('A'+i)),
				Statement: "<p>x</p>", Hints: json.RawMessage(`[]`), EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`),
				ValidationConditions: json.RawMessage(`[{"type":"DIRECTORY_EXISTS","path":"/a"}]`), CreatedBy: &by, UpdatedBy: &by, CreatedAt: e.now, UpdatedAt: e.now}
			require.NoError(t, questions.CreateExercise(e.ctx, &q))
			e.bank[level] = append(e.bank[level], q.ID)
		}
	}

	e.lesson = uuid.New()
	require.NoError(t, db.Conn(e.ctx).Exec(`INSERT INTO class_sessions (id, class_id, date, start_time, end_time, lesson_count, mode, status, origin, created_at, updated_at)
		VALUES (?, ?, '2026-10-26', '08:20', '10:00', 2, 'IN_PERSON', 'SCHEDULED', 'EXTRA', now(), now())`, e.lesson, e.class.ID).Error)
	return e
}

func (e env) assessment(mutate ...func(*domain.Assessment)) domain.Assessment {
	a := domain.Assessment{
		ClassID: e.class.ID, ModuleID: e.module.ID, Title: "Prova 1", Description: "Leia com atenção.", Type: domain.TypeExam, Status: domain.StatusScheduled,
		MaxScore: domain.Points(10), StartsAt: at(21, 9, 0), EndsAt: at(21, 11, 0), Composition: domain.CompositionManual, Audience: domain.AudienceAllClass,
		Modality: domain.ModalityInPerson, CreatedBy: e.teacher.ID, UpdatedBy: e.teacher.ID,
	}
	for _, m := range mutate {
		m(&a)
	}
	return a
}

func (e env) items(n int) []domain.Item {
	weights := domain.EqualWeights(domain.Points(10), n)
	out := make([]domain.Item, n)
	for i := range out {
		out[i] = domain.Item{QuestionID: e.bank[domain.DifficultyEasy][i%3], Position: i + 1, Weight: weights[i]}
		if i >= 3 {
			out[i].QuestionID = e.bank[domain.DifficultyMedium][i-3]
		}
	}
	return out
}

func (e env) created(at time.Time) domain.Event {
	return domain.Event{Kind: domain.EventCreated, ActorID: e.teacher.ID, CreatedAt: at}
}

// create stores a manual assessment with three questions and returns what was stored.
func (e env) create(t *testing.T, mutate ...func(*domain.Assessment)) domain.Assessment {
	t.Helper()
	a := e.assessment(mutate...)
	require.NoError(t, e.repo.Create(e.ctx, &a, e.items(3), nil, nil, e.created(e.now)))
	return a
}

func drawRules() []domain.DrawRule {
	return []domain.DrawRule{
		{Difficulty: domain.DifficultyEasy, Quantity: 3, Points: domain.Points(1)},
		{Difficulty: domain.DifficultyMedium, Quantity: 3, Points: domain.Points(1)},
		{Difficulty: domain.DifficultyHard, Quantity: 4, Points: domain.Points(1)},
	}
}

// ---- storing and reading ----

// Covers SPEC-075 CA-01, CA-05, CA-06, CA-07 (section 4): everything comes back as it went in, with the scores exact in hundredths, the times at the
// same instant, the questions in order and the students of a selected audience.
func TestRepository_StoresAndReadsEverythingBack(t *testing.T) {
	e := newEnv(t)
	a := e.assessment(func(a *domain.Assessment) {
		a.Audience, a.DurationMinutes, a.TeacherPrivateNotes = domain.AudienceSelected, ptr(60), ptr("Conferir o lab")
		a.MaxScore = domain.Points(10)
	})
	items := []domain.Item{
		{QuestionID: e.bank[domain.DifficultyEasy][0], Position: 2, Weight: domain.Points(3.33)},
		{QuestionID: e.bank[domain.DifficultyEasy][1], Position: 1, Weight: domain.Points(3.34)},
		{QuestionID: e.bank[domain.DifficultyEasy][2], Position: 3, Weight: domain.Points(3.33)},
	}
	require.NoError(t, e.repo.Create(e.ctx, &a, items, nil, []uuid.UUID{e.student.ID}, e.created(e.now)))
	require.NotEqual(t, uuid.Nil, a.ID, "the id is given on creation")

	got, err := e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, "Prova 1", got.Title)
	assert.Equal(t, domain.TypeExam, got.Type)
	assert.Equal(t, domain.StatusScheduled, got.Status)
	assert.Equal(t, domain.Points(10), got.MaxScore)
	assert.True(t, got.StartsAt.Equal(at(21, 9, 0)))
	assert.True(t, got.EndsAt.Equal(at(21, 11, 0)))
	require.NotNil(t, got.DurationMinutes)
	assert.Equal(t, 60, *got.DurationMinutes)
	require.NotNil(t, got.TeacherPrivateNotes)
	assert.Equal(t, "Conferir o lab", *got.TeacherPrivateNotes)
	assert.Equal(t, e.class.ID, got.ClassID)
	assert.Equal(t, e.module.ID, got.ModuleID)
	assert.Equal(t, domain.AudienceSelected, got.Audience)

	read, err := e.repo.Items(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, read, 3)
	assert.Equal(t, []int{1, 2, 3}, []int{read[0].Position, read[1].Position, read[2].Position}, "in the order of the exam")
	assert.Equal(t, domain.Points(3.34), read[0].Weight, "no float error: 3.34 stays 3.34")
	assert.Equal(t, domain.Points(3.33), read[1].Weight)

	students, err := e.repo.StudentIDs(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{e.student.ID}, students)

	events, err := e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, domain.EventCreated, events[0].Kind)
	assert.Equal(t, e.teacher.ID, events[0].ActorID)

	_, err = e.repo.Find(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAssessmentNotFound)
}

// Covers SPEC-075 CA-06 (RN-07): a draw keeps its total and its rules by level, and no items.
func TestRepository_StoresADraw(t *testing.T) {
	e := newEnv(t)
	a := e.assessment(func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(10) })
	require.NoError(t, e.repo.Create(e.ctx, &a, nil, drawRules(), nil, e.created(e.now)))

	got, err := e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)
	require.NotNil(t, got.DrawTotal)
	assert.Equal(t, 10, *got.DrawTotal)
	rules, err := e.repo.Rules(e.ctx, a.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, drawRules(), rules)
	items, err := e.repo.Items(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Empty(t, items)
}

// ---- the constraints of the database ----

// Covers SPEC-075 CA-02, CA-05 (section 4): the database holds the rules of the period, the score, the limits and the enumerations, whatever the
// service does. The first case is the control: a valid assessment is accepted, so the refusals below are the constraints and not a missing table.
func TestRepository_CheckConstraintsOnPeriodScoreAndWeights(t *testing.T) {
	e := newEnv(t)
	valid := e.assessment()
	require.NoError(t, e.repo.Create(e.ctx, &valid, e.items(3), nil, nil, e.created(e.now)), "control: a valid assessment is accepted")

	for name, mutate := range map[string]func(*domain.Assessment){
		"end equal to the start":  func(a *domain.Assessment) { a.EndsAt = a.StartsAt },
		"end before the start":    func(a *domain.Assessment) { a.EndsAt = a.StartsAt.Add(-time.Hour) },
		"score of zero":           func(a *domain.Assessment) { a.MaxScore = 0 },
		"score above 100":         func(a *domain.Assessment) { a.MaxScore = domain.Points(100.01) },
		"empty title":             func(a *domain.Assessment) { a.Title = "" },
		"title of 151":            func(a *domain.Assessment) { a.Title = strings.Repeat("a", 151) },
		"instructions of 20001":   func(a *domain.Assessment) { a.Description = strings.Repeat("a", 20001) },
		"notes of 5001":           func(a *domain.Assessment) { a.TeacherPrivateNotes = ptr(strings.Repeat("a", 5001)) },
		"unknown type":            func(a *domain.Assessment) { a.Type = "QUIZ" },
		"unknown status":          func(a *domain.Assessment) { a.Status = "DONE" },
		"unknown composition":     func(a *domain.Assessment) { a.Composition = "RANDOM" },
		"unknown audience":        func(a *domain.Assessment) { a.Audience = "GROUP" },
		"duration of 4 minutes":   func(a *domain.Assessment) { a.DurationMinutes = ptr(4) },
		"draw total of zero":      func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(0) },
		"draw total of 51":        func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(51) },
		"canceled with no reason": func(a *domain.Assessment) { a.Status = domain.StatusCanceled },
		"reason of 501": func(a *domain.Assessment) {
			a.Status, a.CancelReason = domain.StatusCanceled, ptr(strings.Repeat("a", 501))
		},
		"class that does not exist":  func(a *domain.Assessment) { a.ClassID = uuid.New() },
		"module that does not exist": func(a *domain.Assessment) { a.ModuleID = uuid.New() },
	} {
		a := e.assessment(mutate)
		err := e.repo.Create(e.ctx, &a, e.items(3), nil, nil, e.created(e.now))
		assert.Error(t, err, name)
	}

	// the items and the rules have limits of their own
	for name, items := range map[string][]domain.Item{
		"weight of zero":       {{QuestionID: e.bank[domain.DifficultyEasy][0], Position: 1, Weight: 0}},
		"position of zero":     {{QuestionID: e.bank[domain.DifficultyEasy][0], Position: 0, Weight: domain.Points(10)}},
		"question that is not": {{QuestionID: uuid.New(), Position: 1, Weight: domain.Points(10)}},
	} {
		a := e.assessment()
		assert.Error(t, e.repo.Create(e.ctx, &a, items, nil, nil, e.created(e.now)), name)
	}
	for name, rule := range map[string]domain.DrawRule{
		"quantity below zero": {Difficulty: domain.DifficultyEasy, Quantity: -1, Points: domain.Points(1)},
		"points of zero":      {Difficulty: domain.DifficultyEasy, Quantity: 1, Points: 0},
		"unknown level":       {Difficulty: "EXTREME", Quantity: 1, Points: domain.Points(1)},
	} {
		a := e.assessment(func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(1) })
		assert.Error(t, e.repo.Create(e.ctx, &a, nil, []domain.DrawRule{rule}, nil, e.created(e.now)), name)
	}
}

// Covers SPEC-075 CA-03 (section 4): a lesson has at most one SCHEDULED assessment, and a canceled one frees it.
func TestRepository_OneActiveAssessmentPerSession(t *testing.T) {
	e := newEnv(t)
	first := e.create(t, func(a *domain.Assessment) { a.ClassSessionID = &e.lesson })

	second := e.assessment(func(a *domain.Assessment) { a.ClassSessionID = &e.lesson })
	assert.Error(t, e.repo.Create(e.ctx, &second, e.items(3), nil, nil, e.created(e.now)), "a second active assessment for the same lesson")

	first.Status, first.CanceledBy, first.CanceledAt, first.CancelReason = domain.StatusCanceled, &e.teacher.ID, ptr(e.now), ptr("Greve")
	require.NoError(t, e.repo.Save(e.ctx, &first, service.Replacements{}, &domain.Event{Kind: domain.EventCanceled, ActorID: e.teacher.ID, Reason: ptr("Greve"), CreatedAt: e.now}))

	third := e.assessment(func(a *domain.Assessment) { a.ClassSessionID = &e.lesson })
	assert.NoError(t, e.repo.Create(e.ctx, &third, e.items(3), nil, nil, e.created(e.now)), "the canceled one freed the lesson")

	active, err := e.repo.HasActiveForLesson(e.ctx, e.lesson)
	require.NoError(t, err)
	assert.True(t, active)
	none, err := e.repo.HasActiveForLesson(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.False(t, none)
}

// Covers SPEC-075 CA-05, CA-06 (section 4): a question cannot be twice in an assessment, nor a level twice in the rules. The first create is the control.
func TestRepository_UniqueQuestionPerAssessmentAndDifficultyPerRule(t *testing.T) {
	e := newEnv(t)
	ok := e.assessment()
	require.NoError(t, e.repo.Create(e.ctx, &ok, e.items(3), nil, nil, e.created(e.now)), "control")

	twice := e.assessment()
	same := e.items(2)
	same[1].QuestionID = same[0].QuestionID
	assert.Error(t, e.repo.Create(e.ctx, &twice, same, nil, nil, e.created(e.now)), "the same question twice")

	rules := e.assessment(func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(2) })
	dup := []domain.DrawRule{
		{Difficulty: domain.DifficultyEasy, Quantity: 1, Points: domain.Points(5)},
		{Difficulty: domain.DifficultyEasy, Quantity: 1, Points: domain.Points(5)},
	}
	assert.Error(t, e.repo.Create(e.ctx, &rules, nil, dup, nil, e.created(e.now)), "the same level twice")

	students := e.assessment(func(a *domain.Assessment) { a.Audience = domain.AudienceSelected })
	assert.Error(t, e.repo.Create(e.ctx, &students, e.items(3), nil, []uuid.UUID{e.student.ID, e.student.ID}, e.created(e.now)), "the same student twice")
}

// ---- changing ----

// Covers SPEC-075 CA-11, CA-12, CA-18 (RN-19): saving replaces the composition and appends the event in one transaction; when something fails, nothing
// changes and no event is written.
func TestRepository_SaveReplacesCompositionAndAppendsTheEvent(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)

	newItems := e.items(2)
	a.Title, a.UpdatedBy = "Prova 1 (revisada)", e.teacher.ID
	require.NoError(t, e.repo.Save(e.ctx, &a, service.Replacements{Items: &newItems},
		&domain.Event{Kind: domain.EventUpdated, ActorID: e.teacher.ID, ChangedFields: []string{"title", "items"}, CreatedAt: e.now.Add(time.Minute)}))

	got, err := e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, "Prova 1 (revisada)", got.Title)
	items, err := e.repo.Items(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, items, 2, "the old items were replaced, not added to")
	events, err := e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, domain.EventCreated, events[0].Kind, "in the order they happened")
	assert.Equal(t, domain.EventUpdated, events[1].Kind)
	assert.ElementsMatch(t, []string{"title", "items"}, events[1].ChangedFields)

	// a failure in the middle leaves everything as it was
	bad := e.items(2)
	bad[1].QuestionID = bad[0].QuestionID
	a.Title = "Nunca gravado"
	assert.Error(t, e.repo.Save(e.ctx, &a, service.Replacements{Items: &bad}, &domain.Event{Kind: domain.EventUpdated, ActorID: e.teacher.ID, CreatedAt: e.now.Add(2 * time.Minute)}))
	got, err = e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, "Prova 1 (revisada)", got.Title, "the title was not written")
	items, err = e.repo.Items(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, items, 2)
	events, err = e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, events, 2, "and no event was written")

	// the audience is replaced too
	students := []uuid.UUID{e.student.ID}
	a.Audience = domain.AudienceSelected
	require.NoError(t, e.repo.Save(e.ctx, &a, service.Replacements{Students: &students}, nil))
	chosen, err := e.repo.StudentIDs(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Equal(t, students, chosen)
}

// Covers SPEC-075 CA-12 (RN-11): a reschedule keeps the old and the new dates in the event.
func TestRepository_KeepsTheDatesOfAReschedule(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	oldStart, oldEnd := a.StartsAt, a.EndsAt
	a.StartsAt, a.EndsAt = at(22, 14, 0), at(22, 16, 0)
	reason := "Laboratório ocupado"
	require.NoError(t, e.repo.Save(e.ctx, &a, service.Replacements{}, &domain.Event{
		Kind: domain.EventRescheduled, ActorID: e.teacher.ID, Reason: &reason, CreatedAt: e.now.Add(time.Minute),
		OldStartsAt: &oldStart, OldEndsAt: &oldEnd, NewStartsAt: &a.StartsAt, NewEndsAt: &a.EndsAt,
	}))

	events, err := e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, events, 2)
	r := events[1]
	require.NotNil(t, r.OldStartsAt)
	require.NotNil(t, r.NewEndsAt)
	assert.True(t, r.OldStartsAt.Equal(at(21, 9, 0)))
	assert.True(t, r.OldEndsAt.Equal(at(21, 11, 0)))
	assert.True(t, r.NewStartsAt.Equal(at(22, 14, 0)))
	assert.True(t, r.NewEndsAt.Equal(at(22, 16, 0)))
	require.NotNil(t, r.Reason)
	assert.Equal(t, reason, *r.Reason)
}

// Covers SPEC-075 CA-18 (RN-15, section 4): the history cannot be changed or erased, even by hand in the database (the same guard as the other
// append-only tables). The first event is the control.
func TestRepository_EventsAreAppendOnly(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	events, err := e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, events, 1, "control: the creation wrote its event")

	err = e.db.Conn(e.ctx).Exec(`UPDATE assessment_events SET reason = 'adulterado' WHERE assessment_id = ?`, a.ID).Error
	require.Error(t, err)
	assert.Contains(t, err.Error(), "append-only")
	err = e.db.Conn(e.ctx).Exec(`DELETE FROM assessment_events WHERE assessment_id = ?`, a.ID).Error
	require.Error(t, err)
	assert.Contains(t, err.Error(), "append-only")

	events, err = e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, events, 1)
}

// Covers SPEC-075 CA-10 (RN-13): saving the notes writes the notes and nothing else: not updated_at, not updated_by, no event. An empty text clears them.
func TestRepository_SaveNotesTouchesOnlyTheNotes(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	before, err := e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)

	require.NoError(t, e.repo.SaveNotes(e.ctx, a.ID, ptr("Atenção na questão 3")))
	after, err := e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)
	require.NotNil(t, after.TeacherPrivateNotes)
	assert.Equal(t, "Atenção na questão 3", *after.TeacherPrivateNotes)
	assert.True(t, before.UpdatedAt.Equal(after.UpdatedAt), "updated_at is not touched")
	assert.Equal(t, before.UpdatedBy, after.UpdatedBy)
	events, err := e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, events, 1, "no event")

	require.NoError(t, e.repo.SaveNotes(e.ctx, a.ID, nil))
	cleared, err := e.repo.Find(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Nil(t, cleared.TeacherPrivateNotes)
}

// ---- listing ----

// Covers SPEC-075 CA-19, CA-23 (section 4): the list of a class is newest start first, without the deleted and without other classes.
func TestRepository_ListsByClassNewestFirst(t *testing.T) {
	e := newEnv(t)
	day := func(d int) func(*domain.Assessment) {
		return func(a *domain.Assessment) { a.StartsAt, a.EndsAt = at(d, 9, 0), at(d, 11, 0) }
	}
	a21, a23, a22 := e.create(t, day(21)), e.create(t, day(23)), e.create(t, day(22))
	deleted := e.create(t, day(24))
	require.NoError(t, e.db.Conn(e.ctx).Exec(`UPDATE assessments SET deleted_at = now() WHERE id = ?`, deleted.ID).Error)

	other := classdomain.ClassGroup{TeacherID: e.teacher.ID, Name: "Outra", CourseCode: "SO35E", Semester: "2026/2", StartDate: at(1, 0, 0), EndDate: at(31, 0, 0), Status: classdomain.ClassStatusActive}
	require.NoError(t, classrepository.New(e.db).CreateClass(e.ctx, &other, nil, e.now))
	foreign := e.assessment(func(a *domain.Assessment) { a.ClassID = other.ID })
	require.NoError(t, e.repo.Create(e.ctx, &foreign, e.items(3), nil, nil, e.created(e.now)))

	list, err := e.repo.ListByClass(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []uuid.UUID{a23.ID, a22.ID, a21.ID}, []uuid.UUID{list[0].ID, list[1].ID, list[2].ID})
}

// Covers SPEC-075 CA-19 (RN-17): the range gives what crosses it: one that starts before and ends inside, one inside, one that starts inside and ends
// after; not one that ends exactly at the start of the range nor one that starts exactly at its end; canceled ones come too.
func TestRepository_ListsInRangeByOverlap(t *testing.T) {
	e := newEnv(t)
	span := func(sd, sh, ed, eh int) func(*domain.Assessment) {
		return func(a *domain.Assessment) {
			a.Type, a.Modality, a.StartsAt, a.EndsAt = domain.TypeAssignment, domain.ModalityOnline, at(sd, sh, 0), at(ed, eh, 0) // an assignment is only online (SPEC-076)
		}
	}
	before := e.create(t, span(18, 9, 19, 9))       // ends before the range
	touchesStart := e.create(t, span(19, 9, 20, 0)) // ends exactly when the range starts
	crossesStart := e.create(t, span(19, 9, 21, 9)) // starts before, ends inside
	inside := e.create(t, span(22, 9, 22, 11))
	crossesEnd := e.create(t, span(24, 9, 27, 9)) // starts inside, ends after
	touchesEnd := e.create(t, span(26, 0, 27, 9)) // starts exactly when the range ends
	canceled := e.create(t, span(23, 9, 23, 11))
	canceled.Status, canceled.CancelReason, canceled.CanceledBy, canceled.CanceledAt = domain.StatusCanceled, ptr("Greve"), &e.teacher.ID, ptr(e.now)
	require.NoError(t, e.repo.Save(e.ctx, &canceled, service.Replacements{}, &domain.Event{Kind: domain.EventCanceled, ActorID: e.teacher.ID, Reason: ptr("Greve"), CreatedAt: e.now}))

	got, err := e.repo.ListInRange(e.ctx, []uuid.UUID{e.class.ID}, at(20, 0, 0), at(26, 0, 0))
	require.NoError(t, err)
	ids := make([]uuid.UUID, len(got))
	for i, a := range got {
		ids[i] = a.ID
	}
	assert.ElementsMatch(t, []uuid.UUID{crossesStart.ID, inside.ID, canceled.ID, crossesEnd.ID}, ids)
	assert.NotContains(t, ids, before.ID)
	assert.NotContains(t, ids, touchesStart.ID)
	assert.NotContains(t, ids, touchesEnd.ID)

	none, err := e.repo.ListInRange(e.ctx, nil, at(20, 0, 0), at(26, 0, 0))
	require.NoError(t, err)
	assert.Empty(t, none, "no class, no assessment")
}

// ---- the guard of the question bank (RN-18) ----

// Covers SPEC-075 CA-20 (RN-18): the questions of SCHEDULED manual assessments and the biggest demand of the SCHEDULED draws, by level, in the module.
func TestRepository_TellsWhatTheBankMustKeep(t *testing.T) {
	e := newEnv(t)
	manual := e.create(t)
	used := e.items(3)[0].QuestionID
	notUsed := e.bank[domain.DifficultyHard][0]

	inUse, err := e.repo.InScheduledManual(e.ctx, used)
	require.NoError(t, err)
	assert.True(t, inUse)
	inUse, err = e.repo.InScheduledManual(e.ctx, notUsed)
	require.NoError(t, err)
	assert.False(t, inUse)

	manual.Status, manual.CancelReason, manual.CanceledBy, manual.CanceledAt = domain.StatusCanceled, ptr("Greve"), &e.teacher.ID, ptr(e.now)
	require.NoError(t, e.repo.Save(e.ctx, &manual, service.Replacements{}, &domain.Event{Kind: domain.EventCanceled, ActorID: e.teacher.ID, Reason: ptr("Greve"), CreatedAt: e.now}))
	inUse, err = e.repo.InScheduledManual(e.ctx, used)
	require.NoError(t, err)
	assert.False(t, inUse, "a canceled assessment no longer holds its questions")

	small := e.assessment(func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(3) })
	require.NoError(t, e.repo.Create(e.ctx, &small, nil, []domain.DrawRule{{Difficulty: domain.DifficultyEasy, Quantity: 1, Points: domain.Points(3.34)},
		{Difficulty: domain.DifficultyMedium, Quantity: 1, Points: domain.Points(3.33)}, {Difficulty: domain.DifficultyHard, Quantity: 1, Points: domain.Points(3.33)}}, nil, e.created(e.now)))
	big := e.assessment(func(a *domain.Assessment) { a.Composition, a.DrawTotal = domain.CompositionDraw, ptr(2) })
	require.NoError(t, e.repo.Create(e.ctx, &big, nil, []domain.DrawRule{{Difficulty: domain.DifficultyEasy, Quantity: 2, Points: domain.Points(5)}}, nil, e.created(e.now)))

	demand, err := e.repo.DrawDemand(e.ctx, e.module.ID)
	require.NoError(t, err)
	assert.Equal(t, map[domain.Difficulty]int{domain.DifficultyEasy: 2, domain.DifficultyMedium: 1, domain.DifficultyHard: 1}, demand, "the biggest ask of each level")

	elsewhere, err := e.repo.DrawDemand(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.Empty(t, elsewhere)
}

// ---- the migration ----

// migrationParts reads the up and the down halves of the migration whose file starts with prefix.
func migrationParts(t *testing.T, prefix string) (up, down string) {
	t.Helper()
	entries, err := migrations.FS.ReadDir(".")
	require.NoError(t, err)
	var text string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) {
			raw, err := migrations.FS.ReadFile(entry.Name())
			require.NoError(t, err)
			text = string(raw)
		}
	}
	require.NotEmpty(t, text, "migration %s exists", prefix)
	text = strings.ReplaceAll(text, "\r\n", "\n")
	upAt, downAt := strings.Index(text, "-- +goose Up"), strings.Index(text, "-- +goose Down")
	require.True(t, upAt >= 0 && downAt > upAt, "migration %s has its Up and its Down", prefix)
	return text[upAt+len("-- +goose Up") : downAt], text[downAt+len("-- +goose Down"):]
}

func runMigration(t *testing.T, e env, part string) {
	t.Helper()
	// goose runs one statement at a time; the guard function of the append-only table is one statement with ';' inside, marked by StatementBegin
	for _, statement := range splitStatements(part) {
		require.NoError(t, e.db.Conn(e.ctx).Exec(statement).Error, statement)
	}
}

func splitStatements(part string) []string {
	var out []string
	for {
		part = strings.TrimSpace(part)
		if part == "" {
			return out
		}
		if strings.HasPrefix(part, "-- +goose StatementBegin") {
			end := strings.Index(part, "-- +goose StatementEnd")
			body := strings.TrimSpace(part[len("-- +goose StatementBegin"):end])
			out = append(out, body)
			part = part[end+len("-- +goose StatementEnd"):]
			continue
		}
		next := strings.Index(part, ";\n")
		if next < 0 {
			next = len(part)
		} else {
			next++
		}
		if stmt := strings.TrimSpace(part[:next]); stmt != "" && !strings.HasPrefix(stmt, "--") {
			out = append(out, stmt)
		}
		part = part[next:]
	}
}

func tablesOf(t *testing.T, e env) map[string]bool {
	t.Helper()
	var names []string
	require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()
		AND table_name IN ('assessments','assessment_items','assessment_draw_rules','assessment_students','assessment_events')`).Scan(&names).Error)
	out := map[string]bool{}
	for _, n := range names {
		out[n] = true
	}
	return out
}

// Covers SPEC-075 CA-30 (section 4): migration 00041 creates the five tables, going down takes them away and leaves the rest of the schema, and
// going up again brings them back ready to use. Migration 00042 (SPEC-076) hangs on these tables, so it goes down first and comes back last.
func TestMigration00041_UpAndDown(t *testing.T) {
	e := newEnv(t) // every migration was applied by the helper
	up, down := migrationParts(t, "00041_")
	up2, down2 := migrationParts(t, "00042_")

	five := []string{"assessments", "assessment_items", "assessment_draw_rules", "assessment_students", "assessment_events"}
	for _, name := range five {
		assert.True(t, tablesOf(t, e)[name], name+" exists after the migration")
	}
	e.create(t)

	runMigration(t, e, down2)
	runMigration(t, e, down)
	assert.Empty(t, tablesOf(t, e), "the Down took the five tables away")
	var classes int64
	require.NoError(t, e.db.Conn(e.ctx).Table("classes").Count(&classes).Error, "and left the rest of the schema")
	assert.Equal(t, int64(1), classes)

	runMigration(t, e, up)
	runMigration(t, e, up2)
	for _, name := range five {
		assert.True(t, tablesOf(t, e)[name], name+" is back after going up again")
	}
	again := e.assessment()
	assert.NoError(t, e.repo.Create(e.ctx, &again, e.items(3), nil, nil, e.created(e.now)), "and it is ready to use")
}
