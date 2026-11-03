package service_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// The kinds of question of the bank, as the content module names them.
const (
	kindSingle    = "THEORETICAL_SINGLE"
	kindBoolean   = "THEORETICAL_BOOLEAN"
	kindMatching  = "THEORETICAL_MATCHING"
	kindPractical = "PRACTICAL"
	kindWritten   = "DISCURSIVE"
)

// addKind adds a published question of the kind to the bank, with the key the fake grades by (see fakeQuestions.Grade).
func (f *fixture) addKind(kind string, key string) uuid.UUID {
	id := uuid.New()
	f.questions.bank[id] = bankQuestion{
		QuestionContent: service.QuestionContent{
			Question:   service.Question{ID: id, Title: "Questão " + kind, Kind: kind, Difficulty: domain.DifficultyEasy},
			Statement:  "Enunciado " + kind, AnswerKey: key, GradingKey: json.RawMessage(key),
			StudentView: service.StudentView{Choices: []service.StudentChoice{{ID: "a", HTML: "chmod"}}},
		},
		ModuleID: f.module.ID, Published: true, In: true, Scenario: json.RawMessage(`{"cwd":"/root"}`),
	}
	return id
}

// exam creates an online exam of the fixture with the questions, 2 points each, and leaves it started at 09:05 (SPEC-089).
func (f *fixture) exam(t *testing.T, ids ...uuid.UUID) service.Summary {
	t.Helper()
	items := make([]domain.Item, len(ids))
	for i, id := range ids {
		items[i] = domain.Item{QuestionID: id, Position: i + 1, Weight: domain.Points(2)}
	}
	a := f.create(t, func(in *service.CreateInput) {
		in.Modality, in.Items, in.MaxScore = ptr(domain.ModalityOnline), items, domain.Points(float64(2*len(ids)))
	})
	f.begin(t, a)
	return a
}

// fiveKinds is an exam with one question of each kind: single choice (a), true or false (true), matching of two pairs, practical and written.
func (f *fixture) fiveKinds(t *testing.T) service.Summary {
	t.Helper()
	return f.exam(t,
		f.addKind(kindSingle, `{"choice":"a"}`),
		f.addKind(kindBoolean, `{"value":true}`),
		f.addKind(kindMatching, `{"links":[{"left":"l1","right":"r1"},{"left":"l2","right":"r2"}]}`),
		f.addKind(kindPractical, `{}`),
		f.addKind(kindWritten, `{}`),
	)
}

func (f *fixture) enter(t *testing.T, s service.Student, a service.Summary) service.StudentAttempt {
	t.Helper()
	got, _, err := f.svc.EnterAttempt(ctx, f.as(s), f.class.ID, a.ID)
	require.NoError(t, err)
	return got
}

// ---- RN-01 to RN-03: entering ----

// Covers SPEC-090 CA-01 (RN-01 to RN-03): the first entry creates the attempt with the questions, their weights, what the student sees and the
// deadline; the next one gives the same attempt back.
func TestEnterAttempt_CreatesOnceAndGivesTheSameBack(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.now = at(21, 9, 10)

	got, created, err := f.svc.EnterAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, domain.AttemptInProgress, got.Status)
	assert.True(t, got.StartedAt.Equal(at(21, 9, 10)))
	assert.True(t, got.DeadlineAt.Equal(at(21, 11, 0)), "without a duration the deadline is the end of the assessment")
	require.Len(t, got.Items, 5)
	assert.Equal(t, 1, got.Items[0].Position)
	assert.Equal(t, kindSingle, got.Items[0].Kind)
	assert.Equal(t, domain.Points(2), got.Items[0].Weight)
	assert.Contains(t, string(got.Items[0].StudentView), "Enunciado THEORETICAL_SINGLE")
	assert.Contains(t, string(got.Items[0].StudentView), "chmod", "the alternatives the student sees")
	assert.Contains(t, string(got.Items[3].StudentView), "/root", "the machine the practical question starts from")

	f.now = at(21, 9, 30)
	again, created, err := f.svc.EnterAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, got.ID, again.ID)
	assert.True(t, again.StartedAt.Equal(at(21, 9, 10)), "the start stays")
}

// Covers SPEC-090 CA-01 (RN-03): with an individual duration the deadline is the start plus the duration, unless the assessment ends first.
func TestEnterAttempt_DeadlineIsTheDurationOrTheEnd(t *testing.T) {
	f := newFixture(t)
	q := f.addKind(kindSingle, `{"choice":"a"}`)
	a := f.create(t, func(in *service.CreateInput) {
		in.Modality, in.DurationMinutes = ptr(domain.ModalityOnline), ptr(30)
		in.Items, in.MaxScore = []domain.Item{{QuestionID: q, Position: 1, Weight: domain.Points(10)}}, domain.Points(10)
	})
	f.begin(t, a)

	f.now = at(21, 9, 10)
	assert.True(t, f.enter(t, f.ana, a).DeadlineAt.Equal(at(21, 9, 40)), "the start plus 30 minutes")
	f.now = at(21, 10, 50)
	assert.True(t, f.enter(t, f.bruno, a).DeadlineAt.Equal(at(21, 11, 0)), "the end of the assessment comes first")
}

// Covers SPEC-090 CA-02 (RN-01): without the access there is no attempt, and the refusal says why; an assignment has no attempt; only a student enters.
func TestEnterAttempt_RefusalsSayWhy(t *testing.T) {
	f := newFixture(t)
	q := f.addKind(kindSingle, `{"choice":"a"}`)
	items := []domain.Item{{QuestionID: q, Position: 1, Weight: domain.Points(10)}}
	online := func(in *service.CreateInput) { in.Modality, in.Items, in.MaxScore = ptr(domain.ModalityOnline), items, domain.Points(10) }
	notStarted := f.create(t, online)
	inPerson := f.create(t, func(in *service.CreateInput) { in.Items, in.MaxScore = items, domain.Points(10) })
	assignment := f.create(t, online, func(in *service.CreateInput) {
		in.Type, in.StartsAt, in.EndsAt = domain.TypeAssignment, ptr(at(21, 9, 0)), ptr(at(23, 18, 0))
	})
	canceled := f.create(t, online)
	_, err := f.svc.Cancel(ctx, f.teacher, f.class.ID, canceled.ID, "Greve")
	require.NoError(t, err)
	f.begin(t, inPerson)

	cases := []struct {
		name    string
		a       service.Summary
		student service.Student
		want    error
	}{
		{"not open yet", notStarted, f.ana, domain.ErrAssessmentNotOpenYet},
		{"not started by the teacher", notStarted, f.ana, domain.ErrAssessmentNotStarted},
		{"waiting for the clearance", inPerson, f.ana, domain.ErrNotCleared},
		{"canceled", canceled, f.ana, domain.ErrAssessmentCanceled},
		{"not eligible", notStarted, f.outsider, domain.ErrNotEligible},
		{"an assignment", assignment, f.ana, domain.ErrInvalidAssessment},
	}
	for i, c := range cases {
		f.now = at(21, 10, 0)
		if i == 0 {
			f.now = at(21, 8, 59)
		}
		_, _, err := f.svc.EnterAttempt(ctx, f.as(c.student), f.class.ID, c.a.ID)
		assert.ErrorIs(t, err, c.want, c.name)
	}
	f.now = at(21, 11, 30)
	_, _, err = f.svc.EnterAttempt(ctx, f.as(f.ana), f.class.ID, notStarted.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentEnded, "ended")
	_, _, err = f.svc.EnterAttempt(ctx, f.teacher, f.class.ID, notStarted.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "only a student enters")
	assert.Empty(t, f.repo.attempts, "no attempt was created")
}

// Covers SPEC-090 CA-03 (RN-02): in a draw each attempt has a sample that meets the rules, with the points of each level; and what the bank says
// after the entry does not change the attempt.
func TestEnterAttempt_DrawAndFrozenQuestions(t *testing.T) {
	f := newFixture(t)
	a := f.create(t, func(in *service.CreateInput) {
		in.Modality, in.Composition, in.Items = ptr(domain.ModalityOnline), domain.CompositionDraw, nil
		in.Draw, in.MaxScore = f.draw(2, 1, 0, 3, 4, 0), domain.Points(10)
	})
	f.begin(t, a)
	got := f.enter(t, f.ana, a)
	require.Len(t, got.Items, 3)
	assert.Equal(t, []domain.Score{domain.Points(3), domain.Points(3), domain.Points(4)}, []domain.Score{got.Items[0].Weight, got.Items[1].Weight, got.Items[2].Weight})

	first := f.repo.attemptItems[got.ID][0]
	bank := f.questions.bank[first.QuestionID]
	bank.Statement = "Mudou depois"
	f.questions.bank[first.QuestionID] = bank
	again := f.enter(t, f.ana, a)
	assert.NotContains(t, string(again.Items[0].StudentView), "Mudou depois")
}

// ---- RN-04, RN-05: answering and checking ----

// Covers SPEC-090 CA-04 (RN-04): a valid answer is stored and replaces the one before; an invalid one or one too big is refused; after the deadline
// and its tolerance nothing is saved.
func TestSaveAnswer_StoresReplacesAndRefuses(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	got := f.enter(t, f.ana, a)
	me := f.as(f.ana)

	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"b"}`)))
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))
	assert.JSONEq(t, `{"choice":"a"}`, string(f.repo.attemptItems[got.ID][0].Answer), "the last one wins")

	err := f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"invalid":true}`))
	assert.ErrorIs(t, err, domain.ErrInvalidAnswer)
	big := json.RawMessage(`{"machine":"` + strings.Repeat("x", 256*1024) + `"}`)
	assert.ErrorIs(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 4, big), domain.ErrInvalidAnswer, "the machine is up to 256 KiB")
	assert.ErrorIs(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 9, json.RawMessage(`{"choice":"a"}`)), domain.ErrAttemptNotFound, "no such position")

	f.now = at(21, 11, 1)
	assert.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 2, json.RawMessage(`{"value":true}`)), "within the tolerance")
	f.now = at(21, 11, 2)
	assert.ErrorIs(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 2, json.RawMessage(`{"value":false}`)), domain.ErrAttemptExpired)
}

// Covers SPEC-090 CA-05 (RN-05): checking a practical question grades the machine against the key frozen in the attempt, stores the machine and the
// result, and says whether it is solved; another kind cannot be checked.
func TestCheckAnswer_GradesTheMachineAndStoresIt(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	got := f.enter(t, f.ana, a)
	me := f.as(f.ana)

	solved, err := f.svc.CheckAnswer(ctx, me, f.class.ID, a.ID, 4, json.RawMessage(`{"solved":false}`))
	require.NoError(t, err)
	assert.False(t, solved)
	solved, err = f.svc.CheckAnswer(ctx, me, f.class.ID, a.ID, 4, json.RawMessage(`{"solved":true}`))
	require.NoError(t, err)
	assert.True(t, solved)
	stored := f.repo.attemptItems[got.ID][3]
	assert.JSONEq(t, `{"solved":true}`, string(stored.Answer))
	require.NotNil(t, stored.CheckedSolved)
	assert.True(t, *stored.CheckedSolved)

	_, err = f.svc.CheckAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"solved":true}`))
	assert.ErrorIs(t, err, domain.ErrNotPractical)
}

// ---- RN-06 to RN-08: submitting, expiring and the preliminary score ----

// Covers SPEC-090 CA-06 (RN-06, RN-08): on submit the attempt is SUBMITTED and graded: all or nothing in the single choice and the true or false, the
// share of right links in the matching (D-01), the practical by its last machine graded again, the written one pending and zero without answer.
func TestSubmitAttempt_GradesEachKind(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	got := f.enter(t, f.ana, a)
	me := f.as(f.ana)
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))
	// the true or false is left without answer
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 3, json.RawMessage(`{"links":[{"left":"l1","right":"r1"},{"left":"l2","right":"r1x"}]}`)))
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 4, json.RawMessage(`{"solved":true}`)))
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 5, json.RawMessage(`{"html":"<p>755</p>"}`)))

	f.now = at(21, 10, 15)
	done, err := f.svc.SubmitAttempt(ctx, me, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AttemptSubmitted, done.Status)
	require.NotNil(t, done.SubmittedAt)
	assert.True(t, done.SubmittedAt.Equal(at(21, 10, 15)))

	stored := f.repo.attempts[[2]uuid.UUID{a.ID, f.ana.ID}]
	require.NotNil(t, stored.PreliminaryScore)
	assert.Equal(t, domain.Points(5), *stored.PreliminaryScore, "2 (single) + 0 (blank) + 1 (half of the matching) + 2 (practical)")
	require.NotNil(t, stored.PendingItems)
	assert.Equal(t, 1, *stored.PendingItems, "the written one")
	points := f.repo.attemptItems[got.ID]
	assert.Nil(t, points[4].Points, "the written one has no points yet")
	require.NotNil(t, points[1].Points)
	assert.Equal(t, domain.Score(0), *points[1].Points)

	_, err = f.svc.SubmitAttempt(ctx, me, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted)
	_, _, err = f.svc.EnterAttempt(ctx, me, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptAlreadySubmitted)
	assert.ErrorIs(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 2, json.RawMessage(`{"value":true}`)), domain.ErrAttemptAlreadySubmitted)
}

// Covers SPEC-090 CA-07 (RN-07): an attempt past its deadline and the tolerance is closed as TIME_EXPIRED on the first read and by the sweep, with
// the answers saved until then.
func TestAttempt_ExpiresOnReadAndBySweep(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.enter(t, f.ana, a)
	f.enter(t, f.bruno, a)
	require.NoError(t, f.svc.SaveAnswer(ctx, f.as(f.ana), f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))

	f.now = at(21, 11, 2)
	mine, err := f.svc.MyAttempt(ctx, f.as(f.ana), f.class.ID, a.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AttemptTimeExpired, mine.Status)
	stored := f.repo.attempts[[2]uuid.UUID{a.ID, f.ana.ID}]
	assert.Equal(t, domain.Points(2), *stored.PreliminaryScore)
	assert.True(t, stored.SubmittedAt.Equal(at(21, 11, 2)))

	closed, err := f.svc.ExpireDue(ctx)
	require.NoError(t, err)
	assert.Equal(t, 1, closed, "only Bruno was still open")
	assert.Equal(t, domain.AttemptTimeExpired, f.repo.attempts[[2]uuid.UUID{a.ID, f.bruno.ID}].Status)
	closed, err = f.svc.ExpireDue(ctx)
	require.NoError(t, err)
	assert.Zero(t, closed)

	_, err = f.svc.SubmitAttempt(ctx, f.as(f.carla), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound, "Carla never entered")
}

// ---- RN-09, RN-10: what each one reads ----

// Covers SPEC-090 CA-08 (RN-10): the attempt of the student has the answers and whether the practical is solved, and never the key nor the points.
func TestMyAttempt_NeverCarriesTheKey(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.enter(t, f.ana, a)
	me := f.as(f.ana)
	require.NoError(t, f.svc.SaveAnswer(ctx, me, f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))
	_, err := f.svc.CheckAnswer(ctx, me, f.class.ID, a.ID, 4, json.RawMessage(`{"solved":true}`))
	require.NoError(t, err)

	got, err := f.svc.MyAttempt(ctx, me, f.class.ID, a.ID)
	require.NoError(t, err)
	assert.JSONEq(t, `{"choice":"a"}`, string(got.Items[0].Answer))
	require.NotNil(t, got.Items[3].CheckedSolved)
	assert.True(t, *got.Items[3].CheckedSolved)
	assert.Nil(t, got.Items[0].CheckedSolved, "only the practical has it")
	raw, err := json.Marshal(got)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "links\":[{\"left\":\"l1\",\"right\":\"r1\"},{\"left\":\"l2\",\"right\":\"r2\"}", "not the key of the matching")
	assert.NotContains(t, string(raw), "AnswerKey")
	assert.NotContains(t, string(raw), "Points\"")

	_, err = f.svc.MyAttempt(ctx, f.as(f.bruno), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrAttemptNotFound)
}

// Covers SPEC-090 CA-09 (RN-09): the teacher of the class and the administrator read one row for each attempt, with the score after the delivery.
func TestAttempts_TheListOfTheTeacher(t *testing.T) {
	f := newFixture(t)
	a := f.fiveKinds(t)
	f.enter(t, f.ana, a)
	f.enter(t, f.bruno, a)
	require.NoError(t, f.svc.SaveAnswer(ctx, f.as(f.bruno), f.class.ID, a.ID, 1, json.RawMessage(`{"choice":"a"}`)))
	_, err := f.svc.SubmitAttempt(ctx, f.as(f.bruno), f.class.ID, a.ID)
	require.NoError(t, err)

	rows, err := f.svc.Attempts(ctx, f.teacher, f.class.ID, a.ID)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	byName := map[string]service.AttemptRow{}
	for _, r := range rows {
		byName[r.StudentName] = r
	}
	assert.Equal(t, domain.AttemptInProgress, byName["Ana"].Status)
	assert.Equal(t, "1000001", byName["Ana"].AcademicID)
	assert.Nil(t, byName["Ana"].PreliminaryScore)
	assert.Equal(t, domain.AttemptSubmitted, byName["Bruno"].Status)
	require.NotNil(t, byName["Bruno"].PreliminaryScore)
	assert.Equal(t, domain.Points(2), *byName["Bruno"].PreliminaryScore)
	assert.Equal(t, 0, *byName["Bruno"].PendingItems, "a written question left blank is zero, not pending")

	_, err = f.svc.Attempts(ctx, f.admin, f.class.ID, a.ID)
	assert.NoError(t, err)
	_, err = f.svc.Attempts(ctx, f.other, f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.svc.Attempts(ctx, f.as(f.ana), f.class.ID, a.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}
