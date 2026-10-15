package domain_test

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-057 CA-09 and section 5: the scroll of a pane is a finite fraction from 0 to 1 of a pane the stage has (slide or material).
func TestValidStageScroll(t *testing.T) {
	for _, pane := range []string{"slide", "material"} {
		for _, y := range []float64{0, 0.000001, 0.5, 0.999999, 1} {
			assert.True(t, domain.ValidStageScroll(pane, y), "%s %v", pane, y)
		}
		for _, y := range []float64{-0.000001, -1, 1.000001, 2, math.NaN(), math.Inf(1), math.Inf(-1), math.MaxFloat64} {
			assert.False(t, domain.ValidStageScroll(pane, y), "%s %v", pane, y)
		}
	}
	for _, pane := range []string{"", "page", "Slide", "SLIDE", "slide ", "terminal"} {
		assert.False(t, domain.ValidStageScroll(pane, 0.5), "pane %q", pane)
	}
	assert.Equal(t, "slide", domain.PaneSlide)
	assert.Equal(t, "material", domain.PaneMaterial)
}

// Covers SPEC-057 CA-09 and section 5: the divider is a finite fraction of the width of the stage from 0.2 to 0.8.
func TestValidStageSplit(t *testing.T) {
	for _, ratio := range []float64{0.2, 0.200001, 0.5, 0.799999, 0.8} {
		assert.True(t, domain.ValidStageSplit(ratio), "%v", ratio)
	}
	for _, ratio := range []float64{0, 0.199999, 0.800001, 1, -0.5, 2, math.NaN(), math.Inf(1), math.Inf(-1)} {
		assert.False(t, domain.ValidStageSplit(ratio), "%v", ratio)
	}
}
