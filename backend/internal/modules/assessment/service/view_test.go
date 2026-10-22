package service_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

func ids(summaries []service.Summary) []uuid.UUID {
	out := make([]uuid.UUID, len(summaries))
	for i, s := range summaries {
		out[i] = s.ID
	}
	return out
}

func publicIDs(list []service.Public) []uuid.UUID {
	out := make([]uuid.UUID, len(list))
	for i, p := range list {
		out[i] = p.ID
	}
	return out
}

// ---- RN-16: the preview ----

// Covers SPEC-075 CA-22 (RN-16): the teacher sees every question with the statement, the answer key, the explanation and the weight, in order,
// before, during and after the assessment; a draw shows the rules, the stock and a sample that is not stored.
func TestPreview_ReturnsQuestionsAnswerKeysAndASampleDraw(t *testing.T) {
	f := newFixture(t)
	manual := f.create(t)
	drawn := f.create(t, func(in *service.CreateInput) {
		in.Composition, in.Items, in.Draw = domain.CompositionDraw, nil, f.draw(3, 3, 4, 1, 1, 1)
	})
	writes := f.repo.writes

	for _, now := range []time.Time{at(20, 8, 0), at(21, 10, 0), at(22, 8, 0)} {
		f.now = now
		p, err := f.svc.Preview(ctx, f.teacher, f.class.ID, manual.ID)
		require.NoError(t, err)
		require.Len(t, p.Questions, 3)
		for i, q := range p.Questions {
			assert.Equal(t, i+1, q.Position)
			assert.Equal(t, f.repo.items[manual.ID][i].Weight, q.Weight)
			assert.NotEmpty(t, q.Statement)
			assert.NotEmpty(t, q.AnswerKey, "the answer key is for the teacher")
			assert.NotEmpty(t, q.Explanation)
		}
		assert.Empty(t, p.Rules)
		assert.Empty(t, p.Sample)
	}

	p, err := f.svc.Preview(ctx, f.teacher, f.class.ID, drawn.ID)
	require.NoError(t, err)
	assert.Empty(t, p.Questions)
	assert.Len(t, p.Rules, 3)
	assert.Equal(t, map[domain.Difficulty]int{domain.DifficultyEasy: 5, domain.DifficultyMedium: 4, domain.DifficultyHard: 4}, p.Stock)
	require.Len(t, p.Sample, 10, "one example caderno: 3 easy, 3 medium and 4 hard")
	perLevel := map[domain.Difficulty]int{}
	seen := map[uuid.UUID]bool{}
	for _, q := range p.Sample {
		perLevel[q.Difficulty]++
		assert.False(t, seen[q.ID], "no question twice")
		seen[q.ID] = true
		assert.NotEmpty(t, q.AnswerKey)
	}
	assert.Equal(t, map[domain.Difficulty]int{domain.DifficultyEasy: 3, domain.DifficultyMedium: 3, domain.DifficultyHard: 4}, perLevel)
	assert.Equal(t, writes, f.repo.writes, "the sample is not stored")
}

// ---- RN-05, RN-07: the questions to pick from ----

// Covers SPEC-075 CA-04, CA-06 (RN-05, RN-07): the module must be assigned; the questions are the eligible ones, filtered, and the stock by level
// counts all of them whatever the filter.
func TestEligibleQuestions_NeedsAssignedModuleAndGivesStock(t *testing.T) {
	f := newFixture(t)
	for _, reason := range []string{"other module", "unpublished", "not in the assessment", "deleted"} {
		f.notEligible(reason)
	}

	page, err := f.svc.EligibleQuestions(ctx, f.teacher, f.class.ID, service.QuestionFilter{ModuleID: f.module.ID})
	require.NoError(t, err)
	assert.Len(t, page.Items, 13)
	assert.Equal(t, map[domain.Difficulty]int{domain.DifficultyEasy: 5, domain.DifficultyMedium: 4, domain.DifficultyHard: 4}, page.Stock)

	hard, err := f.svc.EligibleQuestions(ctx, f.teacher, f.class.ID, service.QuestionFilter{ModuleID: f.module.ID, Difficulty: domain.DifficultyHard})
	require.NoError(t, err)
	assert.Len(t, hard.Items, 4)
	assert.Equal(t, page.Stock, hard.Stock)

	_, err = f.svc.EligibleQuestions(ctx, f.teacher, f.class.ID, service.QuestionFilter{ModuleID: f.otherModule})
	assert.ErrorIs(t, err, domain.ErrModuleNotAssigned)
}

// ---- RN-01, RN-08, RN-09: lists and detail ----

// Covers SPEC-075 CA-08, CA-23 (RN-08): the teacher lists every assessment of the class with the counts, newest start first; the student gets
// only the ones she is eligible for, in the public form.
func TestList_TeacherSeesAllWithCountsAndStudentOnlyEligible(t *testing.T) {
	f := newFixture(t)
	day := func(d int) func(*service.CreateInput) {
		return func(in *service.CreateInput) { in.StartsAt, in.EndsAt = ptr(at(d, 9, 0)), ptr(at(d, 11, 0)) }
	}
	only := func(s service.Student) func(*service.CreateInput) {
		return func(in *service.CreateInput) { in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{s.ID} }
	}
	all := f.create(t, day(21))
	forAna := f.create(t, day(22), only(f.ana))
	forBruno := f.create(t, day(23), only(f.bruno))

	list, err := f.svc.List(ctx, f.teacher, f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []uuid.UUID{forBruno.ID, forAna.ID, all.ID}, ids(list))
	assert.Equal(t, []int{1, 1, 3}, []int{list[0].EligibleStudents, list[1].EligibleStudents, list[2].EligibleStudents})

	mine, err := f.svc.ListPublic(ctx, f.as(f.ana), f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{forAna.ID, all.ID}, publicIDs(mine))
	theirs, err := f.svc.ListPublic(ctx, f.as(f.bruno), f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{forBruno.ID, all.ID}, publicIDs(theirs))
	none, err := f.svc.ListPublic(ctx, f.as(f.carla), f.class.ID, service.ListFilter{})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{all.ID}, publicIDs(none))

	_, err = f.svc.ListPublic(ctx, f.as(f.outsider), f.class.ID, service.ListFilter{})
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "a student who is not in the class")
	_, err = f.svc.ListPublic(ctx, f.teacher, f.class.ID, service.ListFilter{})
	assert.ErrorIs(t, err, domain.ErrForbidden, "the public list is the student's")

	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, forAna.ID, "Greve")
	require.NoError(t, err)
	canceled, err := f.svc.List(ctx, f.teacher, f.class.ID, service.ListFilter{Status: domain.StatusCanceled})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{forAna.ID}, ids(canceled))

	f.now = at(21, 12, 0)
	ended, err := f.svc.List(ctx, f.teacher, f.class.ID, service.ListFilter{Phase: domain.PhaseEnded})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{all.ID}, ids(ended))
	upcoming, err := f.svc.ListPublic(ctx, f.as(f.bruno), f.class.ID, service.ListFilter{Phase: domain.PhaseUpcoming})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{forBruno.ID}, publicIDs(upcoming))
}

// Covers SPEC-075 CA-18, CA-10 (RN-13, RN-15): the detail gives the teacher the history in order, the questions with their titles, the students and
// the private notes; the student gets the public form with the reason of a cancellation.
func TestDetail_ShowsTheHistoryToTheTeacherOnly(t *testing.T) {
	f := newFixture(t)
	a := f.create(t, func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.ana.ID, f.bruno.ID}
	})
	_, err := f.svc.Reschedule(ctx, f.teacher, f.class.ID, a.ID, service.RescheduleInput{StartsAt: at(22, 9, 0), EndsAt: at(22, 11, 0)})
	require.NoError(t, err)
	_, err = f.svc.SaveNotes(ctx, f.teacher, f.class.ID, a.ID, "Conferir o laboratório 02")
	require.NoError(t, err)
	_, err = f.svc.Cancel(ctx, f.teacher, f.class.ID, a.ID, "Falta de energia")
	require.NoError(t, err)

	d, err := f.svc.Detail(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	kinds := make([]domain.EventKind, len(d.Events))
	for i, e := range d.Events {
		kinds[i] = e.Kind
	}
	assert.Equal(t, []domain.EventKind{domain.EventCreated, domain.EventRescheduled, domain.EventCanceled}, kinds)
	for _, e := range d.Events {
		assert.Equal(t, "Profa. Sediane", e.ActorName)
	}
	require.Len(t, d.Items, 3)
	assert.NotEmpty(t, d.Items[0].Title)
	assert.Equal(t, domain.DifficultyEasy, d.Items[0].Difficulty)
	assert.Equal(t, "PRACTICAL", d.Items[0].Kind)
	require.Len(t, d.Students, 2)
	assert.ElementsMatch(t, []string{"Ana", "Bruno"}, []string{d.Students[0].Name, d.Students[1].Name})
	require.NotNil(t, d.TeacherPrivateNotes)
	assert.Equal(t, "Conferir o laboratório 02", *d.TeacherPrivateNotes)
	assert.Equal(t, 2, d.EligibleStudents)

	pub, err := f.svc.Public(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.StatusCanceled, pub.Status)
	require.NotNil(t, pub.CancelReason)
	assert.Equal(t, "Falta de energia", *pub.CancelReason)
	assert.Equal(t, "Prova 1", pub.Title)
	assert.Equal(t, domain.Points(10), pub.MaxScore)

	_, err = f.svc.Detail(ctx, f.as(f.ana), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student never gets the detail")
	_, err = f.svc.Public(ctx, f.teacher, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "the public form is the student's")
}

// ---- RN-17: the calendar ----

// Covers SPEC-075 CA-19 (RN-17): the student gets only the eligible assessments of the range, public, with the canceled ones and their reason;
// the last day of the range counts; a class she is not in is left out.
func TestCalendar_StudentGetsOnlyEligiblePublicAssessments(t *testing.T) {
	f := newFixture(t)
	at2 := func(d, h int) func(*service.CreateInput) {
		return func(in *service.CreateInput) { in.StartsAt, in.EndsAt = ptr(at(d, h, 0)), ptr(at(d, h+2, 0)) }
	}
	all := f.create(t, at2(21, 9))
	forBruno := f.create(t, at2(22, 9), func(in *service.CreateInput) {
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.bruno.ID}
	})
	canceled := f.create(t, at2(23, 9))
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	lastDay := f.create(t, at2(25, 15))
	f.create(t, func(in *service.CreateInput) {
		in.StartsAt, in.EndsAt = ptr(time.Date(2026, 11, 20, 9, 0, 0, 0, domain.Location())), ptr(time.Date(2026, 11, 20, 11, 0, 0, 0, domain.Location()))
	})
	f.modules.assigned[[2]uuid.UUID{f.otherClass.ID, f.module.ID}] = f.module
	foreign, err := f.svc.Create(ctx, f.admin, f.otherClass.ID, f.input())
	require.NoError(t, err)

	classes := []uuid.UUID{f.class.ID, f.otherClass.ID}
	res, err := f.svc.Calendar(ctx, f.as(f.ana), classes, at(19, 0, 0), at(25, 0, 0))
	require.NoError(t, err)
	assert.Empty(t, res.Summaries, "a student never gets the teacher's form")
	assert.ElementsMatch(t, []uuid.UUID{all.ID, canceled.ID, lastDay.ID}, publicIDs(res.Public))
	for _, p := range res.Public {
		assert.NotEqual(t, foreign.ID, p.ID, "the class she is not in")
		assert.NotEqual(t, forBruno.ID, p.ID, "an assessment she is not eligible for")
		if p.ID == canceled.ID {
			assert.Equal(t, domain.StatusCanceled, p.Status)
			require.NotNil(t, p.CancelReason)
			assert.Equal(t, "Greve", *p.CancelReason)
		}
	}

	res, err = f.svc.Calendar(ctx, f.as(f.bruno), classes, at(19, 0, 0), at(25, 0, 0))
	require.NoError(t, err)
	assert.Contains(t, publicIDs(res.Public), forBruno.ID)
}

// Covers SPEC-075 CA-19 (RN-17): the teacher gets the summaries of the assessments of her own classes, with the ones for chosen students; an
// administrator gets every class.
func TestCalendar_TeacherGetsAllOfHerClasses(t *testing.T) {
	f := newFixture(t)
	mine := f.create(t)
	forBruno := f.create(t, func(in *service.CreateInput) {
		in.StartsAt, in.EndsAt = ptr(at(22, 9, 0)), ptr(at(22, 11, 0))
		in.Audience, in.StudentIDs = domain.AudienceSelected, []uuid.UUID{f.bruno.ID}
	})
	f.modules.assigned[[2]uuid.UUID{f.otherClass.ID, f.module.ID}] = f.module
	foreign, err := f.svc.Create(ctx, f.admin, f.otherClass.ID, f.input())
	require.NoError(t, err)
	classes := []uuid.UUID{f.class.ID, f.otherClass.ID}

	res, err := f.svc.Calendar(ctx, f.teacher, classes, at(19, 0, 0), at(25, 0, 0))
	require.NoError(t, err)
	assert.Empty(t, res.Public)
	assert.ElementsMatch(t, []uuid.UUID{mine.ID, forBruno.ID}, ids(res.Summaries), "not the class of another teacher")

	res, err = f.svc.Calendar(ctx, f.admin, classes, at(19, 0, 0), at(25, 0, 0))
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{mine.ID, forBruno.ID, foreign.ID}, ids(res.Summaries))
}

// Covers SPEC-081 RN-01, RN-04, CA-15: the preview carries, for each question and for each question of the sample, what the student receives, as
// the bank gave it, and reading it stores nothing.
func TestPreview_CarriesTheStudentViewOfTheQuestionsAndOfTheSample(t *testing.T) {
	f := newFixture(t)
	manual := f.create(t)
	drawn := f.create(t, func(in *service.CreateInput) {
		in.Composition, in.Items, in.Draw = domain.CompositionDraw, nil, f.draw(3, 3, 4, 1, 1, 1)
	})
	shuffle := true
	for id, q := range f.questions.bank {
		q.StudentView = service.StudentView{
			Choices: []service.StudentChoice{{ID: "a", HTML: "<p>um</p>"}, {ID: "b", HTML: "<p>dois</p>"}}, Shuffle: &shuffle,
		}
		f.questions.bank[id] = q
	}
	writes := f.repo.writes

	p, err := f.svc.Preview(ctx, f.teacher, f.class.ID, manual.ID)
	require.NoError(t, err)
	require.NotEmpty(t, p.Questions)
	for _, q := range p.Questions {
		assert.Equal(t, []service.StudentChoice{{ID: "a", HTML: "<p>um</p>"}, {ID: "b", HTML: "<p>dois</p>"}}, q.StudentView.Choices)
		assert.Equal(t, &shuffle, q.StudentView.Shuffle)
	}

	p, err = f.svc.Preview(ctx, f.teacher, f.class.ID, drawn.ID)
	require.NoError(t, err)
	require.NotEmpty(t, p.Sample)
	for _, q := range p.Sample {
		assert.Len(t, q.StudentView.Choices, 2, "the sample is shown to the student the same way")
	}
	assert.Equal(t, writes, f.repo.writes, "reading the preview stores nothing")
}
