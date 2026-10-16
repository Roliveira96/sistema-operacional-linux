package repository

import (
	"context"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-071: the commands of the teacher in the live classroom ----

// CreateCommand inserts a command; the room exists and the limits of the fields hold, by the constraints of the table.
func (r *Repository) CreateCommand(ctx context.Context, c *domain.LiveTerminalCommand) error {
	return r.db.Conn(ctx).Create(c).Error
}

// CountCommands counts the commands of the room.
func (r *Repository) CountCommands(ctx context.Context, sessionID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.Conn(ctx).Model(&domain.LiveTerminalCommand{}).Where("session_id = ?", sessionID).Count(&n).Error
	return n, err
}

// ListCommands returns the commands of the room in the order they ran.
func (r *Repository) ListCommands(ctx context.Context, sessionID uuid.UUID) ([]domain.LiveTerminalCommand, error) {
	out := []domain.LiveTerminalCommand{}
	err := r.db.Conn(ctx).Where("session_id = ?", sessionID).Order("ran_at, id").Find(&out).Error
	return out, err
}

// ListLinkedSessions returns the rooms linked to any of the lessons, oldest first, each with how many commands it has: one query for the
// rooms and one for the counts, whatever the number of lessons.
func (r *Repository) ListLinkedSessions(ctx context.Context, classSessionIDs []uuid.UUID) ([]service.LinkedRoom, error) {
	out := []service.LinkedRoom{}
	if len(classSessionIDs) == 0 {
		return out, nil
	}
	var sessions []domain.LiveClassroomSession
	if err := r.db.Conn(ctx).Where("class_session_id IN ?", classSessionIDs).Order("started_at, id").Find(&sessions).Error; err != nil {
		return nil, err
	}
	if len(sessions) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(sessions))
	for i, s := range sessions {
		ids[i] = s.ID
	}
	var counts []struct {
		SessionID uuid.UUID
		N         int
	}
	err := r.db.Conn(ctx).Model(&domain.LiveTerminalCommand{}).Select("session_id, COUNT(*) AS n").
		Where("session_id IN ?", ids).Group("session_id").Scan(&counts).Error
	if err != nil {
		return nil, err
	}
	byRoom := make(map[uuid.UUID]int, len(counts))
	for _, c := range counts {
		byRoom[c.SessionID] = c.N
	}
	for _, s := range sessions {
		out = append(out, service.LinkedRoom{Session: s, CommandCount: byRoom[s.ID]})
	}
	return out, nil
}
