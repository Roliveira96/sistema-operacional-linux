package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
)

// ValidateModuleResult lists the structural problems of the draft.
type ValidateModuleResult struct {
	ModuleID uuid.UUID             `json:"moduleId"`
	Valid    bool                  `json:"valid"`
	Problems []domain.FieldProblem `json:"problems"`
	// Next tells the agent what is left to the teacher: validation does not replace the tests nor publish.
	Next string `json:"next"`
}

const validateNext = "This check is structural and does not run commands. To publish, the teacher must run the module test and the exercise bank test in the web app and then publish the version there."

// ValidateModule checks the draft with the same validators the services use when they write, and lists
// every problem with its field path (validate_module, RN-09, CA-13a). It reads only.
func (s *Service) ValidateModule(ctx context.Context, c Caller, in ModuleInput) (ValidateModuleResult, *domain.ToolError) {
	id, terr := parseID("moduleId", in.ModuleID)
	if terr != nil {
		return ValidateModuleResult{}, terr
	}
	blocks, err := s.authoring.List(ctx, c.actor(), id)
	if err != nil {
		return ValidateModuleResult{}, fail(err, fieldContext{})
	}
	setup, err := s.authoring.Setup(ctx, c.actor(), id)
	if err != nil {
		return ValidateModuleResult{}, fail(err, fieldContext{})
	}
	bank, err := s.exercises.List(ctx, c.actor(), id)
	if err != nil {
		return ValidateModuleResult{}, fail(err, fieldContext{})
	}

	problems := []domain.FieldProblem{}
	for i, b := range blocks {
		_, err := contentdomain.NormalizePayload(b.BlockType, b.Payload, s.san)
		problems = append(problems, s.payloadProblems(err, b.Payload, fmt.Sprintf("blocks[%d].payload.", i), b.ID.String())...)
	}
	if len(setup) > 0 {
		_, err := contentdomain.NormalizeSetup(setup)
		problems = append(problems, s.payloadProblems(err, wrap("setup", setup), "", "")...)
	}
	if len(bank.BankSetup) > 0 {
		_, err := contentdomain.NormalizeSetup(bank.BankSetup)
		problems = append(problems, s.payloadProblems(err, wrap("bankSetup", bank.BankSetup), "", "", renameSetup)...)
	}
	known := make(map[uuid.UUID]bool, len(bank.Items))
	for _, it := range bank.Items {
		known[it.ID] = true
	}
	for i, it := range bank.Items {
		problems = append(problems, s.exerciseProblems(i, it, known)...)
	}
	return ValidateModuleResult{ModuleID: id, Valid: len(problems) == 0, Problems: problems, Next: validateNext}, nil
}

// exerciseProblems checks one exercise of the bank. What came from the initial load has no conditions in
// the form of the editor and is left alone.
func (s *Service) exerciseProblems(i int, it contentservice.ExerciseRecord, known map[uuid.UUID]bool) []domain.FieldProblem {
	if len(it.EndConditions) == 0 {
		return nil
	}
	at := func(f string) string { return fmt.Sprintf("exercises[%d].%s", i, f) }
	ref := it.ID.String()
	_, err := contentdomain.NormalizeExercise(contentdomain.ExerciseInput{
		Title: it.Title, Difficulty: it.Difficulty, Statement: it.Statement, Hints: it.Hints, Solution: it.ReferenceSolution, Conditions: it.EndConditions,
	}, s.san)
	root, _ := json.Marshal(map[string]any{"title": it.Title, "difficulty": it.Difficulty, "statement": it.Statement,
		"hints": json.RawMessage(rawOrEmptyList(it.Hints)), "solution": json.RawMessage(rawOrNull(it.ReferenceSolution)), "conditions": json.RawMessage(rawOrEmptyList(it.EndConditions))})
	out := s.payloadProblems(err, root, fmt.Sprintf("exercises[%d].", i), ref)
	if string(it.EndConditions) == "[]" {
		out = append(out, domain.FieldProblem{Field: at("conditions"), Received: "[]", Expected: "at least one condition of finalization, or nobody can finish the exercise", Ref: ref})
	}
	if it.DependsOn != nil && !known[*it.DependsOn] {
		out = append(out, domain.FieldProblem{Field: at("dependsOn"), Received: it.DependsOn.String(), Expected: "another exercise of the module", Ref: ref})
	}
	return out
}

// renameSetup is the rename the exercise service applies to the fields of the snapshot of the bank.
func renameSetup(path string) string {
	if strings.HasPrefix(path, "setup") {
		return "bankSetup" + path[len("setup"):]
	}
	return path
}

// payloadProblems turns a payload error into problems, prefixing each path and reading the value received
// from root (the JSON the path is relative to).
func (s *Service) payloadProblems(err error, root json.RawMessage, prefix, ref string, rename ...func(string) string) []domain.FieldProblem {
	var pe *contentdomain.PayloadError
	if err == nil {
		return nil
	}
	if !errors.As(err, &pe) {
		return []domain.FieldProblem{{Field: strings.TrimSuffix(prefix, "."), Received: missing, Expected: err.Error(), Ref: ref}}
	}
	out := make([]domain.FieldProblem, len(pe.Fields))
	for i, f := range pe.Fields {
		path := f.Field
		for _, r := range rename {
			path = r(path)
		}
		out[i] = domain.FieldProblem{Field: prefix + path, Received: receivedAt(root, path), Expected: f.Reason, Ref: ref}
	}
	return out
}

func wrap(key string, raw json.RawMessage) json.RawMessage {
	b, _ := json.Marshal(map[string]json.RawMessage{key: raw})
	return b
}
