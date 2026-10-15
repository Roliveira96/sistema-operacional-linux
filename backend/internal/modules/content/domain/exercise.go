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
	// Choices and CorrectChoice belong to the single choice question (SPEC-036 RN-02, RN-03).
	Choices       json.RawMessage
	CorrectChoice *string
	// ShuffleChoices is nil when the request does not say, which is to shuffle (SPEC-036 D-07).
	ShuffleChoices *bool
	// ExpectedAnswer and MaxLength belong to the descriptive question: the correct answer the teacher writes and the size of the
	// answer of the student (SPEC-039 D-03, D-05).
	ExpectedAnswer string
	MaxLength      *int
	// Left, Right and Pairs belong to the matching question: the two columns in the order of the teacher and the correct pairs she
	// selected (SPEC-037 D-09).
	Left, Right, Pairs json.RawMessage
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
	// Choices are the alternatives of a single choice question, each with its stable id and its filtered html (SPEC-036).
	Choices json.RawMessage
	// ShuffleChoices shuffles the alternatives for the student (SPEC-036 D-07); true unless the teacher keeps her order.
	ShuffleChoices bool
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
	out := NormalizedExercise{Kind: in.Kind, ShuffleChoices: in.ShuffleChoices == nil || *in.ShuffleChoices}
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

// CatalogFromConditions translates the conditions of finalization of an exercise, in the form the teacher edits and the content stores them (the
// list under "conditions" of an item of a block of exercises, SPEC-022 RN-11), into the catalog the server grades with: the same translation
// that the module bank does when it saves an exercise (SPEC-023 D-05), public for whoever reads the exercise of a block to grade it (SPEC-065).
// Nothing, null and an empty list are no conditions and give an empty catalog. A list that cannot be graded is an error that wraps
// ErrInvalidConditions: not a list, a condition of a kind that does not exist (which would be left out and make the exercise easier) or one that
// lacks what its kind needs.
func CatalogFromConditions(raw json.RawMessage) ([]Condition, error) {
	var list []exerciseCondition
	if err := decodeOptional(raw, &list); err != nil {
		return nil, fmt.Errorf("%w: the conditions must be a list of conditions", ErrInvalidConditions)
	}
	out := make([]Condition, 0, len(list))
	for _, e := range list {
		translated := catalogFromEnd([]exerciseCondition{e})
		if len(translated) == 0 {
			return nil, fmt.Errorf("%w: unknown kind %q", ErrInvalidConditions, e.Kind)
		}
		out = append(out, translated...)
	}
	if len(out) > 0 {
		if err := ValidateConditions(out); err != nil {
			return nil, err
		}
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
