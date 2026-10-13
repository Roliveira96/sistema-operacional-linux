// Package domain holds the practice progress of students (SPEC-014).
package domain

import (
	"encoding/json"
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
	// Response is the single answer of the student to a question without a terminal (SPEC-035 RN-08), nil in the practical ones.
	Response  json.RawMessage `gorm:"type:jsonb"`
	CreatedAt time.Time
	UpdatedAt time.Time
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

// Complete records an approval seen by the automatic batch check (SPEC-016
// RN-01): it never counts an attempt, and the first approval is kept.
func (p *Progress) Complete(at time.Time) {
	p.LastPassed = true
	if p.CompletedAt == nil {
		completed := at
		p.CompletedAt = &completed
	}
}

// Answer records the single response to a true or false question (SPEC-035 RN-08, D-13): the question counts as done when
// answered, right or wrong, and LastPassed says whether it was right.
func (p *Progress) Answer(response json.RawMessage, passed bool, at time.Time) {
	p.Attempts = 1
	p.LastPassed = passed
	p.Response = response
	answered := at
	p.CompletedAt = &answered
}
