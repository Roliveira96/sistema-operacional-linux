package service_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

func at(day, hour, minute int) time.Time {
	return time.Date(2026, 10, day, hour, minute, 0, 0, domain.Location())
}

func ptr[T any](v T) *T { return &v }

var ctx = context.Background()

type fixture struct {
	repo      *fakeRepo
	classes   *fakeClasses
	students  *fakeStudents
	lessons   *fakeLessons
	modules   *fakeModules
	questions *fakeQuestions
	homolog   *fakeHomologation
	users     *fakeUsers
	svc       *service.Service
	now       time.Time

	teacher, admin, other service.Actor
	class, otherClass     service.ClassInfo
	module                service.Module
	otherModule           uuid.UUID

	ana, bruno, carla, outsider service.Student

	easy, medium, hard []uuid.UUID // the eligible questions of the module, by level
}

// newFixture: Tuesday 2026-10-20 08:00 (Brasília); a class with three active students, a module assigned to it, and a bank with
// 5 easy, 4 medium and 4 hard eligible questions plus the ones that are not eligible, one for each reason.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{
		repo: newFakeRepo(), now: at(20, 8, 0),
		classes:   &fakeClasses{classes: map[uuid.UUID]service.ClassInfo{}},
		students:  &fakeStudents{active: map[uuid.UUID][]service.Student{}},
		lessons:   &fakeLessons{lessons: map[uuid.UUID]service.Lesson{}},
		modules:   &fakeModules{assigned: map[[2]uuid.UUID]service.Module{}},
		questions: &fakeQuestions{bank: map[uuid.UUID]bankQuestion{}},
		homolog:   &fakeHomologation{homologated: map[uuid.UUID]bool{}},
		users:     &fakeUsers{names: map[uuid.UUID]string{}},
	}
	f.teacher = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	f.admin = service.Actor{UserID: uuid.New(), Role: authn.RoleAdmin}
	f.other = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	f.users.names[f.teacher.UserID], f.users.names[f.admin.UserID], f.users.names[f.other.UserID] = "Profa. Sediane", "Administrador", "Outro Professor"
	f.class = service.ClassInfo{ID: uuid.New(), TeacherID: f.teacher.UserID}
	f.otherClass = service.ClassInfo{ID: uuid.New(), TeacherID: f.other.UserID}
	f.classes.classes[f.class.ID] = f.class
	f.classes.classes[f.otherClass.ID] = f.otherClass

	f.module = service.Module{ID: uuid.New(), Title: "Permissões e donos"}
	f.otherModule = uuid.New()
	f.modules.assigned[[2]uuid.UUID{f.class.ID, f.module.ID}] = f.module

	f.ana = service.Student{ID: uuid.New(), Name: "Ana", AcademicID: "1000001"}
	f.bruno = service.Student{ID: uuid.New(), Name: "Bruno", AcademicID: "1000002"}
	f.carla = service.Student{ID: uuid.New(), Name: "Carla", AcademicID: "1000003"}
	f.outsider = service.Student{ID: uuid.New(), Name: "Davi", AcademicID: "1000004"}
	for _, s := range []service.Student{f.ana, f.bruno, f.carla} {
		f.students.enroll(f.class.ID, s)
	}

	f.easy = f.addQuestions(5, domain.DifficultyEasy)
	f.medium = f.addQuestions(4, domain.DifficultyMedium)
	f.hard = f.addQuestions(4, domain.DifficultyHard)

	f.svc = service.New(f.repo, service.Ports{
		Classes: f.classes, Students: f.students, Lessons: f.lessons, Modules: f.modules, Questions: f.questions, Homologation: f.homolog, Users: f.users,
	}, func() time.Time { return f.now })
	return f
}

func (f *fixture) addQuestions(n int, level domain.Difficulty) []uuid.UUID {
	var ids []uuid.UUID
	for i := 0; i < n; i++ {
		id := uuid.New()
		title := fmt.Sprintf("%s %d", level, i+1)
		f.questions.bank[id] = bankQuestion{
			QuestionContent: service.QuestionContent{
				Question:  service.Question{ID: id, Title: title, Kind: "PRACTICAL", Difficulty: level},
				Statement: "Enunciado de " + title, AnswerKey: "Gabarito de " + title, Explanation: "Porque sim",
			},
			ModuleID: f.module.ID, Published: true, In: true,
		}
		ids = append(ids, id)
	}
	return ids
}

// notEligible adds a question that is in the bank but fails one rule, and returns its id.
func (f *fixture) notEligible(reason string) uuid.UUID {
	id := uuid.New()
	q := bankQuestion{
		QuestionContent: service.QuestionContent{Question: service.Question{ID: id, Title: reason, Kind: "PRACTICAL", Difficulty: domain.DifficultyEasy}},
		ModuleID:        f.module.ID, Published: true, In: true,
	}
	switch reason {
	case "other module":
		q.ModuleID = f.otherModule
	case "unpublished":
		q.Published = false
	case "not in the assessment":
		q.In = false
	case "deleted":
		q.Deleted = true
	}
	f.questions.bank[id] = q
	return id
}

func (f *fixture) as(s service.Student) service.Actor {
	return service.Actor{UserID: s.ID, Role: authn.RoleStudent}
}

// items gives n manual items of easy questions, with equal weights adding up to the maximum score.
func (f *fixture) items(n int) []domain.Item {
	weights := domain.EqualWeights(domain.Points(10), n)
	out := make([]domain.Item, n)
	for i := range out {
		out[i] = domain.Item{QuestionID: f.easy[i], Position: i + 1, Weight: weights[i]}
	}
	return out
}

// input is a valid exam: Wednesday 21/10, 09:00 to 11:00, three manual questions, the whole class.
func (f *fixture) input() service.CreateInput {
	return service.CreateInput{
		ModuleID: &f.module.ID, Title: "Prova 1", Description: "Leia com atenção.", Type: domain.TypeExam, MaxScore: domain.Points(10),
		StartsAt: ptr(at(21, 9, 0)), EndsAt: ptr(at(21, 11, 0)), Composition: domain.CompositionManual, Items: f.items(3),
		Audience: domain.AudienceAllClass,
	}
}

func (f *fixture) draw(easy, medium, hard int, pe, pm, ph float64) *service.Draw {
	d := &service.Draw{Total: easy + medium + hard}
	for _, r := range []domain.DrawRule{
		{Difficulty: domain.DifficultyEasy, Quantity: easy, Points: domain.Points(pe)},
		{Difficulty: domain.DifficultyMedium, Quantity: medium, Points: domain.Points(pm)},
		{Difficulty: domain.DifficultyHard, Quantity: hard, Points: domain.Points(ph)},
	} {
		if r.Quantity > 0 {
			d.Rules = append(d.Rules, r)
		}
	}
	return d
}

func (f *fixture) create(t *testing.T, mutate ...func(*service.CreateInput)) service.Summary {
	t.Helper()
	in := f.input()
	for _, m := range mutate {
		m(&in)
	}
	got, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	require.NoError(t, err)
	return got
}

func (f *fixture) lesson(topic string, withModule bool) service.Lesson {
	l := service.Lesson{ID: uuid.New(), ClassID: f.class.ID, StartsAt: at(22, 13, 50), EndsAt: at(22, 15, 30), Topic: topic}
	if withModule {
		l.ModuleID = &f.module.ID
	}
	f.lessons.lessons[l.ID] = l
	return l
}

// ---- RN-02, RN-03, RN-15: creating ----

// Covers SPEC-075 CA-01 (RN-02, RN-15): a valid assessment is stored SCHEDULED, with its author, the phase from the clock and the CREATED event.
func TestCreate_StoresScheduledAndWritesTheCreatedEvent(t *testing.T) {
	f := newFixture(t)
	got, err := f.svc.Create(ctx, f.teacher, f.class.ID, f.input())
	require.NoError(t, err)

	assert.Equal(t, domain.StatusScheduled, got.Status)
	assert.Equal(t, domain.PhaseUpcoming, got.Phase)
	assert.Equal(t, f.teacher.UserID, got.CreatedBy)
	assert.Equal(t, f.teacher.UserID, got.UpdatedBy)
	assert.Equal(t, "Profa. Sediane", got.CreatedByName)
	assert.Equal(t, "Profa. Sediane", got.UpdatedByName)
	assert.Equal(t, "Permissões e donos", got.ModuleTitle)
	assert.Equal(t, 3, got.TotalQuestions)
	assert.Equal(t, 3, got.EligibleStudents)
	assert.False(t, got.Frozen)
	assert.Equal(t, f.class.ID, got.ClassID)

	events := f.repo.events[got.ID]
	require.Len(t, events, 1)
	assert.Equal(t, domain.EventCreated, events[0].Kind)
	assert.Equal(t, f.teacher.UserID, events[0].ActorID)
	assert.Len(t, f.repo.items[got.ID], 3)

	_, err = f.svc.Create(ctx, f.admin, f.class.ID, f.input())
	assert.NoError(t, err, "an administrator creates too")
}

// Covers SPEC-075 CA-02 (RN-03): the period is checked before anything is written.
func TestCreate_RejectsABadPeriod(t *testing.T) {
	f := newFixture(t)
	for name, change := range map[string]func(*service.CreateInput){
		"end before start":   func(in *service.CreateInput) { in.EndsAt = ptr(at(21, 8, 0)) },
		"start in the past":  func(in *service.CreateInput) { in.StartsAt = ptr(at(19, 9, 0)); in.EndsAt = ptr(at(19, 11, 0)) },
		"exam over two days": func(in *service.CreateInput) { in.EndsAt = ptr(at(22, 11, 0)) },
	} {
		in := f.input()
		change(&in)
		_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
		assert.ErrorIs(t, err, domain.ErrInvalidPeriod, name)
	}
	assert.Zero(t, f.repo.writes)
}

// Covers SPEC-075 CA-03 (RN-04): from a lesson, the time, the topic and the module come from the lesson when the fields are not sent,
// the link is kept and the lesson is not touched.
func TestCreate_FromSessionUsesTimeTopicAndModuleAndLeavesTheSessionAlone(t *testing.T) {
	f := newFixture(t)
	lesson := f.lesson("Permissões e donos", true)
	original := f.lessons.lessons[lesson.ID]

	in := f.input()
	in.ClassSessionID, in.ModuleID, in.Title, in.StartsAt, in.EndsAt = &lesson.ID, nil, "", nil, nil
	got, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	require.NoError(t, err)

	stored := f.repo.assessments[got.ID]
	assert.Equal(t, "Permissões e donos", stored.Title)
	assert.True(t, stored.StartsAt.Equal(lesson.StartsAt))
	assert.True(t, stored.EndsAt.Equal(lesson.EndsAt))
	assert.Equal(t, f.module.ID, stored.ModuleID)
	require.NotNil(t, stored.ClassSessionID)
	assert.Equal(t, lesson.ID, *stored.ClassSessionID)
	assert.Equal(t, original, f.lessons.lessons[lesson.ID], "the lesson is read, never changed")

	over := f.input()
	over.ClassSessionID = ptr(f.lesson("Outro tema", true).ID)
	over.Title, over.StartsAt, over.EndsAt = "Prova prática", ptr(at(23, 9, 0)), ptr(at(23, 11, 0))
	got, err = f.svc.Create(ctx, f.teacher, f.class.ID, over)
	require.NoError(t, err)
	stored = f.repo.assessments[got.ID]
	assert.Equal(t, "Prova prática", stored.Title, "what the teacher sends wins")
	assert.True(t, stored.StartsAt.Equal(at(23, 9, 0)))

	noTopic := f.input()
	noTopic.ClassSessionID, noTopic.Title = ptr(f.lesson("", true).ID), ""
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, noTopic)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "no title and no topic")

	noModule := f.input()
	noModule.ClassSessionID, noModule.ModuleID = ptr(f.lesson("Tema", false).ID), nil
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, noModule)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "no module and the lesson has none")
}

// Covers SPEC-075 CA-03 (RN-04): a lesson of another class, a canceled one and one that already has an active assessment are refused;
// canceling the assessment frees the lesson.
func TestCreate_RejectsSessionOfOtherClassCanceledOrAlreadyConverted(t *testing.T) {
	f := newFixture(t)
	convert := func(lessonID uuid.UUID) (service.Summary, error) {
		in := f.input()
		in.ClassSessionID, in.StartsAt, in.EndsAt = &lessonID, nil, nil
		return f.svc.Create(ctx, f.teacher, f.class.ID, in)
	}

	foreign := f.lesson("Tema", true)
	foreign.ClassID = f.otherClass.ID
	f.lessons.lessons[foreign.ID] = foreign
	_, err := convert(foreign.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a lesson of another class")
	_, err = convert(uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a lesson that does not exist")

	canceled := f.lesson("Tema", true)
	canceled.Canceled = true
	f.lessons.lessons[canceled.ID] = canceled
	_, err = convert(canceled.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotConvertible, "a canceled lesson")

	lesson := f.lesson("Tema", true)
	first, err := convert(lesson.ID)
	require.NoError(t, err)
	_, err = convert(lesson.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotConvertible, "a lesson with an active assessment")

	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, first.ID, "Falta de energia")
	require.NoError(t, err)
	_, err = convert(lesson.ID)
	assert.NoError(t, err, "a canceled assessment frees the lesson")
}

// Covers SPEC-075 CA-04 (RN-05, D-03): the module must be assigned to the class, and the assessment has one module.
func TestCreate_RejectsModuleNotAssignedToTheClass(t *testing.T) {
	f := newFixture(t)
	in := f.input()
	in.ModuleID = &f.otherModule
	_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrModuleNotAssigned)

	in.ModuleID = nil
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "a module is needed when there is no lesson to take it from")
	assert.Zero(t, f.repo.writes)
}

// Covers SPEC-075 CA-04 (RN-05): a question of another module, unpublished, outside the assessment bank or deleted is refused.
func TestCreate_RejectsQuestionsThatAreNotEligible(t *testing.T) {
	f := newFixture(t)
	for _, reason := range []string{"other module", "unpublished", "not in the assessment", "deleted"} {
		in := f.input()
		in.Items = f.items(3)
		in.Items[1].QuestionID = f.notEligible(reason)
		_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
		assert.ErrorIs(t, err, domain.ErrQuestionNotEligible, reason)
	}
	in := f.input()
	in.Items = f.items(3)
	in.Items[2].QuestionID = uuid.New()
	_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrQuestionNotEligible, "a question that does not exist")
	assert.Zero(t, f.repo.writes)
}

// Covers SPEC-075 CA-05 (RN-06): the manual composition is checked by the rules of the domain and nothing is stored when it fails.
func TestCreate_ManualRejectsDuplicatesEmptyAndWrongSum(t *testing.T) {
	f := newFixture(t)
	cases := map[string]struct {
		change func(*service.CreateInput)
		want   error
	}{
		"no questions": {func(in *service.CreateInput) { in.Items = nil }, domain.ErrInvalidAssessment},
		"repeated question": {func(in *service.CreateInput) {
			in.Items[1].QuestionID = in.Items[0].QuestionID
		}, domain.ErrInvalidAssessment},
		"sum below the maximum": {func(in *service.CreateInput) { in.Items[0].Weight = domain.Points(3.33) }, domain.ErrWeightsMismatch},
		"a draw sent in manual": {func(in *service.CreateInput) { in.Draw = f.draw(3, 3, 4, 1, 1, 1) }, domain.ErrInvalidAssessment},
		"items sent in a draw": {func(in *service.CreateInput) {
			in.Composition, in.Draw = domain.CompositionDraw, f.draw(3, 3, 4, 1, 1, 1)
		}, domain.ErrInvalidAssessment},
	}
	for name, c := range cases {
		in := f.input()
		c.change(&in)
		_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
		assert.ErrorIs(t, err, c.want, name)
	}
	assert.Zero(t, f.repo.writes)
}

// Covers SPEC-075 CA-06 (RN-07): a valid draw stores the rules and the total, and no items.
func TestCreate_DrawStoresTheRulesAndTheTotal(t *testing.T) {
	f := newFixture(t)
	got := f.create(t, func(in *service.CreateInput) {
		in.Composition, in.Items, in.Draw = domain.CompositionDraw, nil, f.draw(3, 3, 4, 1, 1, 1)
	})
	assert.Equal(t, domain.CompositionDraw, got.Composition)
	assert.Equal(t, 10, got.TotalQuestions)
	assert.Empty(t, f.repo.items[got.ID])
	assert.Len(t, f.repo.rules[got.ID], 3)
	require.NotNil(t, f.repo.assessments[got.ID].DrawTotal)
	assert.Equal(t, 10, *f.repo.assessments[got.ID].DrawTotal)
}

// Covers SPEC-075 CA-06 (RN-07): every level without enough questions is reported with what was asked and what the bank has.
func TestCreate_DrawReportsEachLevelWithoutStock(t *testing.T) {
	f := newFixture(t)
	in := f.input()
	in.Composition, in.Items = domain.CompositionDraw, nil
	in.Draw = f.draw(6, 5, 4, 0.5, 0.6, 1) // 3.00 + 3.00 + 4.00 = 10.00; the bank has 5, 4 and 4

	_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	require.ErrorIs(t, err, domain.ErrInsufficientStock)
	var stock *domain.StockError
	require.True(t, errors.As(err, &stock))
	assert.Equal(t, []domain.Shortage{
		{Difficulty: domain.DifficultyEasy, Asked: 6, Available: 5},
		{Difficulty: domain.DifficultyMedium, Asked: 5, Available: 4},
	}, stock.Short)
	assert.Zero(t, f.repo.writes)

	// the questions that are not eligible are not in the stock
	f.notEligible("unpublished")
	f.notEligible("deleted")
	in.Draw = f.draw(6, 0, 0, 1.66, 0, 0)
	in.MaxScore = domain.Points(9.96)
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrInsufficientStock)
}

// Covers SPEC-075 CA-06 (RN-07): the quantities must add up to the total, and the points to the maximum score.
func TestCreate_DrawRefusesWrongTotalAndWrongPoints(t *testing.T) {
	f := newFixture(t)
	in := f.input()
	in.Composition, in.Items = domain.CompositionDraw, nil

	in.Draw = f.draw(3, 3, 4, 1, 1, 1)
	in.Draw.Total = 9
	_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrDrawMismatch)

	in.Draw = f.draw(3, 3, 4, 1, 1, 1.01)
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrWeightsMismatch)

	in.Draw = nil
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "a draw composition needs the draw")
	assert.Zero(t, f.repo.writes)
}

// Covers SPEC-075 CA-07 (RN-08): SELECTED needs a list of students with an ACTIVE enrollment in the class; ALL_CLASS takes no list.
func TestCreate_SelectedNeedsActiveStudentsOfTheClass(t *testing.T) {
	f := newFixture(t)
	selected := func(ids ...uuid.UUID) service.CreateInput {
		in := f.input()
		in.Audience, in.StudentIDs = domain.AudienceSelected, ids
		return in
	}

	_, err := f.svc.Create(ctx, f.teacher, f.class.ID, selected())
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "an empty list")
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, selected(f.ana.ID, f.outsider.ID))
	assert.ErrorIs(t, err, domain.ErrStudentNotInClass, "a student who is not in the class")
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, selected(f.ana.ID, uuid.New()))
	assert.ErrorIs(t, err, domain.ErrStudentNotInClass, "a student that does not exist")

	in := f.input()
	in.StudentIDs = []uuid.UUID{f.ana.ID}
	_, err = f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment, "ALL_CLASS takes no list")

	got, err := f.svc.Create(ctx, f.teacher, f.class.ID, selected(f.ana.ID, f.bruno.ID))
	require.NoError(t, err)
	assert.Equal(t, domain.AudienceSelected, got.Audience)
	assert.Equal(t, 2, got.EligibleStudents)
	assert.ElementsMatch(t, []uuid.UUID{f.ana.ID, f.bruno.ID}, f.repo.students[got.ID])
}

// ---- RN-08: who is eligible ----

// Covers SPEC-075 CA-07, CA-08 (RN-08): in ALL_CLASS whoever enrolls later is eligible and whoever leaves is not; in SELECTED only the listed
// ones who still have an ACTIVE enrollment are.
func TestEligibility_AllClassIncludesWhoEnrollsLaterAndExcludesWhoLeft(t *testing.T) {
	f := newFixture(t)
	all := f.create(t)
	only := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID, f.bruno.ID}
	})

	visible := func(s service.Student, id uuid.UUID) bool {
		_, err := f.svc.Public(ctx, f.as(s), f.class.ID, id)
		// not eligible is a 404 whichever the way: no assessment for her, or no active enrollment, which does not reveal the class either
		if errors.Is(err, domain.ErrAssessmentNotFound) || errors.Is(err, domain.ErrClassNotFound) {
			return false
		}
		require.NoError(t, err)
		return true
	}

	assert.True(t, visible(f.ana, all.ID))
	assert.True(t, visible(f.ana, only.ID))
	assert.True(t, visible(f.carla, all.ID))
	assert.False(t, visible(f.carla, only.ID), "carla is not on the list")

	later := service.Student{ID: uuid.New(), Name: "Eva", AcademicID: "1000005"}
	f.students.enroll(f.class.ID, later)
	assert.True(t, visible(later, all.ID), "who enrolls later is in ALL_CLASS")
	assert.False(t, visible(later, only.ID))

	f.students.leave(f.class.ID, f.ana.ID)
	assert.False(t, visible(f.ana, all.ID), "who left is no longer eligible")
	assert.False(t, visible(f.ana, only.ID), "not even when she is on the list")

	_, err := f.svc.Public(ctx, f.as(f.outsider), f.class.ID, all.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "a student who is not in the class does not learn it exists")
}

// the helpers the other test files share

func strOf(n int) string { return strings.Repeat("a", n) }
