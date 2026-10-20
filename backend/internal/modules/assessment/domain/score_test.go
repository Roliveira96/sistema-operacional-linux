package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-075 RN-06, RN-07 (section 4): points are whole hundredths, rounded without the error of a float, and read and written as the numeric(5,2)
// of the database.
func TestScore_PointsAreWholeHundredths(t *testing.T) {
	assert.Equal(t, domain.Score(1000), domain.Points(10))
	assert.Equal(t, domain.Score(334), domain.Points(3.34))
	assert.Equal(t, domain.Score(30), domain.Points(0.1+0.2), "0.1 + 0.2 is 0.30000000000000004 in a float")
	assert.Equal(t, 2.5, domain.Points(2.5).Float())
	assert.Equal(t, 0.05, domain.Points(0.05).Float())
}

func TestScore_WritesTheDecimalTextTheColumnReads(t *testing.T) {
	for score, want := range map[domain.Score]string{1000: "10.00", 334: "3.34", 5: "0.05", 0: "0.00", 10000: "100.00", -250: "-2.50"} {
		got, err := score.Value()
		require.NoError(t, err)
		assert.Equal(t, want, got)
	}
}

func TestScore_ReadsWhatTheDriverGives(t *testing.T) {
	cases := map[string]struct {
		src  any
		want domain.Score
	}{
		"text":    {"3.34", 334},
		"bytes":   {[]byte("10.00"), 1000},
		"float":   {2.5, 250},
		"integer": {int64(7), 700},
		"null":    {nil, 0},
	}
	for name, c := range cases {
		var s domain.Score
		require.NoError(t, s.Scan(c.src), name)
		assert.Equal(t, c.want, s, name)
	}
	var s domain.Score
	assert.Error(t, s.Scan("dez"), "text that is no number")
	assert.Error(t, s.Scan(true), "a type the column never gives")
}

// Covers SPEC-075 RN-12, RN-13: a reason is trimmed, required, and has at most 500 characters; the notes are trimmed, may be empty, and have at most
// 5,000 characters, counted in characters and not in bytes.
func TestClean_ReasonAndNotes(t *testing.T) {
	reason, err := domain.CleanReason("  Falta de energia  ")
	require.NoError(t, err)
	assert.Equal(t, "Falta de energia", reason)
	_, err = domain.CleanReason(" \n ")
	assert.ErrorIs(t, err, domain.ErrReasonRequired)
	_, err = domain.CleanReason(strings.Repeat("ç", 500))
	assert.NoError(t, err, "500 characters of two bytes each")
	_, err = domain.CleanReason(strings.Repeat("ç", 501))
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment)

	notes, err := domain.CleanNotes("  Conferir o lab 02 ")
	require.NoError(t, err)
	assert.Equal(t, "Conferir o lab 02", notes)
	notes, err = domain.CleanNotes("   ")
	require.NoError(t, err)
	assert.Empty(t, notes, "a blank text clears the notes")
	_, err = domain.CleanNotes(strings.Repeat("ç", 5000))
	assert.NoError(t, err)
	_, err = domain.CleanNotes(strings.Repeat("ç", 5001))
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment)
}

func TestStockError_IsTheErrorOfInsufficientStock(t *testing.T) {
	err := error(&domain.StockError{Short: []domain.Shortage{{Difficulty: domain.DifficultyHard, Asked: 5, Available: 4}}})
	assert.ErrorIs(t, err, domain.ErrInsufficientStock)
	assert.NotErrorIs(t, err, domain.ErrInvalidAssessment)
	assert.Equal(t, domain.ErrInsufficientStock.Error(), err.Error())
}
