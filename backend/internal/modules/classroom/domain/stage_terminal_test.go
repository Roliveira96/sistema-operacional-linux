package domain_test

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-057 CA-23 and section 3.2: the scroll of a terminal names one of the three terminals (1 to 3) and is a finite fraction from 0
// to 1 of what that screen can scroll.
func TestValidTerminalScroll(t *testing.T) {
	for _, terminal := range []int{1, 2, 3} {
		for _, y := range []float64{0, 0.000001, 0.5, 0.999999, 1} {
			assert.True(t, domain.ValidTerminalScroll(terminal, y), "terminal %d, %v", terminal, y)
		}
		for _, y := range []float64{-0.000001, -1, 1.000001, 2, math.NaN(), math.Inf(1), math.Inf(-1), math.MaxFloat64} {
			assert.False(t, domain.ValidTerminalScroll(terminal, y), "terminal %d, %v", terminal, y)
		}
	}
	for _, terminal := range []int{0, 4, -1, 100, math.MaxInt} {
		assert.False(t, domain.ValidTerminalScroll(terminal, 0.5), "terminal %d", terminal)
	}
	assert.Equal(t, 1, domain.MinSelectionTerminal, "the same three terminals as the selection of text")
	assert.Equal(t, 3, domain.MaxSelectionTerminal)
	assert.Equal(t, "terminal", domain.PaneTerminal)
}
