package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
)

// Reader errors.
var (
	ErrModuleNotFound = errors.New("module not found or not available")
	ErrAuthRequired   = errors.New("authentication required")
	ErrForbidden      = errors.New("access to this module is not allowed")
	// ErrQuestionNotFound covers missing, draft, theoretical and assessment
	// questions: only published practical exercises can be practiced (SPEC-014).
	ErrQuestionNotFound = errors.New("practice question not found")
)

// ModuleAccess applies the visibility rules of SPEC-010 (coursemodule).
type ModuleAccess interface {
	GetModuleByID(ctx context.Context, moduleID uuid.UUID, user cmservice.UserAccessContext) (cmrepository.ModuleDetails, error)
}

// ReadStore reads content for display.
type ReadStore interface {
	ListBlocks(ctx context.Context, moduleID uuid.UUID) ([]domain.ContentBlock, error)
	ListQuestions(ctx context.Context, moduleID uuid.UUID, usage string, includeDrafts bool) ([]domain.Question, error)
	ListActiveTemplates(ctx context.Context) ([]TemplateSummary, error)
	FindQuestion(ctx context.Context, id uuid.UUID) (domain.Question, error)
	FindScenario(ctx context.Context, id uuid.UUID) (domain.Scenario, error)
	FindScenarioBySourceKey(ctx context.Context, key string) (domain.Scenario, error)
	SaveBlockProgress(ctx context.Context, userID, blockID uuid.UUID, completed bool) (domain.BlockProgress, error)
	ListModuleBlockProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.BlockProgress, error)
}

// TopicScenarioPrefix prefixes the module source key in the key of the topic
// machine extracted from the prototype (SPEC-016).
const TopicScenarioPrefix = "scenario/topic/"

// PracticeItem is what the practice module needs from an exercise: the
// starting state for the browser and the conditions for the server.
type PracticeItem struct {
	QuestionID uuid.UUID
	ModuleID   uuid.UUID
	Snapshot   json.RawMessage
	Conditions []domain.Condition
}

// TemplateSummary is the public view of an assessment template (RN-04).
type TemplateSummary struct {
	ID              uuid.UUID `json:"id"`
	Title           string    `json:"title"`
	Description     string    `json:"description"`
	DurationMinutes int       `json:"durationMinutes"`
	QuestionCount   int       `json:"questionCount"`
}

// PublicQuestion is the view for visitors and students: no answer key,
// conditions or explanation (RN-02). Practical training exercises carry their
// reference solution, shown on demand as in the prototype (SPEC-016 P-02).
type PublicQuestion struct {
	ID         uuid.UUID       `json:"id"`
	Kind       string          `json:"kind"`
	Usage      string          `json:"usage"`
	Difficulty string          `json:"difficulty"`
	Title      string          `json:"title"`
	Statement  string          `json:"statement"`
	Hint       *string         `json:"hint,omitempty"`
	Choices    json.RawMessage `json:"choices,omitempty"`
	Solution   json.RawMessage `json:"solution,omitempty"`
}

// TeacherQuestion is the full view for the module owner and admins.
type TeacherQuestion struct {
	PublicQuestion
	Status               string          `json:"status"`
	SourceKey            *string         `json:"sourceKey,omitempty"`
	Explanation          *string         `json:"explanation,omitempty"`
	ScenarioID           *uuid.UUID      `json:"scenarioId,omitempty"`
	ReferenceSolution    json.RawMessage `json:"referenceSolution,omitempty"`
	ValidationConditions json.RawMessage `json:"validationConditions,omitempty"`
	AnswerKey            json.RawMessage `json:"answerKey,omitempty"`
	Tags                 json.RawMessage `json:"tags,omitempty"`
}

// Reader serves the read endpoints of SPEC-012.
type Reader struct {
	access ModuleAccess
	store  ReadStore
}

// NewReader creates the reader.
func NewReader(access ModuleAccess, store ReadStore) *Reader {
	return &Reader{access: access, store: store}
}

// Viewer identifies who is reading; UserID is nil for visitors.
type Viewer struct {
	UserID *uuid.UUID
	Role   string
}

func (v Viewer) accessContext() cmservice.UserAccessContext {
	return cmservice.UserAccessContext{
		UserID: v.UserID, Role: v.Role,
		IsTeacher: v.Role == "TEACHER", IsAdmin: v.Role == "ADMIN", IsStudent: v.Role == "STUDENT",
	}
}

// module resolves the module with the visibility rules, mapping errors (RN-01).
func (r *Reader) module(ctx context.Context, moduleID uuid.UUID, v Viewer) (cmrepository.ModuleDetails, error) {
	details, err := r.access.GetModuleByID(ctx, moduleID, v.accessContext())
	switch {
	case err == nil:
		return details, nil
	case errors.Is(err, cmdomain.ErrModuleNotFound), errors.Is(err, cmdomain.ErrModuleInactive), errors.Is(err, cmdomain.ErrModuleExpired):
		return details, ErrModuleNotFound
	case errors.Is(err, cmdomain.ErrForbidden):
		if v.UserID == nil {
			return details, ErrAuthRequired
		}
		return details, ErrForbidden
	}
	return details, err
}

// Blocks returns the module blocks in order.
func (r *Reader) Blocks(ctx context.Context, moduleID uuid.UUID, v Viewer) ([]domain.ContentBlock, error) {
	if _, err := r.module(ctx, moduleID, v); err != nil {
		return nil, err
	}
	all, err := r.store.ListBlocks(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	// Inactive blocks stay in the authoring list only (SPEC-019 RN-12).
	active := make([]domain.ContentBlock, 0, len(all))
	for _, b := range all {
		if b.Active() {
			active = append(active, b)
		}
	}
	return active, nil
}

// Questions returns the published questions of a module without answers
// (RN-02, RN-03). usage may be empty, EXERCISE or ASSESSMENT.
func (r *Reader) Questions(ctx context.Context, moduleID uuid.UUID, usage string, v Viewer) ([]PublicQuestion, error) {
	if _, err := r.module(ctx, moduleID, v); err != nil {
		return nil, err
	}
	qs, err := r.store.ListQuestions(ctx, moduleID, usage, false)
	if err != nil {
		return nil, err
	}
	out := make([]PublicQuestion, len(qs))
	for i, q := range qs {
		out[i] = publicView(q)
	}
	return out, nil
}

// TeacherQuestions returns every question, with answers, to the module owner
// and admins (RN-02, RN-03).
func (r *Reader) TeacherQuestions(ctx context.Context, moduleID uuid.UUID, v Viewer) ([]TeacherQuestion, error) {
	details, err := r.module(ctx, moduleID, v)
	if err != nil {
		return nil, err
	}
	if v.Role != "ADMIN" && (v.UserID == nil || details.Module.TeacherID != *v.UserID) {
		return nil, ErrForbidden
	}
	qs, err := r.store.ListQuestions(ctx, moduleID, "", true)
	if err != nil {
		return nil, err
	}
	out := make([]TeacherQuestion, len(qs))
	for i, q := range qs {
		out[i] = TeacherQuestion{
			PublicQuestion: publicView(q), Status: q.Status, SourceKey: q.SourceKey, Explanation: q.Explanation,
			ScenarioID: q.ScenarioID, ReferenceSolution: q.ReferenceSolution, ValidationConditions: q.ValidationConditions,
			AnswerKey: q.AnswerKey, Tags: q.Tags,
		}
	}
	return out, nil
}

// Templates lists the active assessment templates (RN-04).
func (r *Reader) Templates(ctx context.Context) ([]TemplateSummary, error) {
	return r.store.ListActiveTemplates(ctx)
}

func publicView(q domain.Question) PublicQuestion {
	p := PublicQuestion{
		ID: q.ID, Kind: q.Kind, Usage: q.Usage, Difficulty: q.Difficulty, Title: q.Title, Statement: q.Statement, Hint: q.Hint,
	}
	if q.Kind == domain.KindPractical && q.Usage == domain.UsageExercise {
		p.Solution = q.ReferenceSolution
	}
	if q.Kind != domain.KindPractical && q.Kind != domain.KindDiscursive {
		p.Choices = q.Choices
	}
	return p
}

// PracticeItem returns a published practical exercise the viewer can access
// (SPEC-014 RN-01, RN-05). The conditions are for server-side grading only.
func (r *Reader) PracticeItem(ctx context.Context, questionID uuid.UUID, v Viewer) (PracticeItem, error) {
	q, err := r.store.FindQuestion(ctx, questionID)
	if errors.Is(err, ErrNotFound) {
		return PracticeItem{}, ErrQuestionNotFound
	}
	if err != nil {
		return PracticeItem{}, err
	}
	if q.Kind != domain.KindPractical || q.Usage != domain.UsageExercise || q.Status != domain.StatusPublished || q.ScenarioID == nil {
		return PracticeItem{}, ErrQuestionNotFound
	}
	if _, err := r.module(ctx, q.ModuleID, v); err != nil {
		return PracticeItem{}, err
	}
	scenario, err := r.store.FindScenario(ctx, *q.ScenarioID)
	if err != nil {
		return PracticeItem{}, err
	}
	var conditions []domain.Condition
	if err := json.Unmarshal(q.ValidationConditions, &conditions); err != nil {
		return PracticeItem{}, err
	}
	return PracticeItem{QuestionID: q.ID, ModuleID: q.ModuleID, Snapshot: scenario.Snapshot, Conditions: conditions}, nil
}

// TopicScenario returns the machine the study screen starts on (SPEC-016 5.1): the environment an
// author prepared (SPEC-020 RN-03), or the prepared machine of the module topic, or nil when the
// module has neither and the default machine applies.
func (r *Reader) TopicScenario(ctx context.Context, moduleID uuid.UUID, v Viewer) (json.RawMessage, error) {
	details, err := r.module(ctx, moduleID, v)
	if err != nil {
		return nil, err
	}

	// The effective environment is the one of the last active card that has one.
	blocks, err := r.store.ListBlocks(ctx, moduleID)
	if err != nil {
		return nil, err
	}
	var last *uuid.UUID
	for _, b := range blocks {
		if !b.Active() || b.BlockType != domain.BlockText {
			continue
		}
		if id, ok := environmentRef(b.Payload); ok {
			last = &id
		}
	}
	if last != nil {
		sc, err := r.store.FindScenario(ctx, *last)
		if err == nil {
			return sc.Snapshot, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	if details.Module.SourceKey == nil {
		return nil, nil
	}
	scenario, err := r.store.FindScenarioBySourceKey(ctx, TopicScenarioPrefix+*details.Module.SourceKey)
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return scenario.Snapshot, nil
}

// ModulePracticeItems returns the published practical exercises of a module
// the viewer can access, with their conditions, for the batch check of
// SPEC-016 5.2. Snapshots are not loaded: the student's machine is graded.
func (r *Reader) ModulePracticeItems(ctx context.Context, moduleID uuid.UUID, v Viewer) ([]PracticeItem, error) {
	if _, err := r.module(ctx, moduleID, v); err != nil {
		return nil, err
	}
	qs, err := r.store.ListQuestions(ctx, moduleID, domain.UsageExercise, false)
	if err != nil {
		return nil, err
	}
	items := make([]PracticeItem, 0, len(qs))
	for _, q := range qs {
		if q.Kind != domain.KindPractical || q.Status != domain.StatusPublished {
			continue
		}
		var conditions []domain.Condition
		if err := json.Unmarshal(q.ValidationConditions, &conditions); err != nil {
			return nil, fmt.Errorf("conditions of question %s: %w", q.ID, err)
		}
		items = append(items, PracticeItem{QuestionID: q.ID, ModuleID: q.ModuleID, Conditions: conditions})
	}
	return items, nil
}

// BlockProgressResult describes a single block progress update.
type BlockProgressResult struct {
	BlockID     uuid.UUID  `json:"blockId"`
	Completed   bool       `json:"completed"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

// ModuleBlockProgressResult describes student reading progress for a module.
type ModuleBlockProgressResult struct {
	ModuleID           uuid.UUID            `json:"moduleId"`
	CompletedBlockIDs  []uuid.UUID          `json:"completedBlockIds"`
	CompletedAtByBlock map[string]time.Time `json:"completedAtByBlock"`
}

// ToggleBlockProgress marks or unmarks a block as read by the authenticated viewer.
func (r *Reader) ToggleBlockProgress(ctx context.Context, blockID uuid.UUID, completed bool, v Viewer) (BlockProgressResult, error) {
	if v.UserID == nil {
		return BlockProgressResult{}, ErrAuthRequired
	}
	p, err := r.store.SaveBlockProgress(ctx, *v.UserID, blockID, completed)
	if err != nil {
		return BlockProgressResult{}, err
	}
	res := BlockProgressResult{BlockID: blockID, Completed: completed}
	if completed {
		res.CompletedAt = &p.CompletedAt
	}
	return res, nil
}

// ModuleBlockProgress retrieves all completed block progress records for a module.
func (r *Reader) ModuleBlockProgress(ctx context.Context, moduleID uuid.UUID, v Viewer) (ModuleBlockProgressResult, error) {
	if v.UserID == nil {
		return ModuleBlockProgressResult{ModuleID: moduleID, CompletedBlockIDs: []uuid.UUID{}, CompletedAtByBlock: map[string]time.Time{}}, nil
	}
	if _, err := r.module(ctx, moduleID, v); err != nil {
		return ModuleBlockProgressResult{}, err
	}
	list, err := r.store.ListModuleBlockProgress(ctx, *v.UserID, moduleID)
	if err != nil {
		return ModuleBlockProgressResult{}, err
	}
	ids := make([]uuid.UUID, len(list))
	byBlock := make(map[string]time.Time, len(list))
	for i, bp := range list {
		ids[i] = bp.BlockID
		byBlock[bp.BlockID.String()] = bp.CompletedAt
	}
	return ModuleBlockProgressResult{ModuleID: moduleID, CompletedBlockIDs: ids, CompletedAtByBlock: byBlock}, nil
}

