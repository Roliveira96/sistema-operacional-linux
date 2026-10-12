package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// ExerciseView is an exercise of the bank of a module.
type ExerciseView struct {
	ID         uuid.UUID       `json:"id"`
	Kind       string          `json:"kind"`
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement"`
	Hints      json.RawMessage `json:"hints"`
	Solution   json.RawMessage `json:"solution"`
	Conditions json.RawMessage `json:"conditions"`
	// CorrectAnswer and Explanation belong to a true or false question (SPEC-035 RN-15).
	CorrectAnswer *bool      `json:"correctAnswer,omitempty"`
	Explanation   *string    `json:"explanation,omitempty"`
	Practice      bool       `json:"practice"`
	Assessment    bool       `json:"assessment"`
	Exclusive     bool       `json:"exclusive"`
	DependsOn     *uuid.UUID `json:"dependsOn"`
	Status        string     `json:"status"`
	Position      int        `json:"position"`
	Mandatory     bool       `json:"mandatory"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

func exerciseView(r contentservice.ExerciseRecord) ExerciseView {
	l := r.Links()
	v := ExerciseView{
		ID: r.ID, Kind: r.Kind, Title: r.Title, Difficulty: r.Difficulty, Statement: r.Statement, Hints: rawOrEmptyList(r.Hints), Conditions: rawOrEmptyList(r.EndConditions),
		Practice: l.Practice, Assessment: l.Assessment, Exclusive: l.Exclusive, DependsOn: r.DependsOn, Status: r.Status,
		Position: r.Position, Mandatory: r.Mandatory, UpdatedAt: r.UpdatedAt, Solution: json.RawMessage("null"),
	}
	// The solution of what came from the initial load is in another format and is not shown.
	if len(r.EndConditions) > 0 && len(r.ReferenceSolution) > 0 {
		v.Solution = r.ReferenceSolution
	}
	if correct, ok := contentdomain.BooleanAnswer(r.AnswerKey); ok && r.Kind == contentdomain.KindTheoreticalBoolean {
		v.CorrectAnswer = &correct
	}
	if r.Kind == contentdomain.KindTheoreticalBoolean {
		v.Explanation = r.Explanation
	}
	return v
}

func exerciseViews(items []contentservice.ExerciseRecord) []ExerciseView {
	out := make([]ExerciseView, len(items))
	for i, it := range items {
		out[i] = exerciseView(it)
	}
	return out
}

// LinksInput are the places of the module an exercise is linked to.
type LinksInput struct {
	Practice   bool `json:"practice"`
	Assessment bool `json:"assessment"`
	Exclusive  bool `json:"exclusive"`
}

func (l LinksInput) links() contentservice.ExerciseLinks {
	return contentservice.ExerciseLinks{Practice: l.Practice, Assessment: l.Assessment, Exclusive: l.Exclusive}
}

// CreateModuleExerciseInput creates an exercise.
type CreateModuleExerciseInput struct {
	ModuleID   string          `json:"moduleId"`
	Kind       string          `json:"kind,omitempty"`
	Title      string          `json:"title"`
	Difficulty string          `json:"difficulty"`
	Statement  string          `json:"statement,omitempty"`
	Hints      json.RawMessage `json:"hints,omitempty"`
	Solution   json.RawMessage `json:"solution,omitempty"`
	Conditions json.RawMessage `json:"conditions,omitempty"`
	// CorrectAnswer and Explanation are for a THEORETICAL_BOOLEAN question (SPEC-035 RN-15).
	CorrectAnswer *bool      `json:"correctAnswer,omitempty"`
	Explanation   string     `json:"explanation,omitempty"`
	DependsOn     *string    `json:"dependsOn,omitempty"`
	Links         LinksInput `json:"links"`
}

// ExerciseResult is an exercise after a change.
type ExerciseResult struct {
	ModuleID uuid.UUID    `json:"moduleId"`
	Exercise ExerciseView `json:"exercise"`
}

// CreateModuleExercise creates an exercise as a draft, with its links, in one operation of the service
// (create_module_exercise).
func (s *Service) CreateModuleExercise(ctx context.Context, c Caller, in CreateModuleExerciseInput) (out ExerciseResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolCreateModuleExercise, in.ModuleID)
	if terr != nil {
		return ExerciseResult{}, terr
	}
	defer func() { done(terr) }()
	var dependsOn *uuid.UUID
	if in.DependsOn != nil {
		d, terr := parseID("dependsOn", *in.DependsOn)
		if terr != nil {
			return ExerciseResult{}, terr
		}
		dependsOn = &d
	}
	rec, err := s.exercises.Create(ctx, c.actor(), id, contentdomain.ExerciseInput{
		Kind: in.Kind, Title: in.Title, Difficulty: in.Difficulty, Statement: in.Statement, Hints: in.Hints, Solution: in.Solution, Conditions: in.Conditions,
		CorrectAnswer: in.CorrectAnswer, Explanation: in.Explanation, HasDependency: dependsOn != nil,
	}, dependsOn, in.Links.links())
	if err != nil {
		return ExerciseResult{}, fail(err, fieldContext{root: rootOf(in)})
	}
	return ExerciseResult{ModuleID: id, Exercise: exerciseView(rec)}, nil
}

// Operations of update_module_exercise.
const (
	OpSetLinks = "SET_LINKS"
	OpReorder  = "REORDER"
)

// OrderEntry is one place of the trail.
type OrderEntry struct {
	ExerciseID string `json:"exerciseId"`
	Mandatory  bool   `json:"mandatory"`
}

// UpdateModuleExerciseInput changes an exercise; the fields given replace the stored ones.
type UpdateModuleExerciseInput struct {
	ModuleID   string          `json:"moduleId"`
	ExerciseID string          `json:"exerciseId,omitempty"`
	Operation  string          `json:"operation"`
	Title      *string         `json:"title,omitempty"`
	Difficulty *string         `json:"difficulty,omitempty"`
	Statement  *string         `json:"statement,omitempty"`
	Hints      json.RawMessage `json:"hints,omitempty"`
	Solution   json.RawMessage `json:"solution,omitempty"`
	Conditions json.RawMessage `json:"conditions,omitempty"`
	// CorrectAnswer (null clears it) and Explanation are for a THEORETICAL_BOOLEAN question (SPEC-035 RN-15).
	CorrectAnswer json.RawMessage `json:"correctAnswer,omitempty"`
	Explanation   *string         `json:"explanation,omitempty"`
	DependsOn     json.RawMessage `json:"dependsOn,omitempty"`
	Links         *LinksInput     `json:"links,omitempty"`
	UpdatedAt     *string         `json:"updatedAt,omitempty"`
	Order         []OrderEntry    `json:"order,omitempty"`
}

// UpdateModuleExerciseResult is the outcome: the exercise, or the fact it was deleted or the trail reordered.
type UpdateModuleExerciseResult struct {
	ModuleID  uuid.UUID     `json:"moduleId"`
	Exercise  *ExerciseView `json:"exercise"`
	Deleted   bool          `json:"deleted"`
	Reordered bool          `json:"reordered"`
}

// UpdateModuleExercise edits, relinks, deletes or reorders exercises (update_module_exercise).
func (s *Service) UpdateModuleExercise(ctx context.Context, c Caller, in UpdateModuleExerciseInput) (out UpdateModuleExerciseResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolUpdateModuleExercise, in.ModuleID)
	if terr != nil {
		return UpdateModuleExerciseResult{}, terr
	}
	defer func() { done(terr) }()
	res := UpdateModuleExerciseResult{ModuleID: id}
	fc := fieldContext{root: rootOf(in)}

	if in.Operation == OpReorder {
		items := make([]contentservice.OrderItem, len(in.Order))
		for i, o := range in.Order {
			ex, terr := parseID("order["+itoa(i)+"].exerciseId", o.ExerciseID)
			if terr != nil {
				return res, terr
			}
			items[i] = contentservice.OrderItem{ExerciseID: ex, Mandatory: o.Mandatory}
		}
		if err := s.exercises.Reorder(ctx, c.actor(), id, items); err != nil {
			return UpdateModuleExerciseResult{}, fail(err, fc)
		}
		res.Reordered = true
		return res, nil
	}

	if in.Operation != OpUpdate && in.Operation != OpSetLinks && in.Operation != OpDelete {
		return res, invalid("operation", in.Operation, "one of UPDATE, SET_LINKS, DELETE, REORDER")
	}
	exID, terr := parseID("exerciseId", in.ExerciseID)
	if terr != nil {
		return res, terr
	}
	switch in.Operation {
	case OpDelete:
		if err := s.exercises.Delete(ctx, c.actor(), id, exID); err != nil {
			return UpdateModuleExerciseResult{}, fail(err, fc)
		}
		res.Deleted = true
	case OpSetLinks:
		if in.Links == nil {
			return res, invalid("links", "", "the links of the exercise")
		}
		cur, err := s.exercises.Get(ctx, c.actor(), id, exID)
		if err != nil {
			return UpdateModuleExerciseResult{}, fail(err, fc)
		}
		// The status stays as it is: publishing an exercise is for the teacher, in the web app.
		rec, err := s.exercises.SetLinks(ctx, c.actor(), id, exID, in.Links.links(), cur.Status)
		if err != nil {
			return UpdateModuleExerciseResult{}, fail(err, fc)
		}
		v := exerciseView(rec)
		res.Exercise = &v
	case OpUpdate:
		rec, terr := s.patchExercise(ctx, c, id, exID, exercisePatch{
			Title: in.Title, Difficulty: in.Difficulty, Statement: in.Statement, Hints: in.Hints, Solution: in.Solution,
			Conditions: in.Conditions, CorrectAnswer: in.CorrectAnswer, Explanation: in.Explanation, DependsOn: in.DependsOn, UpdatedAt: in.UpdatedAt,
		}, fc)
		if terr != nil {
			return UpdateModuleExerciseResult{}, terr
		}
		v := exerciseView(rec)
		res.Exercise = &v
	}
	return res, nil
}

// exercisePatch is what a change gives for an exercise; what is left out keeps the stored value.
type exercisePatch struct {
	Title, Difficulty, Statement *string
	Hints, Solution, Conditions  json.RawMessage
	CorrectAnswer                json.RawMessage
	Explanation                  *string
	DependsOn                    json.RawMessage
	UpdatedAt                    *string
}

// patchExercise reads the exercise, applies the patch over it and saves it through the service, which
// validates the whole exercise.
func (s *Service) patchExercise(ctx context.Context, c Caller, moduleID, exID uuid.UUID, p exercisePatch, fc fieldContext) (contentservice.ExerciseRecord, *domain.ToolError) {
	cur, err := s.exercises.Get(ctx, c.actor(), moduleID, exID)
	if err != nil {
		return contentservice.ExerciseRecord{}, fail(err, fc)
	}
	input := contentdomain.ExerciseInput{Kind: cur.Kind, Title: cur.Title, Difficulty: cur.Difficulty, Statement: cur.Statement, Hints: cur.Hints, Conditions: cur.EndConditions}
	if correct, ok := contentdomain.BooleanAnswer(cur.AnswerKey); ok {
		input.CorrectAnswer = &correct
	}
	if cur.Explanation != nil {
		input.Explanation = *cur.Explanation
	}
	if len(p.CorrectAnswer) > 0 {
		input.CorrectAnswer = nil
		if !isNull(p.CorrectAnswer) {
			var correct bool
			if err := json.Unmarshal(p.CorrectAnswer, &correct); err != nil {
				return contentservice.ExerciseRecord{}, invalid("correctAnswer", string(p.CorrectAnswer), "true, false or null")
			}
			input.CorrectAnswer = &correct
		}
	}
	if p.Explanation != nil {
		input.Explanation = *p.Explanation
	}
	// The solution of what came from the initial load is in another format and is not carried over.
	if len(cur.EndConditions) > 0 {
		input.Solution = cur.ReferenceSolution
	}
	if p.Title != nil {
		input.Title = *p.Title
	}
	if p.Difficulty != nil {
		input.Difficulty = *p.Difficulty
	}
	if p.Statement != nil {
		input.Statement = *p.Statement
	}
	if len(p.Hints) > 0 {
		input.Hints = p.Hints
	}
	if len(p.Solution) > 0 {
		input.Solution = p.Solution
	}
	if len(p.Conditions) > 0 {
		input.Conditions = p.Conditions
	}
	dependsOn := cur.DependsOn
	if len(p.DependsOn) > 0 {
		dependsOn = nil
		if !isNull(p.DependsOn) {
			var raw string
			if err := json.Unmarshal(p.DependsOn, &raw); err != nil {
				return contentservice.ExerciseRecord{}, invalid("dependsOn", string(p.DependsOn), "an exercise id or null")
			}
			d, terr := parseID("dependsOn", raw)
			if terr != nil {
				return contentservice.ExerciseRecord{}, terr
			}
			dependsOn = &d
		}
	}
	input.HasDependency = dependsOn != nil
	var expected time.Time
	force := p.UpdatedAt == nil
	if !force {
		var terr *domain.ToolError
		if expected, terr = parseTime("updatedAt", *p.UpdatedAt); terr != nil {
			return contentservice.ExerciseRecord{}, terr
		}
	}
	rec, err := s.exercises.Update(ctx, c.actor(), moduleID, exID, input, dependsOn, expected, force)
	if err != nil {
		return contentservice.ExerciseRecord{}, fail(err, fc)
	}
	return rec, nil
}

// SetExerciseSetupInput defines the scenario of the exercises of a module.
type SetExerciseSetupInput struct {
	ModuleID   string          `json:"moduleId"`
	ExerciseID string          `json:"exerciseId,omitempty"`
	Solution   json.RawMessage `json:"solution,omitempty"`
	DependsOn  json.RawMessage `json:"dependsOn,omitempty"`
	BankSetup  json.RawMessage `json:"bankSetup,omitempty"`
}

// SetExerciseSetupResult is the exercise changed, or the snapshot of the bank.
type SetExerciseSetupResult struct {
	ModuleID  uuid.UUID       `json:"moduleId"`
	Exercise  *ExerciseView   `json:"exercise"`
	BankSetup json.RawMessage `json:"bankSetup"`
}

// SetExerciseSetup sets the recipe and the inheritance of one exercise, or the snapshot shared by the
// exercises of the module (set_exercise_setup).
func (s *Service) SetExerciseSetup(ctx context.Context, c Caller, in SetExerciseSetupInput) (out SetExerciseSetupResult, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolSetExerciseSetup, in.ModuleID)
	if terr != nil {
		return SetExerciseSetupResult{}, terr
	}
	defer func() { done(terr) }()
	fc := fieldContext{root: rootOf(in)}
	res := SetExerciseSetupResult{ModuleID: id, BankSetup: json.RawMessage("null")}

	if in.ExerciseID != "" {
		exID, terr := parseID("exerciseId", in.ExerciseID)
		if terr != nil {
			return res, terr
		}
		if len(in.Solution) == 0 && len(in.DependsOn) == 0 {
			return res, invalid("solution", "", "solution and/or dependsOn")
		}
		rec, terr := s.patchExercise(ctx, c, id, exID, exercisePatch{Solution: in.Solution, DependsOn: in.DependsOn}, fc)
		if terr != nil {
			return res, terr
		}
		v := exerciseView(rec)
		res.Exercise = &v
		return res, nil
	}
	if len(in.BankSetup) == 0 {
		return res, invalid("bankSetup", "", "a snapshot object or null (give exerciseId to set the scenario of one exercise)")
	}
	clean, err := s.exercises.SetBankSetup(ctx, c.actor(), id, in.BankSetup)
	if err != nil {
		return res, fail(err, fc)
	}
	res.BankSetup = rawOrNull(clean)
	return res, nil
}
