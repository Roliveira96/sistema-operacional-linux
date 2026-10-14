package domain_test

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// Covers SPEC-057 CA-17 and section 5: the horizontal scroll is a finite fraction from 0 to 1, and only the slide has one.
func TestValidStageScrollX(t *testing.T) {
	for _, x := range []float64{0, 0.000001, 0.5, 0.999999, 1} {
		assert.True(t, domain.ValidStageScrollX("slide", x), "slide %v", x)
	}
	for _, x := range []float64{-0.000001, -1, 1.000001, 2, math.NaN(), math.Inf(1), math.Inf(-1), math.MaxFloat64} {
		assert.False(t, domain.ValidStageScrollX("slide", x), "slide %v", x)
	}
	for _, x := range []float64{0, 0.5, 1} {
		assert.False(t, domain.ValidStageScrollX("material", x), "the material has no horizontal scroll: %v", x)
	}
	for _, pane := range []string{"", "page", "Slide", "terminal"} {
		assert.False(t, domain.ValidStageScrollX(pane, 0.5), "pane %q", pane)
	}
}

// Covers SPEC-057 CA-15 and section 5: the zoom is a finite number from 1 (100%) to 2 (200%), inclusive.
func TestValidStageZoom(t *testing.T) {
	for _, zoom := range []float64{1, 1.000001, 1.25, 1.5, 1.75, 1.999999, 2} {
		assert.True(t, domain.ValidStageZoom(zoom), "%v", zoom)
	}
	for _, zoom := range []float64{0, 0.999999, 0.5, -1, 2.000001, 3, 100, math.NaN(), math.Inf(1), math.Inf(-1), math.MaxFloat64} {
		assert.False(t, domain.ValidStageZoom(zoom), "%v", zoom)
	}
}

const (
	pickMaterial = `{"pane":"material","start":{"block":"b1","offset":3},"end":{"block":"b2","offset":7}}`
	pickTerminal = `{"pane":"terminal","terminal":2,"start":3,"end":9}`
)

// Covers SPEC-057 CA-20 and section 3.2: the three shapes of the selection are valid. What the server keeps and passes on is the selection in
// its canonical form (only the fields of its shape); a clear has no selection.
func TestParseStageSelection_TheThreeShapes(t *testing.T) {
	clear, sel, err := domain.ParseStageSelection(json.RawMessage(` { "clear" : true } `))
	require.NoError(t, err)
	assert.True(t, clear)
	assert.Nil(t, sel, "a clear keeps no selection")

	for _, tc := range []struct{ name, in, want string }{
		{"material", pickMaterial, pickMaterial},
		{"material, any order and blanks", ` { "end": {"offset":7, "block":"b2"}, "start": {"block":"b1","offset":3}, "pane":"material" } `, pickMaterial},
		{"terminal", pickTerminal, pickTerminal},
		{"terminal, any order", `{"end":9,"start":3,"terminal":2,"pane":"terminal"}`, pickTerminal},
		{"material, the edges", `{"pane":"material","start":{"block":"` + strings.Repeat("ã", 128) + `","offset":1000000},"end":{"block":"b","offset":0}}`,
			`{"pane":"material","start":{"block":"` + strings.Repeat("ã", 128) + `","offset":1000000},"end":{"block":"b","offset":0}}`},
		{"material, backwards offsets are not the server's business", `{"pane":"material","start":{"block":"b","offset":9},"end":{"block":"b","offset":2}}`,
			`{"pane":"material","start":{"block":"b","offset":9},"end":{"block":"b","offset":2}}`},
		{"terminal, the edges", `{"pane":"terminal","terminal":3,"start":0,"end":1000000}`, `{"pane":"terminal","terminal":3,"start":0,"end":1000000}`},
		{"terminal, start equal to end", `{"pane":"terminal","terminal":1,"start":5,"end":5}`, `{"pane":"terminal","terminal":1,"start":5,"end":5}`},
	} {
		clear, sel, err := domain.ParseStageSelection(json.RawMessage(tc.in))
		require.NoError(t, err, tc.name)
		assert.False(t, clear, tc.name)
		assert.JSONEq(t, tc.want, string(sel), tc.name)
	}
}

// Covers SPEC-057 CA-09 and section 3.2: whatever is none of the three shapes is refused, with the error of the domain, and gives no
// selection: a body that is not an object, a clear that is not true or comes with other fields, an unknown pane, a missing or mistyped
// field, a block that is empty or over 128 characters, an offset that is not an integer or is out of 0 to 1,000,000, a terminal out of
// 1 to 3, a terminal selection that ends before it starts, and any field that the shape does not have.
func TestParseStageSelection_Refused(t *testing.T) {
	ok := `{"block":"b","offset":1}`
	long := `"` + strings.Repeat("b", 129) + `"`
	for _, in := range []string{
		``, `null`, `{}`, `"x"`, `[1]`, `42`, `true`, `{"clear":true} {"clear":true}`, `{"clear":true}x`,
		`{"clear":false}`, `{"clear":"true"}`, `{"clear":1}`, `{"clear":null}`, `{"clear":true,"extra":1}`, `{"clear":true,"pane":"terminal","terminal":1,"start":0,"end":1}`,
		`{"pane":"slide","start":0,"end":1}`, `{"pane":""}`, `{"pane":5}`, `{"pane":null}`, `{"pane":"Material","start":` + ok + `,"end":` + ok + `}`,
		`{"start":` + ok + `,"end":` + ok + `}`, `{"pane":"material"}`, `{"pane":"terminal"}`,
		`{"pane":"material","start":` + ok + `}`, `{"pane":"material","end":` + ok + `}`,
		`{"pane":"material","start":null,"end":` + ok + `}`, `{"pane":"material","start":3,"end":` + ok + `}`, `{"pane":"material","start":` + ok + `,"end":"b"}`,
		`{"pane":"material","start":{"offset":1},"end":` + ok + `}`, `{"pane":"material","start":{"block":"","offset":1},"end":` + ok + `}`,
		`{"pane":"material","start":{"block":` + long + `,"offset":1},"end":` + ok + `}`, `{"pane":"material","start":{"block":5,"offset":1},"end":` + ok + `}`,
		`{"pane":"material","start":{"block":"b"},"end":` + ok + `}`, `{"pane":"material","start":{"block":"b","offset":-1},"end":` + ok + `}`,
		`{"pane":"material","start":{"block":"b","offset":1000001},"end":` + ok + `}`, `{"pane":"material","start":{"block":"b","offset":1.5},"end":` + ok + `}`,
		`{"pane":"material","start":{"block":"b","offset":"3"},"end":` + ok + `}`, `{"pane":"material","start":{"block":"b","offset":1e999},"end":` + ok + `}`,
		`{"pane":"material","start":` + ok + `,"end":{"block":"b","offset":-1}}`, `{"pane":"material","start":` + ok + `,"end":{"block":"","offset":1}}`,
		`{"pane":"material","start":{"block":"b","offset":1,"extra":1},"end":` + ok + `}`, `{"pane":"material","terminal":1,"start":` + ok + `,"end":` + ok + `}`,
		`{"pane":"material","start":` + ok + `,"end":` + ok + `,"foo":1}`,
		`{"pane":"terminal","start":0,"end":1}`, `{"pane":"terminal","terminal":0,"start":0,"end":1}`, `{"pane":"terminal","terminal":4,"start":0,"end":1}`,
		`{"pane":"terminal","terminal":-1,"start":0,"end":1}`, `{"pane":"terminal","terminal":"1","start":0,"end":1}`, `{"pane":"terminal","terminal":1.5,"start":0,"end":1}`,
		`{"pane":"terminal","terminal":null,"start":0,"end":1}`, `{"pane":"terminal","terminal":1,"end":1}`, `{"pane":"terminal","terminal":1,"start":0}`,
		`{"pane":"terminal","terminal":1,"start":5,"end":3}`, `{"pane":"terminal","terminal":1,"start":-1,"end":1}`, `{"pane":"terminal","terminal":1,"start":0,"end":-1}`,
		`{"pane":"terminal","terminal":1,"start":0,"end":1000001}`, `{"pane":"terminal","terminal":1,"start":1.5,"end":2}`, `{"pane":"terminal","terminal":1,"start":"1","end":2}`,
		`{"pane":"terminal","terminal":1,"start":` + ok + `,"end":2}`, `{"pane":"terminal","terminal":1,"start":0,"end":1,"foo":1}`,
		`{"pane":"terminal","terminal":1,"start":0,"end":1,"block":"b"}`,
	} {
		clear, sel, err := domain.ParseStageSelection(json.RawMessage(in))
		assert.ErrorIs(t, err, domain.ErrInvalidSelection, in)
		assert.False(t, clear, in)
		assert.Nil(t, sel, in)
	}
}
