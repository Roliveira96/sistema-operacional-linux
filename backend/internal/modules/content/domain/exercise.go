package domain

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ExerciseInput is what the teacher sends for an exercise of the module (SPEC-023 5): the fields come as written and
// are checked and trimmed by NormalizeExercise. Kind says which contract applies (SPEC-035 RN-02); empty is PRACTICAL.
type ExerciseInput struct {
	Kind       string
	Title      string
	Difficulty string
	Statement  string
	Hints      json.RawMessage
	Solution   json.RawMessage
	Conditions json.RawMessage
	// CorrectAnswer and Explanation belong to the true or false question (SPEC-035 RN-03).
	CorrectAnswer *bool
	Explanation   string
	// HasDependency tells whether the request says the exercise depends on another one.
	HasDependency bool
}

// NormalizedExercise is an exercise ready to be stored: every field filtered and trimmed. A practical exercise has the
// conditions in the two forms the system needs: EndConditions is the form the teacher edits (SPEC-022); Catalog is the same
// conditions in the catalog of the server (SPEC-011 and 013), which is what grades the student (SPEC-023 D-05). A true or false
// question has its answer key and justification instead (SPEC-035).
type NormalizedExercise struct {
	Kind          string
	Title         string
	Difficulty    string
	Statement     string
	Hints         json.RawMessage
	Solution      json.RawMessage
	EndConditions json.RawMessage
	Catalog       []Condition
	AnswerKey     json.RawMessage
	Explanation   *string
}

// decodeOptional reads a list or object that may be missing or null.
func decodeOptional(raw json.RawMessage, into any) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return decode(raw, into)
}

// NormalizeExercise checks an exercise of the module: the fields every kind shares with the same rules as an exercise of a
// card (SPEC-022 RN-02 and RN-03), then the fields of its kind (SPEC-035 RN-02). A *PayloadError lists the invalid fields.
func NormalizeExercise(in ExerciseInput, s *HTMLSanitizer) (NormalizedExercise, error) {
	c := &checker{s: s}
	if in.Kind == "" {
		in.Kind = KindPractical
	}
	kind, ok := TypeOf(in.Kind)
	if !ok {
		return NormalizedExercise{}, &PayloadError{Fields: []FieldError{{"kind", "must be one of " + strings.Join(BankKinds(), ", ")}}}
	}
	out := NormalizedExercise{Kind: in.Kind}
	out.Title = c.text("title", in.Title, MaxTitleLength, true)
	if in.Difficulty != "EASY" && in.Difficulty != "MEDIUM" && in.Difficulty != "HARD" {
		c.fail("difficulty", "must be EASY, MEDIUM or HARD")
	}
	out.Difficulty = in.Difficulty
	out.Statement = c.html("statement", in.Statement, false)

	var hints []exerciseHint
	if err := decodeOptional(in.Hints, &hints); err != nil {
		c.fail("hints", "must be a list of tips")
	} else if len(hints) > MaxExerciseHint {
		c.fail("hints", fmt.Sprintf("must have at most %d hints", MaxExerciseHint))
	} else {
		for j := range hints {
			hints[j].Text = c.text(fmt.Sprintf("hints[%d].text", j), hints[j].Text, MaxHintText, true)
			hints[j].Command = c.text(fmt.Sprintf("hints[%d].command", j), hints[j].Command, MaxCommandLength, false)
		}
	}
	if hints == nil {
		hints = []exerciseHint{}
	}

	kind.normalize(c, in, &out)
	if len(c.errs) > 0 {
		return NormalizedExercise{}, &PayloadError{Fields: c.errs}
	}
	var err error
	if out.Hints, err = marshalNoEscape(hints); err != nil {
		return NormalizedExercise{}, err
	}
	return out, nil
}

// catalogFromEnd translates the conditions of finalization into the catalog the server grades with (SPEC-023 D-05).
// An OWNER with a group becomes two conditions, one for the owner and one for the group.
func catalogFromEnd(list []exerciseCondition) []Condition {
	out := make([]Condition, 0, len(list))
	for _, e := range list {
		switch e.Kind {
		case "DIR_EXISTS":
			out = append(out, Condition{Type: CondDirectoryExists, Path: e.Path})
		case "FILE_EXISTS":
			out = append(out, Condition{Type: CondFileExists, Path: e.Path})
		case "PATH_ABSENT":
			out = append(out, Condition{Type: CondPathAbsent, Path: e.Path})
		case "FILE_CONTENT":
			kind := CondContentEquals
			if e.Match == "contains" {
				kind = CondContentContains
			}
			out = append(out, Condition{Type: kind, Path: e.Path, Value: e.Content})
		case "MODE":
			out = append(out, Condition{Type: CondPermissionMode, Path: e.Path, Mode: e.Mode})
		case "OWNER":
			out = append(out, Condition{Type: CondOwner, Path: e.Path, User: e.Owner})
			if strings.TrimSpace(e.Group) != "" {
				group := e.Group
				out = append(out, Condition{Type: CondGroupOwner, Path: e.Path, Group: &group})
			}
		case "LINK":
			target := e.Target
			out = append(out, Condition{Type: CondSymlink, Path: e.Path, Target: &target})
		case "USER_EXISTS":
			out = append(out, Condition{Type: CondUserExists, User: e.Name})
		case "GROUP_EXISTS":
			group := e.Name
			out = append(out, Condition{Type: CondGroupExists, Group: &group})
		case "USER_IN_GROUP":
			group := e.Name
			out = append(out, Condition{Type: CondUserInGroup, User: e.User, Group: &group})
		case "PROCESS_RUNNING":
			out = append(out, Condition{Type: CondProcessRunning, Process: e.Name})
		case "PROCESS_ABSENT":
			out = append(out, Condition{Type: CondProcessAbsent, Process: e.Name})
		case "PROCESS_STOPPED":
			out = append(out, Condition{Type: CondProcessStopped, Process: e.Name})
		case "PROCESS_ENDED_BY":
			out = append(out, Condition{Type: CondProcessEndedBy, Process: e.Name, Signal: e.Signal})
		case "PROCESS_NICE":
			out = append(out, Condition{Type: CondProcessNice, Process: e.Name, Nice: e.Nice})
		}
	}
	return out
}
