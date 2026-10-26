package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// at is a wall-clock moment of October 2026 in the time zone of the school (SPEC-075 RN-03, SPEC-042 RN-13).
func at(day, hour, minute int) time.Time {
	return time.Date(2026, 10, day, hour, minute, 0, 0, domain.Location())
}

func ptr[T any](v T) *T { return &v }

func question() uuid.UUID { return uuid.New() }

// ---- RN-03: the period and the phase ----

// Covers SPEC-075 CA-02 (RN-03): the end is after the start and the start is after the moment of saving.
func TestPeriod_RejectsEndNotAfterStart(t *testing.T) {
	now := at(20, 8, 0)
	for name, c := range map[string]struct {
		start, end time.Time
		ok         bool
	}{
		"end after start":        {at(21, 9, 0), at(21, 11, 0), true},
		"end equal to start":     {at(21, 9, 0), at(21, 9, 0), false},
		"end before start":       {at(21, 11, 0), at(21, 9, 0), false},
		"start equal to now":     {now, at(21, 11, 0), false},
		"start before now":       {at(20, 7, 0), at(21, 11, 0), false},
		"start one minute ahead": {at(20, 8, 1), at(20, 10, 0), true},
	} {
		err := domain.ValidatePeriod(domain.TypeAssignment, c.start, c.end, now)
		if c.ok {
			assert.NoError(t, err, name)
		} else {
			assert.ErrorIs(t, err, domain.ErrInvalidPeriod, name)
		}
	}
}

// Covers SPEC-075 CA-02 (RN-03): an exam starts and ends on the same day of Brasília; an assignment may cross days.
// The cases at the edge of midnight prove the day is the one of Brasília and not the one in UTC.
func TestPeriod_ExamMustBeOnTheSameDay(t *testing.T) {
	now := at(20, 8, 0)
	utc := func(day, hour, minute int) time.Time { return time.Date(2026, 10, day, hour, minute, 0, 0, time.UTC) }
	for name, c := range map[string]struct {
		typ        domain.Type
		start, end time.Time
		ok         bool
	}{
		"exam in one day":                    {domain.TypeExam, at(21, 9, 0), at(21, 11, 0), true},
		"exam from one day to the next":      {domain.TypeExam, at(21, 22, 0), at(22, 1, 0), false},
		"exam 23:30 to 00:30":                {domain.TypeExam, at(21, 23, 30), at(22, 0, 30), false},
		"exam 23:30 to 23:59":                {domain.TypeExam, at(21, 23, 30), at(21, 23, 59), true},
		"exam on two UTC days, one day here": {domain.TypeExam, utc(21, 23, 0), utc(22, 2, 0), true},
		"exam on one UTC day, two days here": {domain.TypeExam, utc(22, 2, 30), utc(22, 3, 30), false},
		"assignment of several days":         {domain.TypeAssignment, at(21, 8, 0), at(26, 22, 0), true},
		"assignment inside one day":          {domain.TypeAssignment, at(21, 9, 0), at(21, 11, 0), true},
	} {
		err := domain.ValidatePeriod(c.typ, c.start, c.end, now)
		if c.ok {
			assert.NoError(t, err, name)
		} else {
			assert.ErrorIs(t, err, domain.ErrInvalidPeriod, name)
		}
	}
}

func windowOf(start, end time.Time) domain.Assessment {
	return domain.Assessment{StartsAt: start, EndsAt: end, Status: domain.StatusScheduled, Type: domain.TypeExam}
}

// Covers SPEC-075 CA-01, CA-11, CA-17 (RN-03): the phase comes from the clock of the server, with the exact edges.
func TestPhase_FollowsTheServerClock(t *testing.T) {
	a := windowOf(at(21, 10, 0), at(21, 12, 0))
	for name, c := range map[string]struct {
		now  time.Time
		want domain.Phase
	}{
		"a second before the start": {at(21, 9, 59).Add(59 * time.Second), domain.PhaseUpcoming},
		"at the start":              {at(21, 10, 0), domain.PhaseRunning},
		"in the middle":             {at(21, 11, 0), domain.PhaseRunning},
		"a second before the end":   {at(21, 11, 59).Add(59 * time.Second), domain.PhaseRunning},
		"at the end":                {at(21, 12, 0), domain.PhaseEnded},
		"long after":                {at(30, 12, 0), domain.PhaseEnded},
	} {
		assert.Equal(t, c.want, a.PhaseAt(c.now), name)
	}
}

// Covers SPEC-075 CA-11 (RN-10): the assessment is frozen from the start instant on, and never before.
func TestFrozen_StartsAtTheStartInstant(t *testing.T) {
	a := windowOf(at(21, 10, 0), at(21, 12, 0))
	assert.False(t, a.Frozen(at(21, 9, 59).Add(59*time.Second)))
	assert.True(t, a.Frozen(at(21, 10, 0)))
	assert.True(t, a.Frozen(at(22, 10, 0)), "it stays frozen after the end")
}

// ---- RN-02: the data of the assessment ----

func valid() domain.Assessment {
	return domain.Assessment{
		Title: "Prova 1", Description: "Leia com atenção.", Type: domain.TypeExam, Status: domain.StatusScheduled,
		MaxScore: domain.Points(10), StartsAt: at(21, 9, 0), EndsAt: at(21, 11, 0),
		Composition: domain.CompositionManual, Audience: domain.AudienceAllClass, Modality: domain.ModalityInPerson,
	}
}

// Covers SPEC-075 CA-01 (RN-02): title, instructions, score and duration have limits.
func TestValidate_AcceptsTheLimitsAndRefusesBeyond(t *testing.T) {
	assert.NoError(t, valid().Validate())

	for name, change := range map[string]func(*domain.Assessment){
		"title of 150":           func(a *domain.Assessment) { a.Title = strings.Repeat("a", 150) },
		"instructions of 5000":   func(a *domain.Assessment) { a.Description = strings.Repeat("a", 5000) },
		"instructions of 20000":  func(a *domain.Assessment) { a.Description = strings.Repeat("a", 20000) },
		"empty instructions":     func(a *domain.Assessment) { a.Description = "" },
		"smallest score":         func(a *domain.Assessment) { a.MaxScore = domain.Points(0.01) },
		"biggest score":          func(a *domain.Assessment) { a.MaxScore = domain.Points(100) },
		"duration of 5 minutes":  func(a *domain.Assessment) { a.DurationMinutes = ptr(5) },
		"duration of the period": func(a *domain.Assessment) { a.DurationMinutes = ptr(120) },
		"no duration":            func(a *domain.Assessment) { a.DurationMinutes = nil },
	} {
		a := valid()
		change(&a)
		assert.NoError(t, a.Validate(), name)
	}

	for name, change := range map[string]func(*domain.Assessment){
		"empty title":            func(a *domain.Assessment) { a.Title = "   " },
		"title of 151":           func(a *domain.Assessment) { a.Title = strings.Repeat("a", 151) },
		"instructions of 20001":  func(a *domain.Assessment) { a.Description = strings.Repeat("a", 20001) },
		"unknown type":           func(a *domain.Assessment) { a.Type = "QUIZ" },
		"unknown composition":    func(a *domain.Assessment) { a.Composition = "RANDOM" },
		"unknown audience":       func(a *domain.Assessment) { a.Audience = "GROUP" },
		"zero score":             func(a *domain.Assessment) { a.MaxScore = 0 },
		"score above 100":        func(a *domain.Assessment) { a.MaxScore = domain.Points(100.01) },
		"duration of 4 minutes":  func(a *domain.Assessment) { a.DurationMinutes = ptr(4) },
		"duration beyond period": func(a *domain.Assessment) { a.DurationMinutes = ptr(121) },
	} {
		a := valid()
		change(&a)
		assert.ErrorIs(t, a.Validate(), domain.ErrInvalidAssessment, name)
	}
}

// ---- RN-06: the manual composition ----

func items(weights ...float64) []domain.Item {
	out := make([]domain.Item, len(weights))
	for i, w := range weights {
		out[i] = domain.Item{QuestionID: question(), Position: i + 1, Weight: domain.Points(w)}
	}
	return out
}

// Covers SPEC-075 CA-05 (RN-06): the weights add up to the maximum score, checked in whole hundredths.
func TestWeights_ManualSumMustEqualMaxScoreInCents(t *testing.T) {
	max := domain.Points(10)
	assert.NoError(t, domain.ValidateManual(max, items(3.33, 3.33, 3.34)))
	assert.NoError(t, domain.ValidateManual(max, items(10)))
	assert.ErrorIs(t, domain.ValidateManual(max, items(3.33, 3.33, 3.33)), domain.ErrWeightsMismatch)
	assert.ErrorIs(t, domain.ValidateManual(max, items(5, 5.01)), domain.ErrWeightsMismatch)
	// 0.1 + 0.2 is not 0.3 in floating point: the sum must not be done in floats
	assert.NoError(t, domain.ValidateManual(domain.Points(0.3), items(0.1, 0.2)))
}

// Covers SPEC-075 CA-05 (RN-06): a list with no question, a repeated question or a weight out of 0.01 to 100 is invalid.
func TestWeights_ManualRefusesBadLists(t *testing.T) {
	max := domain.Points(10)
	assert.ErrorIs(t, domain.ValidateManual(max, nil), domain.ErrInvalidAssessment, "empty")

	repeated := items(5, 5)
	repeated[1].QuestionID = repeated[0].QuestionID
	assert.ErrorIs(t, domain.ValidateManual(max, repeated), domain.ErrInvalidAssessment, "repeated question")

	assert.ErrorIs(t, domain.ValidateManual(max, items(0, 10)), domain.ErrInvalidAssessment, "weight zero")
	assert.ErrorIs(t, domain.ValidateManual(domain.Points(101), items(100.01, 0.99)), domain.ErrInvalidAssessment, "weight above 100")

	fifty := make([]float64, 50)
	for i := range fifty {
		fifty[i] = 0.2
	}
	assert.NoError(t, domain.ValidateManual(max, items(fifty...)), "fifty questions")
	many := append(fifty, 0.2)
	assert.ErrorIs(t, domain.ValidateManual(domain.Points(10.2), items(many...)), domain.ErrInvalidAssessment, "fifty-one questions")
}

// Covers SPEC-075 CA-05, CA-24 (RN-06, D-14): equal weights are split in hundredths and the leftover goes to the first questions.
func TestWeights_EqualDistributionKeepsTheExactSum(t *testing.T) {
	sum := func(ws []domain.Score) domain.Score {
		var s domain.Score
		for _, w := range ws {
			s += w
		}
		return s
	}
	ten := domain.Points(10)
	got := domain.EqualWeights(ten, 3)
	assert.Equal(t, []domain.Score{domain.Points(3.34), domain.Points(3.33), domain.Points(3.33)}, got)
	assert.Equal(t, ten, sum(got))

	assert.Equal(t, []domain.Score{domain.Points(2.5), domain.Points(2.5), domain.Points(2.5), domain.Points(2.5)}, domain.EqualWeights(ten, 4))
	assert.Equal(t, []domain.Score{domain.Points(0.34), domain.Points(0.33), domain.Points(0.33)}, domain.EqualWeights(domain.Points(1), 3))
	assert.Equal(t, []domain.Score{ten}, domain.EqualWeights(ten, 1))
	assert.Empty(t, domain.EqualWeights(ten, 0))
}

// ---- RN-07: the draw ----

func rules(easy, medium, hard int, pe, pm, ph float64) []domain.DrawRule {
	var out []domain.DrawRule
	if easy > 0 {
		out = append(out, domain.DrawRule{Difficulty: domain.DifficultyEasy, Quantity: easy, Points: domain.Points(pe)})
	}
	if medium > 0 {
		out = append(out, domain.DrawRule{Difficulty: domain.DifficultyMedium, Quantity: medium, Points: domain.Points(pm)})
	}
	if hard > 0 {
		out = append(out, domain.DrawRule{Difficulty: domain.DifficultyHard, Quantity: hard, Points: domain.Points(ph)})
	}
	return out
}

// Covers SPEC-075 CA-06 (RN-07): the quantities per level add up to the planned total, which is from 1 to 50.
func TestDraw_QuantitiesMustSumToTheTotal(t *testing.T) {
	max := domain.Points(10)
	assert.NoError(t, domain.ValidateDraw(max, 10, rules(3, 3, 4, 1, 1, 1)))
	assert.ErrorIs(t, domain.ValidateDraw(max, 9, rules(3, 3, 4, 1, 1, 1)), domain.ErrDrawMismatch)
	assert.ErrorIs(t, domain.ValidateDraw(max, 11, rules(3, 3, 4, 1, 1, 1)), domain.ErrDrawMismatch)
	assert.ErrorIs(t, domain.ValidateDraw(max, 0, nil), domain.ErrInvalidAssessment, "total of zero")
	assert.ErrorIs(t, domain.ValidateDraw(domain.Points(51), 51, rules(51, 0, 0, 1, 1, 1)), domain.ErrInvalidAssessment, "total of 51")
	assert.NoError(t, domain.ValidateDraw(max, 5, rules(5, 0, 0, 2, 0, 0)), "one level only")
}

// Covers SPEC-075 CA-06 (RN-07, D-04): the points are uniform inside a level, and quantity times points over all levels is the maximum score.
func TestDraw_PointsAreUniformPerLevelAndSumToMaxScore(t *testing.T) {
	max := domain.Points(10)
	assert.NoError(t, domain.ValidateDraw(max, 10, rules(3, 3, 4, 1, 1, 1)))
	assert.NoError(t, domain.ValidateDraw(max, 3, rules(1, 1, 1, 3.34, 3.33, 3.33)), "ten split in three needs different points per level")
	assert.ErrorIs(t, domain.ValidateDraw(max, 10, rules(3, 3, 4, 1, 1, 1.01)), domain.ErrWeightsMismatch)
	assert.ErrorIs(t, domain.ValidateDraw(max, 10, rules(3, 3, 4, 1, 1, 0.99)), domain.ErrWeightsMismatch)

	assert.ErrorIs(t, domain.ValidateDraw(max, 10, rules(3, 3, 4, 0, 1, 1)), domain.ErrInvalidAssessment, "points of zero")
	twice := append(rules(5, 0, 0, 1, 0, 0), rules(5, 0, 0, 1, 0, 0)...)
	assert.ErrorIs(t, domain.ValidateDraw(max, 10, twice), domain.ErrInvalidAssessment, "the same level twice")
}

// ---- RN-11: the rescheduling ----

func running(typ domain.Type) domain.Assessment {
	a := windowOf(at(21, 9, 0), at(21, 11, 0))
	a.Type = typ
	return a
}

// Covers SPEC-075 CA-12 (RN-11): before the start, both dates change, with the rules of the period.
func TestCheckReschedule_BeforeTheStart(t *testing.T) {
	a := windowOf(at(21, 9, 0), at(21, 11, 0))
	now := at(20, 8, 0)
	assert.NoError(t, domain.CheckReschedule(a, now, at(22, 14, 0), at(22, 16, 0), ""), "a reason is optional before the start")
	assert.NoError(t, domain.CheckReschedule(a, now, at(22, 14, 0), at(22, 16, 0), "Laboratório ocupado"))
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(20, 7, 0), at(22, 16, 0), ""), domain.ErrInvalidPeriod, "start in the past")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(22, 16, 0), at(22, 14, 0), ""), domain.ErrInvalidPeriod, "end before start")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(22, 22, 0), at(23, 1, 0), ""), domain.ErrInvalidPeriod, "an exam cannot cross midnight")
}

// Covers SPEC-075 CA-13 (RN-11, D-07): in progress, the start is kept, the end can only be pushed later, and the reason is required.
func TestCheckReschedule_WhileRunning(t *testing.T) {
	a := running(domain.TypeExam)
	now := at(21, 10, 0)
	assert.NoError(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(21, 12, 0), "Queda de rede no laboratório"))
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(21, 12, 0), ""), domain.ErrReasonRequired)
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(21, 12, 0), "   "), domain.ErrReasonRequired, "a blank reason is no reason")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 30), at(21, 12, 0), "x"), domain.ErrInvalidPeriod, "the start cannot change")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 8, 0), at(21, 12, 0), "x"), domain.ErrInvalidPeriod, "the start cannot go earlier")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(21, 11, 0), "x"), domain.ErrInvalidPeriod, "the same end is no extension")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(21, 10, 30), "x"), domain.ErrInvalidPeriod, "the end cannot come earlier")
	assert.NoError(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(21, 23, 30), "x"), "an exam can run to the end of the day")
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(22, 0, 30), "x"), domain.ErrInvalidPeriod, "an exam cannot cross midnight")

	assignment := running(domain.TypeAssignment)
	assert.NoError(t, domain.CheckReschedule(assignment, now, at(21, 9, 0), at(25, 22, 0), "Prazo estendido"), "an assignment can go on for days")
}

// Covers SPEC-075 CA-14 (RN-11): once the assessment ended or was canceled, nothing is rescheduled.
func TestCheckReschedule_EndedOrCanceled(t *testing.T) {
	ended := windowOf(at(21, 9, 0), at(21, 11, 0))
	assert.ErrorIs(t, domain.CheckReschedule(ended, at(21, 11, 0), at(22, 9, 0), at(22, 11, 0), "x"), domain.ErrAssessmentEnded)

	canceled := windowOf(at(21, 9, 0), at(21, 11, 0))
	canceled.Status = domain.StatusCanceled
	for _, now := range []time.Time{at(20, 8, 0), at(21, 10, 0), at(22, 8, 0)} {
		assert.ErrorIs(t, domain.CheckReschedule(canceled, now, at(23, 9, 0), at(23, 11, 0), "x"), domain.ErrAssessmentCanceled, "in any phase")
	}
}

// Covers SPEC-075 CA-12 (RN-11): the reason has a limit of 500 characters.
func TestCheckReschedule_ReasonHasALimit(t *testing.T) {
	a := running(domain.TypeAssignment)
	now := at(21, 10, 0)
	assert.NoError(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(22, 11, 0), strings.Repeat("a", 500)))
	assert.ErrorIs(t, domain.CheckReschedule(a, now, at(21, 9, 0), at(22, 11, 0), strings.Repeat("a", 501)), domain.ErrInvalidAssessment)
}
