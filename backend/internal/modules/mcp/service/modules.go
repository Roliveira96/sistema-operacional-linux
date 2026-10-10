package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
)

// ModuleView is the data of a module.
type ModuleView struct {
	ID              uuid.UUID  `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Slug            *string    `json:"slug"`
	Visibility      string     `json:"visibility"`
	Status          string     `json:"status"`
	ActivationStart *time.Time `json:"activationStart"`
	ActivationEnd   *time.Time `json:"activationEnd"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func moduleView(m cmdomain.CourseModule) ModuleView {
	return ModuleView{ID: m.ID, Title: m.Title, Description: m.Description, Slug: m.Slug, Visibility: string(m.Visibility), Status: string(m.Status),
		ActivationStart: m.ActivationStart, ActivationEnd: m.ActivationEnd, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt}
}

// ListModulesInput filters the modules.
type ListModulesInput struct {
	Status     string `json:"status,omitempty"`
	Visibility string `json:"visibility,omitempty"`
	Search     string `json:"search,omitempty"`
	Page       int    `json:"page,omitempty"`
	Limit      int    `json:"limit,omitempty"`
}

// ModuleListItem is a module of the list.
type ModuleListItem struct {
	ModuleView
	TotalExercises        int64 `json:"totalExercises"`
	HasUnpublishedChanges bool  `json:"hasUnpublishedChanges"`
}

// ListModulesResult is a page of modules.
type ListModulesResult struct {
	Items []ModuleListItem `json:"items"`
	Total int64            `json:"total"`
	Page  int              `json:"page"`
	Limit int              `json:"limit"`
}

const (
	defaultListLimit = 20
	maxListLimit     = 100
)

// ListModules lists the modules the caller can edit (list_modules).
func (s *Service) ListModules(ctx context.Context, c Caller, in ListModulesInput) (ListModulesResult, *domain.ToolError) {
	if in.Page < 1 {
		in.Page = 1
	}
	if in.Limit < 1 {
		in.Limit = defaultListLimit
	}
	in.Limit = min(in.Limit, maxListLimit)
	res, err := s.modules.ListModules(ctx, c.access(), cmrepository.ListFilter{Status: in.Status, Visibility: in.Visibility, Search: in.Search, Page: in.Page, Limit: in.Limit})
	if err != nil {
		return ListModulesResult{}, fail(err, fieldContext{})
	}
	out := ListModulesResult{Items: make([]ModuleListItem, len(res.Items)), Total: res.TotalCount, Page: res.Page, Limit: res.Limit}
	for i, it := range res.Items {
		list, err := s.versions.List(ctx, c.actor(), it.ID)
		if err != nil {
			return ListModulesResult{}, fail(err, fieldContext{})
		}
		out.Items[i] = ModuleListItem{ModuleView: moduleView(it.CourseModule), TotalExercises: it.TotalExercises, HasUnpublishedChanges: list.HasUnpublishedChanges}
	}
	return out, nil
}

// ModuleInput names a module.
type ModuleInput struct {
	ModuleID string `json:"moduleId"`
}

// GetModuleResult is the whole module as the author sees it.
type GetModuleResult struct {
	Module                ModuleView       `json:"module"`
	Blocks                []BlockView      `json:"blocks"`
	Setup                 json.RawMessage  `json:"setup"`
	Exercises             []ExerciseView   `json:"exercises"`
	BankSetup             json.RawMessage  `json:"bankSetup"`
	Versions              []VersionSummary `json:"versions"`
	HasUnpublishedChanges bool             `json:"hasUnpublishedChanges"`
	// The tests the teacher runs in the web app before publishing (SPEC-024 RN-13); the agent only reads them.
	ModuleTestPassed       bool `json:"moduleTestPassed"`
	ExerciseBankTestPassed bool `json:"exerciseBankTestPassed"`
}

// GetModule returns data, draft blocks, snapshot, exercises and versions (get_module). The authoring
// service reads first: it is what refuses a module of someone else.
func (s *Service) GetModule(ctx context.Context, c Caller, in ModuleInput) (GetModuleResult, *domain.ToolError) {
	id, terr := parseID("moduleId", in.ModuleID)
	if terr != nil {
		return GetModuleResult{}, terr
	}
	blocks, err := s.authoring.List(ctx, c.actor(), id)
	if err != nil {
		return GetModuleResult{}, fail(err, fieldContext{})
	}
	setup, err := s.authoring.Setup(ctx, c.actor(), id)
	if err != nil {
		return GetModuleResult{}, fail(err, fieldContext{})
	}
	bank, err := s.exercises.List(ctx, c.actor(), id)
	if err != nil {
		return GetModuleResult{}, fail(err, fieldContext{})
	}
	list, err := s.versions.List(ctx, c.actor(), id)
	if err != nil {
		return GetModuleResult{}, fail(err, fieldContext{})
	}
	details, err := s.modules.GetModuleByID(ctx, id, c.access())
	if err != nil {
		return GetModuleResult{}, fail(err, fieldContext{})
	}
	return GetModuleResult{
		Module: moduleView(details.Module), Blocks: blockViews(blocks), Setup: rawOrNull(setup),
		Exercises: exerciseViews(bank.Items), BankSetup: rawOrNull(bank.BankSetup),
		Versions: versionViews(list.Versions), HasUnpublishedChanges: list.HasUnpublishedChanges,
		ModuleTestPassed: list.ModuleTestPassed, ExerciseBankTestPassed: list.ExerciseBankTestPassed,
	}, nil
}

// CreateModuleInput creates a module.
type CreateModuleInput struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Slug            *string  `json:"slug,omitempty"`
	Visibility      string   `json:"visibility"`
	ActivationStart *string  `json:"activationStart,omitempty"`
	ActivationEnd   *string  `json:"activationEnd,omitempty"`
	ClassIDs        []string `json:"classIds,omitempty"`
}

// CreateModule creates a module owned by the caller (create_module).
func (s *Service) CreateModule(ctx context.Context, c Caller, in CreateModuleInput) (ModuleView, *domain.ToolError) {
	start, terr := optionalTime("activationStart", in.ActivationStart)
	if terr != nil {
		return ModuleView{}, terr
	}
	end, terr := optionalTime("activationEnd", in.ActivationEnd)
	if terr != nil {
		return ModuleView{}, terr
	}
	classIDs, terr := parseIDs("classIds", in.ClassIDs)
	if terr != nil {
		return ModuleView{}, terr
	}
	if terr := s.allow(c); terr != nil {
		return ModuleView{}, terr
	}
	m, err := s.modules.CreateModule(ctx, cmservice.CreateModuleInput{
		TeacherID: c.UserID, Title: in.Title, Description: in.Description, Slug: in.Slug,
		Visibility: cmdomain.Visibility(in.Visibility), ActivationStart: start, ActivationEnd: end, ClassIDs: classIDs,
	})
	if err != nil {
		terr := fail(err, fieldContext{})
		s.audit(c, domain.ToolCreateModule, "", terr)
		return ModuleView{}, terr
	}
	s.audit(c, domain.ToolCreateModule, m.ID.String(), nil)
	return moduleView(m), nil
}

// UpdateModuleMetadataInput edits the data of a module; a field left out keeps its value and a null
// clears slug and dates.
type UpdateModuleMetadataInput struct {
	ModuleID        string          `json:"moduleId"`
	Title           *string         `json:"title,omitempty"`
	Description     *string         `json:"description,omitempty"`
	Slug            json.RawMessage `json:"slug,omitempty"`
	Visibility      *string         `json:"visibility,omitempty"`
	Status          *string         `json:"status,omitempty"`
	ActivationStart json.RawMessage `json:"activationStart,omitempty"`
	ActivationEnd   json.RawMessage `json:"activationEnd,omitempty"`
	ClassIDs        []string        `json:"classIds,omitempty"`
}

// UpdateModuleMetadata edits the data of a module (update_module_metadata).
func (s *Service) UpdateModuleMetadata(ctx context.Context, c Caller, in UpdateModuleMetadataInput) (out ModuleView, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolUpdateModuleMetadata, in.ModuleID)
	if terr != nil {
		return ModuleView{}, terr
	}
	defer func() { done(terr) }()

	slug, terr := stringPatch("slug", in.Slug)
	if terr != nil {
		return ModuleView{}, terr
	}
	start, terr := timePatch("activationStart", in.ActivationStart)
	if terr != nil {
		return ModuleView{}, terr
	}
	end, terr := timePatch("activationEnd", in.ActivationEnd)
	if terr != nil {
		return ModuleView{}, terr
	}
	classIDs, terr := parseIDs("classIds", in.ClassIDs)
	if terr != nil {
		return ModuleView{}, terr
	}
	input := cmservice.UpdateModuleInput{
		ModuleID: id, CallerID: c.UserID, IsAdmin: c.Role == domain.RoleAdmin,
		Title: in.Title, Description: in.Description, Slug: slug, ActivationStart: start, ActivationEnd: end, ClassIDs: classIDs,
	}
	if in.Visibility != nil {
		v := cmdomain.Visibility(*in.Visibility)
		input.Visibility = &v
	}
	if in.Status != nil {
		st := cmdomain.ModuleStatus(*in.Status)
		input.Status = &st
	}
	m, err := s.modules.UpdateModule(ctx, input)
	if err != nil {
		return ModuleView{}, fail(err, fieldContext{})
	}
	return moduleView(m), nil
}

// ArchiveModule archives a module, keeping classes and history (archive_module).
func (s *Service) ArchiveModule(ctx context.Context, c Caller, in ModuleInput) (out ModuleView, terr *domain.ToolError) {
	id, done, terr := s.begin(c, domain.ToolArchiveModule, in.ModuleID)
	if terr != nil {
		return ModuleView{}, terr
	}
	defer func() { done(terr) }()
	archived := cmdomain.ModuleStatusArchived
	m, err := s.modules.UpdateModule(ctx, cmservice.UpdateModuleInput{ModuleID: id, CallerID: c.UserID, IsAdmin: c.Role == domain.RoleAdmin, Status: &archived})
	if err != nil {
		return ModuleView{}, fail(err, fieldContext{})
	}
	return moduleView(m), nil
}

// VersionSummary is a published version.
type VersionSummary struct {
	Number     int       `json:"number"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"createdAt"`
	CreatedBy  string    `json:"createdBy"`
	BlockCount int       `json:"blockCount"`
	Current    bool      `json:"current"`
}

func versionViews(list []contentservice.VersionSummary) []VersionSummary {
	out := make([]VersionSummary, len(list))
	for i, v := range list {
		out[i] = VersionSummary(v)
	}
	return out
}

// ListModuleVersionsResult lists the versions of a module.
type ListModuleVersionsResult struct {
	ModuleID               uuid.UUID        `json:"moduleId"`
	Versions               []VersionSummary `json:"versions"`
	HasUnpublishedChanges  bool             `json:"hasUnpublishedChanges"`
	ModuleTestPassed       bool             `json:"moduleTestPassed"`
	ExerciseBankTestPassed bool             `json:"exerciseBankTestPassed"`
}

// ListModuleVersions lists the versions, read only (list_module_versions).
func (s *Service) ListModuleVersions(ctx context.Context, c Caller, in ModuleInput) (ListModuleVersionsResult, *domain.ToolError) {
	id, terr := parseID("moduleId", in.ModuleID)
	if terr != nil {
		return ListModuleVersionsResult{}, terr
	}
	list, err := s.versions.List(ctx, c.actor(), id)
	if err != nil {
		return ListModuleVersionsResult{}, fail(err, fieldContext{})
	}
	return ListModuleVersionsResult{ModuleID: id, Versions: versionViews(list.Versions), HasUnpublishedChanges: list.HasUnpublishedChanges,
		ModuleTestPassed: list.ModuleTestPassed, ExerciseBankTestPassed: list.ExerciseBankTestPassed}, nil
}

func optionalTime(field string, raw *string) (*time.Time, *domain.ToolError) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	t, terr := parseTime(field, *raw)
	if terr != nil {
		return nil, terr
	}
	return &t, nil
}

func parseIDs(field string, raw []string) ([]uuid.UUID, *domain.ToolError) {
	if raw == nil {
		return nil, nil
	}
	out := make([]uuid.UUID, len(raw))
	for i, r := range raw {
		id, terr := parseID(field+"["+itoa(i)+"]", r)
		if terr != nil {
			return nil, terr
		}
		out[i] = id
	}
	return out, nil
}

// stringPatch reads a field that may be absent (keep), null (clear) or a string (replace).
func stringPatch(field string, raw json.RawMessage) (cmservice.Patch[string], *domain.ToolError) {
	if len(raw) == 0 {
		return cmservice.Patch[string]{}, nil
	}
	if isNull(raw) {
		return cmservice.Patch[string]{Set: true}, nil
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return cmservice.Patch[string]{}, invalid(field, string(raw), "a string or null")
	}
	return cmservice.Patch[string]{Set: true, Value: &v}, nil
}

// timePatch is stringPatch for an RFC 3339 date; an empty string clears like null, as in the REST layer.
func timePatch(field string, raw json.RawMessage) (cmservice.Patch[time.Time], *domain.ToolError) {
	p, terr := stringPatch(field, raw)
	if terr != nil {
		return cmservice.Patch[time.Time]{}, terr
	}
	if !p.Set || p.Value == nil || *p.Value == "" {
		return cmservice.Patch[time.Time]{Set: p.Set}, nil
	}
	t, terr := parseTime(field, *p.Value)
	if terr != nil {
		return cmservice.Patch[time.Time]{}, terr
	}
	return cmservice.Patch[time.Time]{Set: true, Value: &t}, nil
}

// allow applies the rate limit to a write that has no module yet (RN-10).
func (s *Service) allow(c Caller) *domain.ToolError {
	if s.limiter == nil {
		return nil
	}
	if ok, retry := s.limiter.Allow(c.UserID.String()); !ok {
		return rateLimited(retry)
	}
	return nil
}
