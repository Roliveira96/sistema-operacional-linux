package repository

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

type chatRow struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID uuid.UUID
	AttemptID    *uuid.UUID
	SenderID     uuid.UUID
	SenderRole   domain.ChatRole
	Position     *int
	Body         string
	CreatedAt    time.Time
}

func (chatRow) TableName() string { return "assessment_chat_messages" }

type recipientRow struct {
	MessageID uuid.UUID `gorm:"type:uuid;primaryKey"`
	AttemptID uuid.UUID `gorm:"type:uuid;primaryKey"`
}

func (recipientRow) TableName() string { return "assessment_chat_recipients" }

// chatWithStudent is a message read with the student of its attempt.
type chatWithStudent struct {
	ID           uuid.UUID
	AssessmentID uuid.UUID
	AttemptID    *uuid.UUID
	SenderID     uuid.UUID
	SenderRole   domain.ChatRole
	Position     *int
	Body         string
	CreatedAt    time.Time
	StudentID    *uuid.UUID
}

// SaveChat stores a message and, for one to all, who received it, in one transaction (SPEC-093 RN-03, D-01); it is never changed after.
func (r *Repository) SaveChat(ctx context.Context, m *domain.ChatMessage, recipients []uuid.UUID) error {
	id, err := newID()
	if err != nil {
		return err
	}
	return r.db.WithinTransaction(ctx, func(ctx context.Context) error {
		row := chatRow{ID: id, AssessmentID: m.AssessmentID, AttemptID: m.AttemptID, SenderID: m.SenderID, SenderRole: m.SenderRole, Position: m.Position,
			Body: m.Body, CreatedAt: m.CreatedAt}
		if err := r.db.Conn(ctx).Create(&row).Error; err != nil {
			return err
		}
		for _, a := range recipients {
			if err := r.db.Conn(ctx).Create(&recipientRow{MessageID: id, AttemptID: a}).Error; err != nil {
				return err
			}
		}
		m.ID = id
		if m.AttemptID != nil {
			var of struct{ StudentID uuid.UUID }
			if err := r.db.Conn(ctx).Table("assessment_attempts").Select("student_id").Where("id = ?", *m.AttemptID).Scan(&of).Error; err != nil {
				return err
			}
			m.StudentID = &of.StudentID
		}
		return nil
	})
}

func (r *Repository) chats(ctx context.Context, where string, args ...any) ([]domain.ChatMessage, error) {
	var rows []chatWithStudent
	err := r.db.Conn(ctx).Table("assessment_chat_messages AS m").
		Select("m.*, a.student_id").
		Joins("LEFT JOIN assessment_attempts a ON a.id = m.attempt_id").
		Where(where, args...).Order("m.created_at, m.id").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]domain.ChatMessage, len(rows))
	for i, m := range rows {
		out[i] = domain.ChatMessage{ID: m.ID, AssessmentID: m.AssessmentID, AttemptID: m.AttemptID, StudentID: m.StudentID, SenderID: m.SenderID,
			SenderRole: m.SenderRole, Position: m.Position, Body: m.Body, CreatedAt: m.CreatedAt}
	}
	return out, nil
}

// AttemptChat gives the conversation of an attempt with the messages to all it received, in the order of time (RN-07, D-01).
func (r *Repository) AttemptChat(ctx context.Context, attemptID uuid.UUID) ([]domain.ChatMessage, error) {
	return r.chats(ctx, "m.attempt_id = ? OR m.id IN (SELECT message_id FROM assessment_chat_recipients WHERE attempt_id = ?)", attemptID, attemptID)
}

// AssessmentChat gives the last messages of the exam, the oldest first (RN-06).
func (r *Repository) AssessmentChat(ctx context.Context, assessmentID uuid.UUID, limit int) ([]domain.ChatMessage, error) {
	return r.chats(ctx, "m.id IN (SELECT id FROM assessment_chat_messages WHERE assessment_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)", assessmentID, limit)
}

// ChatCounts gives how many messages the conversation of each attempt of the exam has, the ones to all it received included (RN-07).
func (r *Repository) ChatCounts(ctx context.Context, assessmentID uuid.UUID) (map[uuid.UUID]int, error) {
	var rows []struct {
		AttemptID uuid.UUID
		N         int
	}
	err := r.db.Conn(ctx).Raw(`SELECT attempt_id, count(*) AS n FROM (
			SELECT attempt_id FROM assessment_chat_messages WHERE assessment_id = ? AND attempt_id IS NOT NULL
			UNION ALL
			SELECT rc.attempt_id FROM assessment_chat_recipients rc JOIN assessment_chat_messages m ON m.id = rc.message_id WHERE m.assessment_id = ?
		) c GROUP BY attempt_id`, assessmentID, assessmentID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]int, len(rows))
	for _, c := range rows {
		out[c.AttemptID] = c.N
	}
	return out, nil
}
