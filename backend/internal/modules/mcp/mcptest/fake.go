// Package mcptest has the hand-written test double of the services the MCP module consumes. It keeps
// everything in memory, authorizes like the real services (ADMIN any module, TEACHER the owner) and runs the
// real payload validators, so the tests see the same errors the REST layer would.
package mcptest

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
)

// Fake implements Modules, Authoring, Exercises, Versions and Limiter of the service package.
type Fake struct {
	mu        sync.Mutex
	Modules   map[uuid.UUID]*cmdomain.CourseModule
	Blocks    map[uuid.UUID][]contentdomain.ContentBlock
	Setups    map[uuid.UUID]json.RawMessage
	BankSetup map[uuid.UUID]json.RawMessage
	Exercises map[uuid.UUID][]contentservice.ExerciseRecord
	Versions_ map[uuid.UUID][]contentservice.VersionSummary
	Changed   map[uuid.UUID]bool
	// Fail makes the named method return the error (the first call only).
	Fail map[string]error
	// Calls lists the methods called, in order.
	Calls []string
	// Deny makes the rate limiter refuse.
	Deny bool

	san *contentdomain.HTMLSanitizer
}

// New creates an empty fake.
func New() *Fake {
	return &Fake{
		Modules: map[uuid.UUID]*cmdomain.CourseModule{}, Blocks: map[uuid.UUID][]contentdomain.ContentBlock{},
		Setups: map[uuid.UUID]json.RawMessage{}, BankSetup: map[uuid.UUID]json.RawMessage{},
		Exercises: map[uuid.UUID][]contentservice.ExerciseRecord{}, Versions_: map[uuid.UUID][]contentservice.VersionSummary{},
		Changed: map[uuid.UUID]bool{}, Fail: map[string]error{}, san: contentdomain.NewHTMLSanitizer(),
	}
}

// AddModule stores a module of the teacher.
func (f *Fake) AddModule(teacher uuid.UUID, title string) uuid.UUID {
	id := uuid.New()
	f.Modules[id] = &cmdomain.CourseModule{TeacherID: teacher, Title: title, Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	f.Modules[id].ID = id
	return id
}

// Called reports whether the method was called.
func (f *Fake) Called(method string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.Calls {
		if c == method {
			return true
		}
	}
	return false
}

// enter records the call and returns the injected failure, if any.
func (f *Fake) enter(method string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls = append(f.Calls, method)
	if err, ok := f.Fail[method]; ok {
		delete(f.Fail, method)
		return err
	}
	return nil
}

func (f *Fake) authorize(who contentservice.Actor, moduleID uuid.UUID) error {
	m, ok := f.Modules[moduleID]
	if !ok {
		return contentservice.ErrModuleNotFound
	}
	if who.Role == "ADMIN" || (who.Role == "TEACHER" && m.TeacherID == who.UserID) {
		return nil
	}
	return contentservice.ErrForbidden
}

// Allow implements the rate limiter.
func (f *Fake) Allow(string) (bool, time.Duration) {
	if f.Deny {
		return false, 7 * time.Second
	}
	return true, 0
}

// CreateModule implements Modules.
func (f *Fake) CreateModule(_ context.Context, in cmservice.CreateModuleInput) (cmdomain.CourseModule, error) {
	if err := f.enter("CreateModule"); err != nil {
		return cmdomain.CourseModule{}, err
	}
	m := cmdomain.CourseModule{TeacherID: in.TeacherID, Title: in.Title, Description: in.Description, Slug: in.Slug, Visibility: in.Visibility,
		Status: cmdomain.ModuleStatusActive, ActivationStart: in.ActivationStart, ActivationEnd: in.ActivationEnd}
	m.ID = uuid.New()
	f.Modules[m.ID] = &m
	return m, nil
}

// UpdateModule implements Modules.
func (f *Fake) UpdateModule(_ context.Context, in cmservice.UpdateModuleInput) (cmdomain.CourseModule, error) {
	if err := f.enter("UpdateModule"); err != nil {
		return cmdomain.CourseModule{}, err
	}
	m, ok := f.Modules[in.ModuleID]
	if !ok {
		return cmdomain.CourseModule{}, cmdomain.ErrModuleNotFound
	}
	if !in.IsAdmin && m.TeacherID != in.CallerID {
		return cmdomain.CourseModule{}, cmdomain.ErrForbidden
	}
	if in.Title != nil {
		m.Title = *in.Title
	}
	if in.Status != nil {
		m.Status = *in.Status
	}
	if in.Visibility != nil {
		m.Visibility = *in.Visibility
	}
	if in.Slug.Set {
		m.Slug = in.Slug.Value
	}
	if in.ActivationStart.Set {
		m.ActivationStart = in.ActivationStart.Value
	}
	return *m, nil
}

// GetModuleByID implements Modules.
func (f *Fake) GetModuleByID(_ context.Context, id uuid.UUID, _ cmservice.UserAccessContext) (cmrepository.ModuleDetails, error) {
	if err := f.enter("GetModuleByID"); err != nil {
		return cmrepository.ModuleDetails{}, err
	}
	m, ok := f.Modules[id]
	if !ok {
		return cmrepository.ModuleDetails{}, cmdomain.ErrModuleNotFound
	}
	return cmrepository.ModuleDetails{Module: *m}, nil
}

// ListModules implements Modules: an ADMIN sees all, a TEACHER the own ones.
func (f *Fake) ListModules(_ context.Context, u cmservice.UserAccessContext, filter cmrepository.ListFilter) (cmrepository.ListResult, error) {
	if err := f.enter("ListModules"); err != nil {
		return cmrepository.ListResult{}, err
	}
	res := cmrepository.ListResult{Page: filter.Page, Limit: filter.Limit}
	for _, m := range f.Modules {
		if u.IsAdmin || (u.UserID != nil && m.TeacherID == *u.UserID) {
			res.Items = append(res.Items, cmrepository.ModuleSummary{CourseModule: *m, TotalExercises: int64(len(f.Exercises[m.ID]))})
		}
	}
	res.TotalCount = int64(len(res.Items))
	return res, nil
}

// List implements Authoring.
func (f *Fake) List(_ context.Context, who contentservice.Actor, moduleID uuid.UUID) ([]contentdomain.ContentBlock, error) {
	if err := f.enter("Authoring.List"); err != nil {
		return nil, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return nil, err
	}
	return append([]contentdomain.ContentBlock(nil), f.Blocks[moduleID]...), nil
}

func (f *Fake) findBlock(who contentservice.Actor, id uuid.UUID) (uuid.UUID, int, error) {
	for mid, list := range f.Blocks {
		for i, b := range list {
			if b.ID == id {
				return mid, i, f.authorize(who, mid)
			}
		}
	}
	return uuid.Nil, 0, contentservice.ErrBlockNotFound
}

// Update implements Authoring.
func (f *Fake) Update(_ context.Context, who contentservice.Actor, id uuid.UUID, payload json.RawMessage, expected time.Time, force bool) (contentdomain.ContentBlock, error) {
	if err := f.enter("Authoring.Update"); err != nil {
		return contentdomain.ContentBlock{}, err
	}
	mid, i, err := f.findBlock(who, id)
	if err != nil {
		return contentdomain.ContentBlock{}, err
	}
	b := f.Blocks[mid][i]
	clean, err := contentdomain.NormalizePayload(b.BlockType, payload, f.san)
	if err != nil {
		return contentdomain.ContentBlock{}, err
	}
	if !force && !expected.Equal(b.UpdatedAt) {
		return contentdomain.ContentBlock{}, contentservice.ErrBlockConflict
	}
	b.Payload, b.UpdatedAt = clean, b.UpdatedAt.Add(time.Second)
	f.Blocks[mid][i] = b
	return b, nil
}

// Delete implements Authoring.
func (f *Fake) Delete(_ context.Context, who contentservice.Actor, id uuid.UUID) error {
	if err := f.enter("Authoring.Delete"); err != nil {
		return err
	}
	mid, i, err := f.findBlock(who, id)
	if err != nil {
		return err
	}
	f.Blocks[mid] = append(f.Blocks[mid][:i:i], f.Blocks[mid][i+1:]...)
	return nil
}

// SetActive implements Authoring.
func (f *Fake) SetActive(_ context.Context, who contentservice.Actor, id uuid.UUID, active bool) (contentdomain.ContentBlock, error) {
	if err := f.enter("Authoring.SetActive"); err != nil {
		return contentdomain.ContentBlock{}, err
	}
	mid, i, err := f.findBlock(who, id)
	if err != nil {
		return contentdomain.ContentBlock{}, err
	}
	b := f.Blocks[mid][i]
	b.InactiveAt = nil
	if !active {
		now := time.Now()
		b.InactiveAt = &now
	}
	f.Blocks[mid][i] = b
	return b, nil
}

// Setup implements Authoring.
func (f *Fake) Setup(_ context.Context, who contentservice.Actor, moduleID uuid.UUID) (json.RawMessage, error) {
	if err := f.enter("Authoring.Setup"); err != nil {
		return nil, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return nil, err
	}
	return f.Setups[moduleID], nil
}

// SetSetup implements Authoring.
func (f *Fake) SetSetup(_ context.Context, who contentservice.Actor, moduleID uuid.UUID, raw json.RawMessage) (json.RawMessage, error) {
	if err := f.enter("Authoring.SetSetup"); err != nil {
		return nil, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return nil, err
	}
	clean, err := contentdomain.NormalizeSetup(raw)
	if err != nil {
		return nil, err
	}
	f.Setups[moduleID] = clean
	return clean, nil
}

// SaveCard implements Authoring all or nothing, with the field names of the real service.
func (f *Fake) SaveCard(_ context.Context, who contentservice.Actor, moduleID uuid.UUID, in contentservice.SaveCardInput) ([]contentdomain.ContentBlock, error) {
	if err := f.enter("Authoring.SaveCard"); err != nil {
		return nil, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return nil, err
	}
	var problems []contentdomain.FieldError
	cleaned := make([]json.RawMessage, len(in.Blocks))
	for i, b := range in.Blocks {
		clean, err := contentdomain.NormalizePayload(b.Type, b.Payload, f.san)
		if pe, ok := err.(*contentdomain.PayloadError); ok {
			for _, fe := range pe.Fields {
				problems = append(problems, contentdomain.FieldError{Field: fmt.Sprintf("blocks[%d].%s", i, fe.Field), Reason: fe.Reason})
			}
			continue
		}
		cleaned[i] = clean
	}
	if len(problems) > 0 {
		return nil, &contentdomain.PayloadError{Fields: problems}
	}
	replacing := map[uuid.UUID]bool{}
	for _, id := range in.ReplaceIDs {
		replacing[id] = true
	}
	var kept []contentdomain.ContentBlock
	for _, b := range f.Blocks[moduleID] {
		if !replacing[b.ID] {
			kept = append(kept, b)
		}
	}
	if len(in.ReplaceIDs) == 0 && in.AfterID != nil {
		found := false
		for _, b := range kept {
			found = found || b.ID == *in.AfterID
		}
		if !found {
			return nil, contentservice.ErrBlockNotFound
		}
	}
	for i, b := range in.Blocks {
		kept = append(kept, contentdomain.ContentBlock{ID: uuid.New(), ModuleID: moduleID, BlockType: b.Type, Payload: cleaned[i], UpdatedAt: time.Now()})
	}
	for i := range kept {
		kept[i].Position = i + 1
	}
	f.Blocks[moduleID] = kept
	return append([]contentdomain.ContentBlock(nil), kept...), nil
}

// ExList is Exercises.List (the Exercises adapter calls it).
func (f *Fake) ExList(_ context.Context, who contentservice.Actor, moduleID uuid.UUID) (contentservice.ExerciseBank, error) {
	if err := f.enter("Exercises.List"); err != nil {
		return contentservice.ExerciseBank{}, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return contentservice.ExerciseBank{}, err
	}
	return contentservice.ExerciseBank{Items: append([]contentservice.ExerciseRecord(nil), f.Exercises[moduleID]...), BankSetup: f.BankSetup[moduleID]}, nil
}

func (f *Fake) findExercise(moduleID, id uuid.UUID) (int, error) {
	for i, e := range f.Exercises[moduleID] {
		if e.ID == id {
			return i, nil
		}
	}
	return 0, contentservice.ErrExerciseNotFound
}

// ExGet implements Exercises.Get.
func (f *Fake) ExGet(_ context.Context, who contentservice.Actor, moduleID, id uuid.UUID) (contentservice.ExerciseRecord, error) {
	if err := f.enter("Exercises.Get"); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	i, err := f.findExercise(moduleID, id)
	if err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	return f.Exercises[moduleID][i], nil
}

// ExCreate implements Exercises.Create.
func (f *Fake) ExCreate(_ context.Context, who contentservice.Actor, moduleID uuid.UUID, in contentdomain.ExerciseInput, dependsOn *uuid.UUID, links contentservice.ExerciseLinks) (contentservice.ExerciseRecord, error) {
	if err := f.enter("Exercises.Create"); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	if !links.Valid() {
		return contentservice.ExerciseRecord{}, contentservice.ErrInvalidLinks
	}
	clean, err := contentdomain.NormalizeExercise(in, f.san)
	if err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	rec := contentservice.ExerciseRecord{Question: contentdomain.Question{
		ID: uuid.New(), ModuleID: moduleID, Kind: clean.Kind, Usage: links.Usage(), InAssessment: links.Assessment,
		ExclusiveAssessment: links.Exclusive, Difficulty: clean.Difficulty, Status: contentdomain.StatusDraft, Title: clean.Title,
		Statement: clean.Statement, Hints: clean.Hints, ReferenceSolution: clean.Solution, EndConditions: clean.EndConditions, DependsOn: dependsOn, UpdatedAt: time.Now(),
		AnswerKey: clean.AnswerKey, Explanation: clean.Explanation,
	}}
	f.Exercises[moduleID] = append(f.Exercises[moduleID], rec)
	return rec, nil
}

// ExUpdate implements Exercises.Update.
func (f *Fake) ExUpdate(_ context.Context, who contentservice.Actor, moduleID, id uuid.UUID, in contentdomain.ExerciseInput, dependsOn *uuid.UUID, expected time.Time, force bool) (contentservice.ExerciseRecord, error) {
	if err := f.enter("Exercises.Update"); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	clean, err := contentdomain.NormalizeExercise(in, f.san)
	if err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	i, err := f.findExercise(moduleID, id)
	if err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	rec := f.Exercises[moduleID][i]
	if !force && !expected.Equal(rec.UpdatedAt) {
		return contentservice.ExerciseRecord{}, contentservice.ErrExerciseConflict
	}
	rec.Title, rec.Difficulty, rec.Statement, rec.Hints = clean.Title, clean.Difficulty, clean.Statement, clean.Hints
	rec.ReferenceSolution, rec.EndConditions, rec.DependsOn = clean.Solution, clean.EndConditions, dependsOn
	rec.AnswerKey, rec.Explanation = clean.AnswerKey, clean.Explanation
	f.Exercises[moduleID][i] = rec
	return rec, nil
}

// ExSetLinks implements Exercises.SetLinks.
func (f *Fake) ExSetLinks(_ context.Context, who contentservice.Actor, moduleID, id uuid.UUID, links contentservice.ExerciseLinks, status string) (contentservice.ExerciseRecord, error) {
	if err := f.enter("Exercises.SetLinks"); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	if !links.Valid() {
		return contentservice.ExerciseRecord{}, contentservice.ErrInvalidLinks
	}
	i, err := f.findExercise(moduleID, id)
	if err != nil {
		return contentservice.ExerciseRecord{}, err
	}
	rec := f.Exercises[moduleID][i]
	rec.Usage, rec.InAssessment, rec.ExclusiveAssessment, rec.Status = links.Usage(), links.Assessment, links.Exclusive, status
	f.Exercises[moduleID][i] = rec
	return rec, nil
}

// ExDelete implements Exercises.Delete.
func (f *Fake) ExDelete(_ context.Context, who contentservice.Actor, moduleID, id uuid.UUID) error {
	if err := f.enter("Exercises.Delete"); err != nil {
		return err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return err
	}
	i, err := f.findExercise(moduleID, id)
	if err != nil {
		return err
	}
	f.Exercises[moduleID] = append(f.Exercises[moduleID][:i:i], f.Exercises[moduleID][i+1:]...)
	return nil
}

// ExReorder implements Exercises.Reorder.
func (f *Fake) ExReorder(_ context.Context, who contentservice.Actor, moduleID uuid.UUID, items []contentservice.OrderItem) error {
	if err := f.enter("Exercises.Reorder"); err != nil {
		return err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return err
	}
	for pos, it := range items {
		i, err := f.findExercise(moduleID, it.ExerciseID)
		if err != nil {
			return contentservice.ErrInvalidExerciseOrder
		}
		f.Exercises[moduleID][i].Position, f.Exercises[moduleID][i].Mandatory = pos+1, it.Mandatory
	}
	return nil
}

// ExSetBankSetup implements Exercises.SetBankSetup.
func (f *Fake) ExSetBankSetup(_ context.Context, who contentservice.Actor, moduleID uuid.UUID, raw json.RawMessage) (json.RawMessage, error) {
	if err := f.enter("Exercises.SetBankSetup"); err != nil {
		return nil, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return nil, err
	}
	var clean json.RawMessage
	if len(raw) > 0 && string(raw) != "null" {
		var err error
		if clean, err = contentdomain.NormalizeSetup(raw); err != nil {
			if pe, ok := err.(*contentdomain.PayloadError); ok {
				for i := range pe.Fields {
					pe.Fields[i].Field = "bankSetup" + pe.Fields[i].Field[len("setup"):]
				}
			}
			return nil, err
		}
	}
	f.BankSetup[moduleID] = clean
	return clean, nil
}

// VList implements Versions.List.
func (f *Fake) VList(_ context.Context, who contentservice.Actor, moduleID uuid.UUID) (contentservice.VersionList, error) {
	if err := f.enter("Versions.List"); err != nil {
		return contentservice.VersionList{}, err
	}
	if err := f.authorize(who, moduleID); err != nil {
		return contentservice.VersionList{}, err
	}
	return contentservice.VersionList{Versions: f.Versions_[moduleID], HasUnpublishedChanges: f.Changed[moduleID]}, nil
}

// Exercises adapts the fake to the Exercises interface of the service package.
type Exercises struct{ F *Fake }

// List implements the interface.
func (e Exercises) List(ctx context.Context, who contentservice.Actor, m uuid.UUID) (contentservice.ExerciseBank, error) {
	return e.F.ExList(ctx, who, m)
}

// Get implements the interface.
func (e Exercises) Get(ctx context.Context, who contentservice.Actor, m, id uuid.UUID) (contentservice.ExerciseRecord, error) {
	return e.F.ExGet(ctx, who, m, id)
}

// Create implements the interface.
func (e Exercises) Create(ctx context.Context, who contentservice.Actor, m uuid.UUID, in contentdomain.ExerciseInput, d *uuid.UUID, l contentservice.ExerciseLinks) (contentservice.ExerciseRecord, error) {
	return e.F.ExCreate(ctx, who, m, in, d, l)
}

// Update implements the interface.
func (e Exercises) Update(ctx context.Context, who contentservice.Actor, m, id uuid.UUID, in contentdomain.ExerciseInput, d *uuid.UUID, exp time.Time, force bool) (contentservice.ExerciseRecord, error) {
	return e.F.ExUpdate(ctx, who, m, id, in, d, exp, force)
}

// SetLinks implements the interface.
func (e Exercises) SetLinks(ctx context.Context, who contentservice.Actor, m, id uuid.UUID, l contentservice.ExerciseLinks, status string) (contentservice.ExerciseRecord, error) {
	return e.F.ExSetLinks(ctx, who, m, id, l, status)
}

// Delete implements the interface.
func (e Exercises) Delete(ctx context.Context, who contentservice.Actor, m, id uuid.UUID) error {
	return e.F.ExDelete(ctx, who, m, id)
}

// Reorder implements the interface.
func (e Exercises) Reorder(ctx context.Context, who contentservice.Actor, m uuid.UUID, items []contentservice.OrderItem) error {
	return e.F.ExReorder(ctx, who, m, items)
}

// SetBankSetup implements the interface.
func (e Exercises) SetBankSetup(ctx context.Context, who contentservice.Actor, m uuid.UUID, raw json.RawMessage) (json.RawMessage, error) {
	return e.F.ExSetBankSetup(ctx, who, m, raw)
}

// Versions adapts the fake to the Versions interface of the service package.
type Versions struct{ F *Fake }

// List implements the interface.
func (v Versions) List(ctx context.Context, who contentservice.Actor, m uuid.UUID) (contentservice.VersionList, error) {
	return v.F.VList(ctx, who, m)
}
