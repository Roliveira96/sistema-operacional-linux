// Package repository persists the live classroom with GORM (SPEC-051).
package repository

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

const uniqueViolation = "23505"

// Repository implements service.Repository.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository { return &Repository{db: db} }

var _ service.Repository = (*Repository)(nil)

func isUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}

// ---- class, enrollment and links ----

type classRow struct {
	ID        uuid.UUID `gorm:"column:id"`
	TeacherID uuid.UUID `gorm:"column:teacher_id"`
	Status    string    `gorm:"column:status"`
}

// FindClass returns the class, or ErrClassNotFound.
func (r *Repository) FindClass(ctx context.Context, id uuid.UUID) (service.ClassInfo, error) {
	var rows []classRow
	if err := r.db.Conn(ctx).Table("classes").Select("id, teacher_id, status").
		Where("id = ? AND deleted_at IS NULL", id).Limit(1).Scan(&rows).Error; err != nil {
		return service.ClassInfo{}, err
	}
	if len(rows) == 0 {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return service.ClassInfo{ID: rows[0].ID, TeacherID: rows[0].TeacherID, Archived: rows[0].Status == "ARCHIVED"}, nil
}

// IsActiveStudent tells whether the user has an ACTIVE enrollment in the class.
func (r *Repository) IsActiveStudent(ctx context.Context, classID, userID uuid.UUID) (bool, error) {
	return r.exists(ctx, "class_enrollments", "class_id = ? AND user_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL", classID, userID)
}

// ClassSessionBelongsToClass tells whether the lesson of the schedule is of the class.
func (r *Repository) ClassSessionBelongsToClass(ctx context.Context, id, classID uuid.UUID) (bool, error) {
	return r.exists(ctx, "class_sessions", "id = ? AND class_id = ? AND deleted_at IS NULL", id, classID)
}

// ModuleExists tells whether the teaching module exists.
func (r *Repository) ModuleExists(ctx context.Context, id uuid.UUID) (bool, error) {
	return r.exists(ctx, "course_modules", "id = ? AND deleted_at IS NULL", id)
}

func (r *Repository) exists(ctx context.Context, table, where string, args ...any) (bool, error) {
	var n int64
	err := r.db.Conn(ctx).Table(table).Where(where, args...).Count(&n).Error
	return n > 0, err
}

// ---- rooms ----

// FindActiveSession returns the open room of the class, or ErrSessionNotFound.
func (r *Repository) FindActiveSession(ctx context.Context, classID uuid.UUID) (domain.LiveClassroomSession, error) {
	var s domain.LiveClassroomSession
	err := r.db.Conn(ctx).Where("class_id = ? AND status = ?", classID, domain.StatusActive).First(&s).Error
	return s, notFound(err, domain.ErrSessionNotFound)
}

// FindSession returns a room, or ErrSessionNotFound.
func (r *Repository) FindSession(ctx context.Context, id uuid.UUID) (domain.LiveClassroomSession, error) {
	var s domain.LiveClassroomSession
	err := r.db.Conn(ctx).First(&s, "id = ?", id).Error
	return s, notFound(err, domain.ErrSessionNotFound)
}

func notFound(err, sentinel error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return sentinel
	}
	return err
}

// CreateSession inserts a room; the unique index of the open room turns a second one into ErrActiveSessionExists.
func (r *Repository) CreateSession(ctx context.Context, s *domain.LiveClassroomSession) error {
	if err := r.db.Conn(ctx).Create(s).Error; err != nil {
		if isUnique(err) {
			return domain.ErrActiveSessionExists
		}
		return err
	}
	return nil
}

// SaveSession saves every field of a room.
func (r *Repository) SaveSession(ctx context.Context, s *domain.LiveClassroomSession) error {
	return r.db.Conn(ctx).Save(s).Error
}

// TouchSession renews the moment the room was last seen with its teacher, without changing anything else.
func (r *Repository) TouchSession(ctx context.Context, id uuid.UUID, now time.Time) error {
	return r.db.Conn(ctx).Model(&domain.LiveClassroomSession{}).Where("id = ?", id).UpdateColumn("updated_at", now).Error
}

// ListSessions returns the rooms of the class, the open one first and then the ended ones, newest first.
func (r *Repository) ListSessions(ctx context.Context, classID uuid.UUID, limit int) ([]domain.LiveClassroomSession, error) {
	var out []domain.LiveClassroomSession
	err := r.db.Conn(ctx).Where("class_id = ?", classID).
		Order("(status = 'ACTIVE') DESC, started_at DESC").Limit(limit).Find(&out).Error
	return out, err
}

// ListActiveSessions returns every open room.
func (r *Repository) ListActiveSessions(ctx context.Context) ([]domain.LiveClassroomSession, error) {
	var out []domain.LiveClassroomSession
	err := r.db.Conn(ctx).Where("status = ?", domain.StatusActive).Find(&out).Error
	return out, err
}

// ListOpenRoomsOfStudent returns the open rooms of the classes that were not deleted and where the student has an ACTIVE enrollment, the newest
// first, in one query (SPEC-067 RN-01, RN-02, RN-06, RN-08). The columns are named as the fields of service.StudentRoom.
func (r *Repository) ListOpenRoomsOfStudent(ctx context.Context, studentID uuid.UUID) ([]service.StudentRoom, error) {
	var out []service.StudentRoom
	err := r.db.Conn(ctx).Table("live_classroom_sessions AS s").
		Select("s.class_id AS class_id, c.name AS class_name, s.id AS session_id, s.title AS title, s.started_at AS started_at").
		Joins("JOIN classes c ON c.id = s.class_id AND c.deleted_at IS NULL").
		Joins("JOIN class_enrollments ce ON ce.class_id = s.class_id AND ce.user_id = ? AND ce.status = 'ACTIVE' AND ce.deleted_at IS NULL", studentID).
		Where("s.status = ? AND s.deleted_at IS NULL", domain.StatusActive).
		Order("s.started_at DESC").Scan(&out).Error
	return out, err
}

// SessionsWithNotes tells which of the rooms the student has notes in (legacy notes or atomic note blocks, SPEC-071 RN-08).
func (r *Repository) SessionsWithNotes(ctx context.Context, studentID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	var found []uuid.UUID
	if err := r.db.Conn(ctx).Model(&domain.LiveClassroomNote{}).Where("student_id = ? AND session_id IN ?", studentID, ids).Pluck("session_id", &found).Error; err != nil {
		return out, err
	}
	for _, id := range found {
		out[id] = true
	}
	var blockFound []uuid.UUID
	if err := r.db.Conn(ctx).Model(&domain.LiveClassroomNoteBlock{}).Where("student_id = ? AND session_id IN ?", studentID, ids).Distinct("session_id").Pluck("session_id", &blockFound).Error; err != nil {
		return out, err
	}
	for _, id := range blockFound {
		out[id] = true
	}
	return out, nil
}

// ---- decks ----

// CountDecks counts the presentations of the class.
func (r *Repository) CountDecks(ctx context.Context, classID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.Conn(ctx).Model(&domain.SlideDeck{}).Where("class_id = ?", classID).Count(&n).Error
	return n, err
}

// ListDecks returns the presentations of the class that were not deleted, newest first (SPEC-053).
func (r *Repository) ListDecks(ctx context.Context, classID uuid.UUID) ([]domain.SlideDeck, error) {
	decks := []domain.SlideDeck{}
	err := r.db.Conn(ctx).Where("class_id = ?", classID).Order("created_at DESC").Find(&decks).Error
	return decks, err
}

// CreateDeck inserts a presentation.
func (r *Repository) CreateDeck(ctx context.Context, d *domain.SlideDeck) error {
	return r.db.Conn(ctx).Create(d).Error
}

// FindDeck returns a presentation, or ErrDeckNotFound.
func (r *Repository) FindDeck(ctx context.Context, id uuid.UUID) (domain.SlideDeck, error) {
	var d domain.SlideDeck
	err := r.db.Conn(ctx).First(&d, "id = ?", id).Error
	return d, notFound(err, domain.ErrDeckNotFound)
}

// ---- raised hands ----

// RaiseHand puts the student in the queue with his question ("" is none, kept as null). A hand of his that is already waiting only takes
// the new question: it stays one hand, in its place.
// ponytail: update and insert are two statements, so a double click could queue twice; a partial unique index when it shows up.
func (r *Repository) RaiseHand(ctx context.Context, sessionID, studentID uuid.UUID, question string, now time.Time) error {
	var text *string
	if question != "" {
		text = &question
	}
	conn := r.db.Conn(ctx)
	waiting := conn.Model(&domain.LiveHandRaise{}).Where("session_id = ? AND student_id = ? AND status = ?", sessionID, studentID, domain.HandPending).
		Update("question", text)
	if waiting.Error != nil || waiting.RowsAffected > 0 {
		return waiting.Error
	}
	return conn.Create(&domain.LiveHandRaise{SessionID: sessionID, StudentID: studentID, Status: domain.HandPending, RequestedAt: now, Question: text}).Error
}

type handRow struct {
	StudentID   uuid.UUID `gorm:"column:student_id"`
	Name        string    `gorm:"column:name"`
	RequestedAt time.Time `gorm:"column:requested_at"`
	Question    string    `gorm:"column:question"`
}

// ListHandRaises returns the waiting hands, first in first served, with the name of each student and his question ("" with none).
func (r *Repository) ListHandRaises(ctx context.Context, sessionID uuid.UUID) ([]domain.HandRaiseEntry, error) {
	var rows []handRow
	err := r.db.Conn(ctx).Table("live_hand_raises h").
		Select("h.student_id, COALESCE(u.name, u.email) AS name, h.requested_at, COALESCE(h.question, '') AS question").
		Joins("INNER JOIN users u ON u.id = h.student_id").
		Where("h.session_id = ? AND h.status = ? AND h.deleted_at IS NULL", sessionID, domain.HandPending).
		Order("h.requested_at, h.id").Scan(&rows).Error
	out := make([]domain.HandRaiseEntry, len(rows))
	for i, row := range rows {
		out[i] = domain.HandRaiseEntry{StudentID: row.StudentID, Name: row.Name, RequestedAt: row.RequestedAt, Question: row.Question}
	}
	return out, err
}

// ResolveHand closes the waiting hand of the student with the status (answered or lowered), and erases his question.
func (r *Repository) ResolveHand(ctx context.Context, sessionID, studentID uuid.UUID, status string, now time.Time) error {
	return r.db.Conn(ctx).Model(&domain.LiveHandRaise{}).
		Where("session_id = ? AND student_id = ? AND status = ?", sessionID, studentID, domain.HandPending).
		Updates(map[string]any{"status": status, "resolved_at": now, "question": nil}).Error
}

// ResolveAllHands lowers every waiting hand of the room, and erases their questions.
func (r *Repository) ResolveAllHands(ctx context.Context, sessionID uuid.UUID, now time.Time) error {
	return r.db.Conn(ctx).Model(&domain.LiveHandRaise{}).
		Where("session_id = ? AND status = ?", sessionID, domain.HandPending).
		Updates(map[string]any{"status": domain.HandLowered, "resolved_at": now, "question": nil}).Error
}

// ---- notes ----

// SaveNote saves the notebook of the student in the room: the first time it creates it, then it changes it.
func (r *Repository) SaveNote(ctx context.Context, sessionID, studentID uuid.UUID, content string) (domain.LiveClassroomNote, error) {
	var note domain.LiveClassroomNote
	err := r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		err := conn.Where("session_id = ? AND student_id = ?", sessionID, studentID).First(&note).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			note = domain.LiveClassroomNote{SessionID: sessionID, StudentID: studentID, Content: content}
			return conn.Create(&note).Error
		}
		if err != nil {
			return err
		}
		note.Content = content
		return conn.Save(&note).Error
	})
	return note, err
}

// FindNote returns the notebook of the student, or ErrNotesNotFound.
func (r *Repository) FindNote(ctx context.Context, sessionID, studentID uuid.UUID) (domain.LiveClassroomNote, error) {
	var note domain.LiveClassroomNote
	err := r.db.Conn(ctx).Where("session_id = ? AND student_id = ?", sessionID, studentID).First(&note).Error
	return note, notFound(err, domain.ErrNotesNotFound)
}

// ---- chat of the lesson (SPEC-063) ----

// CreateChatMessage inserts a message of the chat. The room, the sender and the student exist, and the rules of who writes where hold,
// by the constraints of the table.
func (r *Repository) CreateChatMessage(ctx context.Context, m *domain.LiveChatMessage) error {
	return r.db.Conn(ctx).Create(m).Error
}

// ListChatMessages returns the last `limit` messages of the room, oldest first. With no student it is the panel's reading, every message;
// with one, it is that student's: the messages for everybody and the ones of his own conversation.
func (r *Repository) ListChatMessages(ctx context.Context, sessionID uuid.UUID, student *uuid.UUID, limit int) ([]domain.LiveChatMessage, error) {
	query := r.db.Conn(ctx).Where("session_id = ?", sessionID)
	if student != nil {
		query = query.Where("(student_id IS NULL OR student_id = ?)", *student)
	}
	var out []domain.LiveChatMessage
	if err := query.Order("created_at DESC, id DESC").Limit(limit).Find(&out).Error; err != nil {
		return nil, err
	}
	slices.Reverse(out) // read newest first so that the limit keeps the last ones; the caller wants them oldest first
	return out, nil
}

// ---- waiting room (SPEC-054) ----

// FindAdmission returns the situation of the student in the room, or ErrAdmissionNotFound.
func (r *Repository) FindAdmission(ctx context.Context, sessionID, studentID uuid.UUID) (domain.LiveClassroomAdmission, error) {
	var a domain.LiveClassroomAdmission
	err := r.db.Conn(ctx).Where("session_id = ? AND student_id = ?", sessionID, studentID).First(&a).Error
	return a, notFound(err, domain.ErrAdmissionNotFound)
}

// UpsertAdmission sets the situation of the student in the room: it creates the row the first time and changes it after. Waiting
// puts the student at the end of the line and clears the decision; any other status records who decided and when.
func (r *Repository) UpsertAdmission(ctx context.Context, sessionID, studentID uuid.UUID, status string, now time.Time, decidedBy *uuid.UUID) (domain.LiveClassroomAdmission, error) {
	var a domain.LiveClassroomAdmission
	err := r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		err := conn.Where("session_id = ? AND student_id = ?", sessionID, studentID).First(&a).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			a = domain.LiveClassroomAdmission{SessionID: sessionID, StudentID: studentID, RequestedAt: now}
		} else if err != nil {
			return err
		}
		a.Status = status
		if status == domain.AdmissionWaiting {
			a.RequestedAt, a.DecidedAt, a.DecidedBy = now, nil, nil
		} else {
			a.DecidedAt, a.DecidedBy = &now, decidedBy
		}
		return conn.Save(&a).Error
	})
	return a, err
}

type admissionRow struct {
	StudentID   uuid.UUID `gorm:"column:student_id"`
	Name        string    `gorm:"column:name"`
	Status      string    `gorm:"column:status"`
	RequestedAt time.Time `gorm:"column:requested_at"`
}

// ListAdmissions returns who waits and who was admitted, in the order of the request, with the name of each student. The removed are left out.
func (r *Repository) ListAdmissions(ctx context.Context, sessionID uuid.UUID) ([]domain.AdmissionEntry, error) {
	var rows []admissionRow
	err := r.db.Conn(ctx).Table("live_classroom_admissions a").
		Select("a.student_id, COALESCE(u.name, u.email) AS name, a.status, a.requested_at").
		Joins("INNER JOIN users u ON u.id = a.student_id").
		Where("a.session_id = ? AND a.status IN ? AND a.deleted_at IS NULL", sessionID, []string{domain.AdmissionWaiting, domain.AdmissionAdmitted}).
		Order("a.requested_at, a.id").Scan(&rows).Error
	out := make([]domain.AdmissionEntry, len(rows))
	for i, row := range rows {
		out[i] = domain.AdmissionEntry{StudentID: row.StudentID, Name: row.Name, Status: row.Status, RequestedAt: row.RequestedAt}
	}
	return out, err
}

// AdmitAllWaiting admits every student who waits and returns who they are.
func (r *Repository) AdmitAllWaiting(ctx context.Context, sessionID uuid.UUID, now time.Time, decidedBy *uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Model(&domain.LiveClassroomAdmission{}).Where("session_id = ? AND status = ?", sessionID, domain.AdmissionWaiting).
			Pluck("student_id", &ids).Error; err != nil || len(ids) == 0 {
			return err
		}
		return conn.Model(&domain.LiveClassroomAdmission{}).Where("session_id = ? AND student_id IN ?", sessionID, ids).
			Updates(map[string]any{"status": domain.AdmissionAdmitted, "decided_at": now, "decided_by": decidedBy}).Error
	})
	return ids, err
}
