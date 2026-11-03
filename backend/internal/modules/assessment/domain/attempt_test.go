package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-090 CA-01 (RN-03): the deadline is the start plus the duration, or the end of the assessment when it comes first or there is no
// duration.
func TestAttemptDeadline(t *testing.T) {
	thirty := 30
	assert.True(t, domain.AttemptDeadline(at(21, 9, 10), &thirty, at(21, 11, 0)).Equal(at(21, 9, 40)))
	assert.True(t, domain.AttemptDeadline(at(21, 10, 50), &thirty, at(21, 11, 0)).Equal(at(21, 11, 0)))
	assert.True(t, domain.AttemptDeadline(at(21, 9, 10), nil, at(21, 11, 0)).Equal(at(21, 11, 0)))
}

// Covers SPEC-090 CA-07 (RN-07, D-04): an attempt in progress is overdue only after its deadline plus one minute; a closed one never is.
func TestAttempt_Overdue(t *testing.T) {
	a := domain.Attempt{Status: domain.AttemptInProgress, DeadlineAt: at(21, 11, 0)}
	assert.False(t, a.Overdue(at(21, 11, 1)), "within the tolerance")
	assert.True(t, a.Overdue(at(21, 11, 2)))
	a.Status = domain.AttemptSubmitted
	assert.False(t, a.Overdue(at(21, 12, 0)))
}

// Covers SPEC-090 CA-06 (RN-08, D-01): the points of an item are its weight times the share that is right, rounded to the hundredth.
func TestScoreOf(t *testing.T) {
	assert.Equal(t, domain.Points(2), domain.ScoreOf(domain.Points(2), 1))
	assert.Equal(t, domain.Points(1), domain.ScoreOf(domain.Points(2), 0.5))
	assert.Equal(t, domain.Points(0.33), domain.ScoreOf(domain.Points(1), 1.0/3))
	assert.Equal(t, domain.Score(0), domain.ScoreOf(domain.Points(2), 0))
}
