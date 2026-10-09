// Package service loads the content manifest into the database (SPEC-011).
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
)

// ErrNotFound must be returned by the store for missing records.
var ErrNotFound = errors.New("content record not found")

// ErrAdminMissing means the configured admin account does not exist (RN-05).
var ErrAdminMissing = errors.New("the admin account configured in ADMIN_EMAIL does not exist; start the API once to create it")

// Modules is the public seed interface of the coursemodule module.
type Modules interface {
	UpsertModule(ctx context.Context, in cmservice.SeedModuleInput) (uuid.UUID, cmservice.SeedOutcome, error)
	EnsureExercise(ctx context.Context, moduleID, questionID uuid.UUID) (bool, error)
}

// Users finds the owner of the seeded modules.
type Users interface {
	FindByEmail(ctx context.Context, email string) (userdomain.User, error)
}

// Store persists content entities. Finders include soft-deleted rows.
type Store interface {
	FindBlockBySourceKey(ctx context.Context, key string) (domain.ContentBlock, error)
	SaveBlock(ctx context.Context, b *domain.ContentBlock) error
	// HasEditedBlocks reports whether the authoring touched any block of the module.
	HasEditedBlocks(ctx context.Context, moduleID uuid.UUID) (bool, error)
	FindScenarioBySourceKey(ctx context.Context, key string) (domain.Scenario, error)
	SaveScenario(ctx context.Context, s *domain.Scenario) error
	FindQuestionBySourceKey(ctx context.Context, key string) (domain.Question, error)
	SaveQuestion(ctx context.Context, q *domain.Question) error
	FindTemplateBySourceKey(ctx context.Context, key string) (domain.AssessmentTemplate, error)
	SaveTemplate(ctx context.Context, t *domain.AssessmentTemplate) error
	ReplaceTemplateQuestions(ctx context.Context, templateID uuid.UUID, items []domain.TemplateQuestion) error
}

// TxRunner runs a function inside a database transaction.
type TxRunner interface {
	WithinTransaction(ctx context.Context, fn func(ctx context.Context) error) error
}

// Counts tallies what the seed did with one entity type.
type Counts struct {
	Inserted  int
	Updated   int
	Preserved int
}

// Report summarizes a seed run (RN-09).
type Report struct {
	Modules         Counts
	Blocks          Counts
	Scenarios       Counts
	Questions       Counts
	Templates       Counts
	ExercisesLinked int
}

// Seeder loads the manifest idempotently, in one transaction (RN-04).
type Seeder struct {
	modules   Modules
	users     Users
	store     Store
	tx        TxRunner
	sanitizer *domain.HTMLSanitizer
	log       *zap.Logger
	now       func() time.Time
}

// NewSeeder creates the seeder.
func NewSeeder(modules Modules, users Users, store Store, tx TxRunner, log *zap.Logger) *Seeder {
	return &Seeder{modules: modules, users: users, store: store, tx: tx, sanitizer: domain.NewHTMLSanitizer(), log: log, now: time.Now}
}

// Run loads the manifest. Nothing is written if any step fails (CA-08).
func (s *Seeder) Run(ctx context.Context, m Manifest, adminEmail string) (Report, error) {
	var report Report
	err := s.tx.WithinTransaction(ctx, func(ctx context.Context) error {
		admin, err := s.users.FindByEmail(ctx, adminEmail)
		if errors.Is(err, userdomain.ErrNotFound) {
			return ErrAdminMissing
		}
		if err != nil {
			return err
		}

		moduleIDs := map[string]uuid.UUID{}
		for _, mod := range m.Modules {
			slug := mod.Slug
			if slug == "" {
				slug = mod.SourceKey
			}
			id, outcome, err := s.modules.UpsertModule(ctx, cmservice.SeedModuleInput{
				SourceKey: mod.SourceKey, Slug: slug, OwnerID: admin.ID, Title: mod.Title, Description: mod.Description,
				Icon: mod.Icon, Color: mod.Color, DisplayOrder: mod.DisplayOrder, Visibility: cmdomain.Visibility(mod.Visibility),
			})
			if err != nil {
				return err
			}
			moduleIDs[mod.SourceKey] = id
			report.Modules.add(outcome)
			// A module whose blocks were edited belongs to its authors now: loading new blocks or moving
			// the old ones would collide with the order they made (SPEC-011 RN-04a).
			frozen, err := s.store.HasEditedBlocks(ctx, id)
			if err != nil {
				return err
			}
			for i, b := range mod.Blocks {
				if frozen {
					report.Blocks.add(cmservice.SeedPreserved)
					continue
				}
				outcome, err := s.upsertBlock(ctx, id, i+1, b)
				if err != nil {
					return err
				}
				report.Blocks.add(outcome)
			}
		}

		scenarioIDs := map[string]uuid.UUID{}
		// Base scenarios first, so derived ones can reference them.
		for _, pass := range []bool{true, false} {
			for _, sc := range m.Scenarios {
				if (sc.BaseSourceKey == "") != pass {
					continue
				}
				id, outcome, err := s.upsertScenario(ctx, sc, scenarioIDs)
				if err != nil {
					return err
				}
				scenarioIDs[sc.SourceKey] = id
				report.Scenarios.add(outcome)
			}
		}

		questionIDs := map[string]uuid.UUID{}
		for _, q := range m.Questions {
			id, outcome, err := s.upsertQuestion(ctx, q, moduleIDs, scenarioIDs)
			if err != nil {
				return err
			}
			questionIDs[q.SourceKey] = id
			report.Questions.add(outcome)
			if q.Usage == domain.UsageExercise {
				linked, err := s.modules.EnsureExercise(ctx, moduleIDs[q.ModuleSourceKey], id)
				if err != nil {
					return err
				}
				if linked {
					report.ExercisesLinked++
				}
			}
		}

		for _, t := range m.AssessmentTemplates {
			outcome, err := s.upsertTemplate(ctx, t, questionIDs)
			if err != nil {
				return err
			}
			report.Templates.add(outcome)
		}
		return nil
	})
	if err != nil {
		return Report{}, err
	}
	s.log.Info("content seed finished",
		zap.String("content_hash", m.ContentHash),
		zap.Any("modules", report.Modules), zap.Any("blocks", report.Blocks), zap.Any("scenarios", report.Scenarios),
		zap.Any("questions", report.Questions), zap.Any("templates", report.Templates),
		zap.Int("exercises_linked", report.ExercisesLinked))
	return report, nil
}

func (c *Counts) add(o cmservice.SeedOutcome) {
	switch o {
	case cmservice.SeedInserted:
		c.Inserted++
	case cmservice.SeedUpdated:
		c.Updated++
	case cmservice.SeedPreserved:
		c.Preserved++
	}
}

func newID() (uuid.UUID, error) { return uuid.NewV7() }

func (s *Seeder) upsertBlock(ctx context.Context, moduleID uuid.UUID, position int, b ManifestBlock) (cmservice.SeedOutcome, error) {
	if !domain.ValidBlockType(b.Type) {
		return "", fmt.Errorf("block %s: unknown type %q", b.SourceKey, b.Type)
	}
	payload, err := s.sanitizePayload(b.Payload)
	if err != nil {
		return "", fmt.Errorf("block %s: %w", b.SourceKey, err)
	}
	existing, err := s.store.FindBlockBySourceKey(ctx, b.SourceKey)
	outcome := cmservice.SeedUpdated
	switch {
	case errors.Is(err, ErrNotFound):
		id, err := newID()
		if err != nil {
			return "", err
		}
		key := b.SourceKey
		existing = domain.ContentBlock{ID: id, SourceKey: &key}
		outcome = cmservice.SeedInserted
	case err != nil:
		return "", err
	case existing.EditedByTeacherAt != nil:
		return cmservice.SeedPreserved, nil
	}
	existing.ModuleID = moduleID
	existing.BlockType = b.Type
	existing.Position = position
	existing.Payload = payload
	if err := s.store.SaveBlock(ctx, &existing); err != nil {
		return "", fmt.Errorf("save block %s: %w", b.SourceKey, err)
	}
	return outcome, nil
}

// sanitizePayload filters the "html" member of a block payload (RN-08).
func (s *Seeder) sanitizePayload(raw json.RawMessage) (json.RawMessage, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("invalid payload: %w", err)
	}
	if html, ok := payload["html"].(string); ok {
		payload["html"] = s.sanitizer.Sanitize(html)
	}
	return json.Marshal(payload)
}

func (s *Seeder) upsertScenario(ctx context.Context, sc ManifestScenario, ids map[string]uuid.UUID) (uuid.UUID, cmservice.SeedOutcome, error) {
	var machine domain.Machine
	if err := json.Unmarshal(sc.Snapshot, &machine); err != nil || machine.Format != domain.MachineFormat {
		return uuid.Nil, "", fmt.Errorf("scenario %s: invalid machine snapshot", sc.SourceKey)
	}
	var base *uuid.UUID
	if sc.BaseSourceKey != "" {
		id, ok := ids[sc.BaseSourceKey]
		if !ok {
			return uuid.Nil, "", fmt.Errorf("scenario %s: unknown base %s", sc.SourceKey, sc.BaseSourceKey)
		}
		base = &id
	}
	existing, err := s.store.FindScenarioBySourceKey(ctx, sc.SourceKey)
	outcome := cmservice.SeedUpdated
	switch {
	case errors.Is(err, ErrNotFound):
		id, err := newID()
		if err != nil {
			return uuid.Nil, "", err
		}
		key := sc.SourceKey
		existing = domain.Scenario{ID: id, SourceKey: &key}
		outcome = cmservice.SeedInserted
	case err != nil:
		return uuid.Nil, "", err
	}
	existing.BaseScenarioID = base
	existing.Snapshot = sc.Snapshot
	existing.FormatVersion = machine.Version
	if err := s.store.SaveScenario(ctx, &existing); err != nil {
		return uuid.Nil, "", fmt.Errorf("save scenario %s: %w", sc.SourceKey, err)
	}
	return existing.ID, outcome, nil
}

func (s *Seeder) upsertQuestion(ctx context.Context, q ManifestQuestion, modules, scenarios map[string]uuid.UUID) (uuid.UUID, cmservice.SeedOutcome, error) {
	moduleID, ok := modules[q.ModuleSourceKey]
	if !ok {
		return uuid.Nil, "", fmt.Errorf("question %s: unknown module %s", q.SourceKey, q.ModuleSourceKey)
	}
	existing, err := s.store.FindQuestionBySourceKey(ctx, q.SourceKey)
	outcome := cmservice.SeedUpdated
	switch {
	case errors.Is(err, ErrNotFound):
		id, err := newID()
		if err != nil {
			return uuid.Nil, "", err
		}
		key := q.SourceKey
		existing = domain.Question{ID: id, SourceKey: &key}
		outcome = cmservice.SeedInserted
	case err != nil:
		return uuid.Nil, "", err
	case existing.EditedByTeacherAt != nil || existing.DeletedAt.Valid:
		return existing.ID, cmservice.SeedPreserved, nil
	}

	existing.ModuleID = moduleID
	existing.Kind = q.Kind
	existing.Usage = q.Usage
	existing.Difficulty = q.Difficulty
	existing.Status = q.Status
	existing.Title = q.Title
	existing.Statement = s.sanitizer.Sanitize(q.Statement)
	existing.Hint = optional(s.sanitizer.Sanitize(q.Hint))
	existing.Explanation = optional(s.sanitizer.Sanitize(q.Explanation))
	existing.ScenarioID = nil
	if q.ScenarioSourceKey != "" {
		id, ok := scenarios[q.ScenarioSourceKey]
		if !ok {
			return uuid.Nil, "", fmt.Errorf("question %s: unknown scenario %s", q.SourceKey, q.ScenarioSourceKey)
		}
		existing.ScenarioID = &id
	}
	existing.ReferenceSolution = rawOrNil(q.ReferenceSolution)
	existing.ValidationConditions = nil
	if q.Kind == domain.KindPractical {
		// Published questions must be gradable. A draft may still lack
		// conditions; it is stored with an empty list, which never passes.
		if q.Status == domain.StatusPublished {
			if err := domain.ValidateConditions(q.ValidationConditions); err != nil {
				return uuid.Nil, "", fmt.Errorf("question %s: %w", q.SourceKey, err)
			}
		}
		conditions := q.ValidationConditions
		if conditions == nil {
			conditions = []domain.Condition{}
		}
		if existing.ValidationConditions, err = json.Marshal(conditions); err != nil {
			return uuid.Nil, "", err
		}
	}
	existing.Choices = nil
	if len(q.Choices) > 0 {
		choices := make([]string, len(q.Choices))
		for i, c := range q.Choices {
			choices[i] = s.sanitizer.Sanitize(c)
		}
		if existing.Choices, err = json.Marshal(choices); err != nil {
			return uuid.Nil, "", err
		}
	}
	existing.AnswerKey = rawOrNil(q.AnswerKey)
	existing.Tags = nil
	if len(q.Tags) > 0 {
		if existing.Tags, err = json.Marshal(q.Tags); err != nil {
			return uuid.Nil, "", err
		}
	}
	if err := s.store.SaveQuestion(ctx, &existing); err != nil {
		return uuid.Nil, "", fmt.Errorf("save question %s: %w", q.SourceKey, err)
	}
	return existing.ID, outcome, nil
}

func (s *Seeder) upsertTemplate(ctx context.Context, t ManifestTemplate, questions map[string]uuid.UUID) (cmservice.SeedOutcome, error) {
	existing, err := s.store.FindTemplateBySourceKey(ctx, t.SourceKey)
	outcome := cmservice.SeedUpdated
	switch {
	case errors.Is(err, ErrNotFound):
		id, err := newID()
		if err != nil {
			return "", err
		}
		key := t.SourceKey
		existing = domain.AssessmentTemplate{ID: id, SourceKey: &key}
		outcome = cmservice.SeedInserted
	case err != nil:
		return "", err
	case existing.EditedByTeacherAt != nil || existing.DeletedAt.Valid:
		return cmservice.SeedPreserved, nil
	}
	existing.Title = t.Title
	existing.Description = t.Description
	existing.DurationMinutes = t.DurationMinutes
	existing.MaxScore = t.MaxScore
	existing.Status = domain.TemplateActive
	if err := s.store.SaveTemplate(ctx, &existing); err != nil {
		return "", fmt.Errorf("save template %s: %w", t.SourceKey, err)
	}
	items := make([]domain.TemplateQuestion, 0, len(t.Questions))
	for _, tq := range t.Questions {
		qid, ok := questions[tq.QuestionSourceKey]
		if !ok {
			return "", fmt.Errorf("template %s: unknown question %s", t.SourceKey, tq.QuestionSourceKey)
		}
		id, err := newID()
		if err != nil {
			return "", err
		}
		items = append(items, domain.TemplateQuestion{ID: id, TemplateID: existing.ID, QuestionID: qid, Position: tq.Position, Weight: tq.Weight})
	}
	if err := s.store.ReplaceTemplateQuestions(ctx, existing.ID, items); err != nil {
		return "", fmt.Errorf("save template %s questions: %w", t.SourceKey, err)
	}
	return outcome, nil
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func rawOrNil(r json.RawMessage) json.RawMessage {
	if len(r) == 0 || string(r) == "null" {
		return nil
	}
	return r
}
