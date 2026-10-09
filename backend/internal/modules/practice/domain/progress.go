// Package domain holds the practice progress of students (SPEC-014).
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Progress is the result history of one student on one exercise.
type Progress struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID      uuid.UUID `gorm:"type:uuid"`
	QuestionID  uuid.UUID `gorm:"type:uuid"`
	Attempts    int
	LastPassed  bool
	CompletedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// TableName pins the table name.
func (Progress) TableName() string { return "exercise_progress" }

// Record applies one check result (RN-03): the first approval sets
// CompletedAt, and later results never clear it.
func (p *Progress) Record(passed bool, at time.Time) {
	p.Attempts++
	p.LastPassed = passed
	if passed && p.CompletedAt == nil {
		completed := at
		p.CompletedAt = &completed
	}
}
