// Package repository persists content entities with GORM (SPEC-011).
package repository

import (
	"context"
	"errors"
	"time"

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

// HasEditedBlocks reports whether any block of the module was marked as edited by the authoring.
func (r *Repository) HasEditedBlocks(ctx context.Context, moduleID uuid.UUID) (bool, error) {
	var found bool
	err := r.db.Conn(ctx).Raw("SELECT EXISTS (SELECT 1 FROM content_blocks WHERE module_id = ? AND edited_by_teacher_at IS NOT NULL)", moduleID).Scan(&found).Error
	return found, err
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
	err := r.named(ctx).Where("content_blocks.module_id = ?", moduleID).Order("content_blocks.position").Find(&blocks).Error
	return blocks, err
}

// named starts a query of blocks that also reads the names of who created and last changed each one.
func (r *Repository) named(ctx context.Context) *gorm.DB {
	return r.db.Conn(ctx).Model(&domain.ContentBlock{}).
		Select(`content_blocks.*, COALESCE(NULLIF(cu.name, ''), cu.email, '') AS created_by_name, COALESCE(NULLIF(uu.name, ''), uu.email, '') AS updated_by_name`).
		Joins("LEFT JOIN users cu ON cu.id = content_blocks.created_by").
		Joins("LEFT JOIN users uu ON uu.id = content_blocks.updated_by")
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
	// The exercises of the trail come in the order the teacher gave it (SPEC-023), then the others.
	err := q.Order("COALESCE((SELECT i.sequence_order FROM module_exercise_items i WHERE i.exercise_id = questions.id AND i.module_id = questions.module_id), 1000000), created_at, id").Find(&out).Error
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

// SaveBlockProgress marks or unmarks a content block as read for a user.
func (r *Repository) SaveBlockProgress(ctx context.Context, userID, blockID uuid.UUID, completed bool) (domain.BlockProgress, error) {
	conn := r.db.Conn(ctx)
	if !completed {
		err := conn.Where("user_id = ? AND block_id = ?", userID, blockID).Delete(&domain.BlockProgress{}).Error
		return domain.BlockProgress{}, err
	}
	now := time.Now()
	var p domain.BlockProgress
	err := conn.Where("user_id = ? AND block_id = ?", userID, blockID).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		id, err := uuid.NewV7()
		if err != nil {
			return domain.BlockProgress{}, err
		}
		p = domain.BlockProgress{
			ID: id, UserID: userID, BlockID: blockID, CompletedAt: now, CreatedAt: now, UpdatedAt: now,
		}
		err = conn.Create(&p).Error
		return p, err
	}
	if err != nil {
		return domain.BlockProgress{}, err
	}
	p.CompletedAt = now
	p.UpdatedAt = now
	err = conn.Save(&p).Error
	return p, err
}

// ListModuleBlockProgress returns all completed block progress records for a user in a module.
func (r *Repository) ListModuleBlockProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.BlockProgress, error) {
	var list []domain.BlockProgress
	err := r.db.Conn(ctx).Table("block_progress AS bp").
		Select("bp.*").
		Joins("JOIN content_blocks AS cb ON cb.id = bp.block_id").
		Where("bp.user_id = ? AND cb.module_id = ?", userID, moduleID).
		Find(&list).Error
	return list, err
}

