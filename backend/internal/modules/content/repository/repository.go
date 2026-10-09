// Package repository persists content entities with GORM (SPEC-011).
package repository

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Repository implements service.Store.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository {
	return &Repository{db: db}
}

func notFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return service.ErrNotFound
	}
	return err
}

// FindBlockBySourceKey returns the block with the given source key.
func (r *Repository) FindBlockBySourceKey(ctx context.Context, key string) (domain.ContentBlock, error) {
	var b domain.ContentBlock
	err := r.db.Conn(ctx).Where("source_key = ?", key).First(&b).Error
	return b, notFound(err)
}

// SaveBlock inserts or updates a block.
func (r *Repository) SaveBlock(ctx context.Context, b *domain.ContentBlock) error {
	return r.db.Conn(ctx).Save(b).Error
}

// FindScenarioBySourceKey returns the scenario with the given source key.
func (r *Repository) FindScenarioBySourceKey(ctx context.Context, key string) (domain.Scenario, error) {
	var s domain.Scenario
	err := r.db.Conn(ctx).Where("source_key = ?", key).First(&s).Error
	return s, notFound(err)
}

// SaveScenario inserts or updates a scenario.
func (r *Repository) SaveScenario(ctx context.Context, s *domain.Scenario) error {
	return r.db.Conn(ctx).Save(s).Error
}

// FindQuestionBySourceKey returns the question, including soft-deleted ones.
func (r *Repository) FindQuestionBySourceKey(ctx context.Context, key string) (domain.Question, error) {
	var q domain.Question
	err := r.db.Conn(ctx).Unscoped().Where("source_key = ?", key).First(&q).Error
	return q, notFound(err)
}

// SaveQuestion inserts or updates a question.
func (r *Repository) SaveQuestion(ctx context.Context, q *domain.Question) error {
	return r.db.Conn(ctx).Save(q).Error
}

// FindTemplateBySourceKey returns the template, including soft-deleted ones.
func (r *Repository) FindTemplateBySourceKey(ctx context.Context, key string) (domain.AssessmentTemplate, error) {
	var t domain.AssessmentTemplate
	err := r.db.Conn(ctx).Unscoped().Where("source_key = ?", key).First(&t).Error
	return t, notFound(err)
}

// SaveTemplate inserts or updates a template.
func (r *Repository) SaveTemplate(ctx context.Context, t *domain.AssessmentTemplate) error {
	return r.db.Conn(ctx).Save(t).Error
}

// ReplaceTemplateQuestions sets the fixed question list of a template.
func (r *Repository) ReplaceTemplateQuestions(ctx context.Context, templateID uuid.UUID, items []domain.TemplateQuestion) error {
	conn := r.db.Conn(ctx)
	if err := conn.Where("template_id = ?", templateID).Delete(&domain.TemplateQuestion{}).Error; err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}
	return conn.Create(&items).Error
}

// ListBlocks returns the blocks of a module ordered by position.
func (r *Repository) ListBlocks(ctx context.Context, moduleID uuid.UUID) ([]domain.ContentBlock, error) {
	var blocks []domain.ContentBlock
	err := r.db.Conn(ctx).Where("module_id = ?", moduleID).Order("position").Find(&blocks).Error
	return blocks, err
}

// ListQuestions returns the questions of a module, optionally filtered by
// usage; drafts and archived questions only when includeDrafts is true.
func (r *Repository) ListQuestions(ctx context.Context, moduleID uuid.UUID, usage string, includeDrafts bool) ([]domain.Question, error) {
	q := r.db.Conn(ctx).Where("module_id = ?", moduleID)
	if usage != "" {
		q = q.Where("usage = ?", usage)
	}
	if !includeDrafts {
		q = q.Where("status = ?", domain.StatusPublished)
	}
	var out []domain.Question
	err := q.Order("created_at, id").Find(&out).Error
	return out, err
}

// ListActiveTemplates returns active templates with their question counts.
func (r *Repository) ListActiveTemplates(ctx context.Context) ([]service.TemplateSummary, error) {
	var out []service.TemplateSummary
	err := r.db.Conn(ctx).Table("assessment_templates AS t").
		Select("t.id, t.title, t.description, t.duration_minutes, "+
			"(SELECT COUNT(*) FROM assessment_template_questions q WHERE q.template_id = t.id) AS question_count").
		Where("t.status = ? AND t.deleted_at IS NULL", domain.TemplateActive).
		Order("t.created_at, t.id").
		Scan(&out).Error
	return out, err
}

// FindQuestion returns a question that is not deleted.
func (r *Repository) FindQuestion(ctx context.Context, id uuid.UUID) (domain.Question, error) {
	var q domain.Question
	err := r.db.Conn(ctx).Where("id = ?", id).First(&q).Error
	return q, notFound(err)
}

// FindScenario returns a scenario by ID.
func (r *Repository) FindScenario(ctx context.Context, id uuid.UUID) (domain.Scenario, error) {
	var s domain.Scenario
	err := r.db.Conn(ctx).Where("id = ?", id).First(&s).Error
	return s, notFound(err)
}
