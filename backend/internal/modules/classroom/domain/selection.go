package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// The limits of the selection of text of the teacher (SPEC-057): the block is named by the screen of the material, which the server does
// not read, so only the size of its name is checked.
const (
	MaxSelectionBlockLength = 128
	MaxSelectionOffset      = 1_000_000
	MinSelectionTerminal    = 1
	MaxSelectionTerminal    = 3
)

// ErrInvalidSelection is the answer to a selection that is none of the three shapes of the message.
var ErrInvalidSelection = errors.New("the selection must be a clear, or a stretch of the material, or of one of the terminals")

// selectionWire holds every field of the three shapes, to tell which one came and to refuse the rest. A field that the message does not
// have is refused by the strict decoder; the ones that belong to another shape are refused by ParseStageSelection.
type selectionWire struct {
	Clear    *bool           `json:"clear"`
	Pane     *string         `json:"pane"`
	Terminal *int            `json:"terminal"`
	Start    json.RawMessage `json:"start"`
	End      json.RawMessage `json:"end"`
}

type blockPoint struct {
	Block  *string `json:"block"`
	Offset *int    `json:"offset"`
}

// The canonical forms: what the server keeps and passes on, with only the fields of the shape.
type (
	selectionPoint struct {
		Block  string `json:"block"`
		Offset int    `json:"offset"`
	}
	materialSelection struct {
		Pane  string         `json:"pane"`
		Start selectionPoint `json:"start"`
		End   selectionPoint `json:"end"`
	}
	terminalSelection struct {
		Pane     string `json:"pane"`
		Terminal int    `json:"terminal"`
		Start    int    `json:"start"`
		End      int    `json:"end"`
	}
)

// decodeStrict reads exactly one JSON value into v and refuses any field that v does not have.
func decodeStrict(data []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return ErrInvalidSelection // something came after the value
	}
	return nil
}

func validOffset(n int) bool { return n >= 0 && n <= MaxSelectionOffset }

// offsetIn reads a JSON integer and tells whether it is there and from 0 to MaxSelectionOffset.
func offsetIn(raw json.RawMessage) (int, bool) {
	var n *int
	if decodeStrict(raw, &n) != nil || n == nil || !validOffset(*n) {
		return 0, false
	}
	return *n, true
}

func pointIn(raw json.RawMessage) (selectionPoint, bool) {
	var p blockPoint
	if decodeStrict(raw, &p) != nil || p.Block == nil || p.Offset == nil {
		return selectionPoint{}, false
	}
	if n := utf8.RuneCountInString(*p.Block); n < 1 || n > MaxSelectionBlockLength || !validOffset(*p.Offset) {
		return selectionPoint{}, false
	}
	return selectionPoint{Block: *p.Block, Offset: *p.Offset}, true
}

// ParseStageSelection checks the data of live:stage:selection (SPEC-057), which is one of three shapes: {"clear": true}; a stretch of the
// material, {"pane": "material", "start": {"block", "offset"}, "end": {"block", "offset"}}; or a stretch of one terminal, {"pane":
// "terminal", "terminal", "start", "end"} with the start not after the end. It reports whether it is the clear one (which has no selection)
// and, otherwise, returns the selection in its canonical form. Anything else, a field that is missing, mistyped or unknown included, is
// ErrInvalidSelection. The order of two blocks of the material is not checked: the server does not know what a block is.
func ParseStageSelection(data json.RawMessage) (cleared bool, selection json.RawMessage, err error) {
	var w selectionWire
	if decodeStrict(data, &w) != nil {
		return false, nil, ErrInvalidSelection
	}
	if w.Clear != nil {
		if !*w.Clear || w.Pane != nil || w.Terminal != nil || w.Start != nil || w.End != nil {
			return false, nil, ErrInvalidSelection
		}
		return true, nil, nil
	}
	if w.Pane == nil {
		return false, nil, ErrInvalidSelection
	}
	var canonical any
	switch *w.Pane {
	case PaneMaterial:
		start, okStart := pointIn(w.Start)
		end, okEnd := pointIn(w.End)
		if w.Terminal != nil || !okStart || !okEnd {
			return false, nil, ErrInvalidSelection
		}
		canonical = materialSelection{Pane: PaneMaterial, Start: start, End: end}
	case PaneTerminal:
		start, okStart := offsetIn(w.Start)
		end, okEnd := offsetIn(w.End)
		if w.Terminal == nil || *w.Terminal < MinSelectionTerminal || *w.Terminal > MaxSelectionTerminal || !okStart || !okEnd || start > end {
			return false, nil, ErrInvalidSelection
		}
		canonical = terminalSelection{Pane: PaneTerminal, Terminal: *w.Terminal, Start: start, End: end}
	default:
		return false, nil, ErrInvalidSelection
	}
	selection, err = json.Marshal(canonical)
	return false, selection, err
}
