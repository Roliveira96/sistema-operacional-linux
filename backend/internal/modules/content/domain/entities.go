package domain

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// BlockType is a type of the closed block catalog (SPEC-011).
type BlockType string

// Block types.
const (
	BlockText       BlockType = "TEXT"
	BlockCommand    BlockType = "COMMAND"
	BlockTip        BlockType = "TIP"
	BlockCuriosity  BlockType = "CURIOSITY"
	BlockStepByStep BlockType = "STEP_BY_STEP"
	BlockCards      BlockType = "CARDS"
	BlockWidget     BlockType = "WIDGET"
	BlockLegacyHTML BlockType = "LEGACY_HTML"
	// BlockExercises is the group of exercises of a card (SPEC-022).
	BlockExercises BlockType = "EXERCISES"
)

// ValidBlockType reports whether t belongs to the catalog.
func ValidBlockType(t BlockType) bool {
	switch t {
	case BlockText, BlockCommand, BlockTip, BlockCuriosity, BlockStepByStep, BlockCards, BlockWidget, BlockLegacyHTML, BlockExercises:
		return true
	}
	return false
}

// Question enums.
const (
	KindPractical           = "PRACTICAL"
	KindTheoreticalSingle   = "THEORETICAL_SINGLE"
	KindTheoreticalMultiple = "THEORETICAL_MULTIPLE"
	KindTheoreticalBoolean  = "THEORETICAL_BOOLEAN"
	KindDiscursive          = "DISCURSIVE"

	UsageExercise   = "EXERCISE"
	UsageAssessment = "ASSESSMENT"

	StatusDraft     = "DRAFT"
	StatusPublished = "PUBLISHED"
	StatusArchived  = "ARCHIVED"

	TemplateActive = "ACTIVE"
)

// ContentBlock is an ordered piece of a module's content.
type ContentBlock struct {
	ID                uuid.UUID `gorm:"type:uuid;primaryKey"`
	ModuleID          uuid.UUID `gorm:"type:uuid"`
	SourceKey         *string
	BlockType         BlockType
	Position          int
	Payload           json.RawMessage `gorm:"type:jsonb"`
	// InactiveAt is when the block was inactivated; nil means it is active (SPEC-019 RN-12).
	InactiveAt        *time.Time
	EditedByTeacherAt *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
	// CreatedBy and UpdatedBy are the teachers who created and last changed the content (nil for what came from the seed).
	CreatedBy *uuid.UUID `gorm:"type:uuid"`
	UpdatedBy *uuid.UUID `gorm:"type:uuid"`
	// The names behind them, read with the block and never written.
	CreatedByName string `gorm:"->"`
	UpdatedByName string `gorm:"->"`
}

// Active reports whether students can see the block.
func (b ContentBlock) Active() bool { return b.InactiveAt == nil }

// TableName pins the table name.
func (ContentBlock) TableName() string { return "content_blocks" }

// Scenario is an immutable starting state of a practical question.
type Scenario struct {
	ID             uuid.UUID `gorm:"type:uuid;primaryKey"`
	SourceKey      *string
	BaseScenarioID *uuid.UUID      `gorm:"type:uuid"`
	Snapshot       json.RawMessage `gorm:"type:jsonb"`
	FormatVersion  int
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// TableName pins the table name.
func (Scenario) TableName() string { return "scenarios" }

// Question is an item of the question bank (exercise or assessment usage).
type Question struct {
	ID                   uuid.UUID `gorm:"type:uuid;primaryKey"`
	SourceKey            *string
	ModuleID             uuid.UUID `gorm:"type:uuid"`
	Kind                 string
	Usage                string
	Difficulty           string
	Status               string
	Title                string
	Statement            string
	Hint                 *string
	Explanation          *string
	ScenarioID           *uuid.UUID      `gorm:"type:uuid"`
	ReferenceSolution    json.RawMessage `gorm:"type:jsonb"`
	ValidationConditions json.RawMessage `gorm:"type:jsonb"`
	Choices              json.RawMessage `gorm:"type:jsonb"`
	AnswerKey            json.RawMessage `gorm:"type:jsonb"`
	Tags                 json.RawMessage `gorm:"type:jsonb"`
	EditedByTeacherAt    *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
	DeletedAt            gorm.DeletedAt
}

// TableName pins the table name.
func (Question) TableName() string { return "questions" }

// AssessmentTemplate is a reusable exam blueprint.
type AssessmentTemplate struct {
	ID                uuid.UUID `gorm:"type:uuid;primaryKey"`
	SourceKey         *string
	Title             string
	Description       string
	DurationMinutes   int
	MaxScore          float64
	Status            string
	EditedByTeacherAt *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
	DeletedAt         gorm.DeletedAt
}

// TableName pins the table name.
func (AssessmentTemplate) TableName() string { return "assessment_templates" }

// TemplateQuestion places a question in a template.
type TemplateQuestion struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey"`
	TemplateID uuid.UUID `gorm:"type:uuid"`
	QuestionID uuid.UUID `gorm:"type:uuid"`
	Position   int
	Weight     float64
}

// TableName pins the table name.
func (TemplateQuestion) TableName() string { return "assessment_template_questions" }

// BlockProgress tracks when a student completes reading a content block.
type BlockProgress struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID      uuid.UUID `gorm:"type:uuid;not null;index"`
	BlockID     uuid.UUID `gorm:"type:uuid;not null;index"`
	CompletedAt time.Time `gorm:"not null"`
	CreatedAt   time.Time `gorm:"not null"`
	UpdatedAt   time.Time `gorm:"not null"`
}

// TableName pins the table name.
func (BlockProgress) TableName() string { return "block_progress" }

