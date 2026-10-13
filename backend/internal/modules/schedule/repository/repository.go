// Package repository persists the schedule of a class with GORM (SPEC-042).
package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Repository implements service.Repository.
type Repository struct {
	db *database.DB
}

// New creates the repository.
func New(db *database.DB) *Repository { return &Repository{db: db} }

var _ service.Repository = (*Repository)(nil)

func dateOnly(t time.Time) string { return domain.Day(t).Format("2006-01-02") }

type classRow struct {
	ID         uuid.UUID `gorm:"column:id"`
	TeacherID  uuid.UUID `gorm:"column:teacher_id"`
	Name       string    `gorm:"column:name"`
	CourseCode string    `gorm:"column:course_code"`
	Color      string    `gorm:"column:color"`
	StartDate  time.Time `gorm:"column:start_date"`
	EndDate    time.Time `gorm:"column:end_date"`
	Status     string    `gorm:"column:status"`
}

func (r classRow) info() service.ClassInfo {
	return service.ClassInfo{ID: r.ID, TeacherID: r.TeacherID, Name: r.Name, CourseCode: r.CourseCode, Color: r.Color,
		StartDate: r.StartDate.In(domain.Location()), EndDate: r.EndDate.In(domain.Location()), Status: r.Status}
}

const classColumns = "id, teacher_id, name, course_code, color, start_date, end_date, status"

// FindClass returns the class data the schedule needs.
func (r *Repository) FindClass(ctx context.Context, id uuid.UUID) (service.ClassInfo, error) {
	var rows []classRow
	if err := r.db.Conn(ctx).Table("classes").Select(classColumns).
		Where("id = ? AND deleted_at IS NULL", id).Limit(1).Scan(&rows).Error; err != nil {
		return service.ClassInfo{}, err
	}
	if len(rows) == 0 {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return rows[0].info(), nil
}

// ListClasses returns the classes with the given ids.
func (r *Repository) ListClasses(ctx context.Context, ids []uuid.UUID) ([]service.ClassInfo, error) {
	out := []service.ClassInfo{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []classRow
	if err := r.db.Conn(ctx).Table("classes").Select(classColumns).
		Where("id IN ? AND deleted_at IS NULL", ids).Order("name").Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out = append(out, row.info())
	}
	return out, nil
}

// TeacherClassIDs returns the non-archived classes of a teacher.
func (r *Repository) TeacherClassIDs(ctx context.Context, teacherID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.Conn(ctx).Table("classes").Where("teacher_id = ? AND deleted_at IS NULL AND status <> 'ARCHIVED'", teacherID).
		Pluck("id", &ids).Error
	return ids, err
}

// StudentClassIDs returns the classes where the student has an ACTIVE enrollment.
func (r *Repository) StudentClassIDs(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	err := r.db.Conn(ctx).Table("class_enrollments ce").
		Joins("INNER JOIN classes c ON c.id = ce.class_id AND c.deleted_at IS NULL").
		Where("ce.user_id = ? AND ce.status = 'ACTIVE' AND ce.deleted_at IS NULL", userID).
		Pluck("ce.class_id", &ids).Error
	return ids, err
}

type recipientRow struct {
	UserID    uuid.UUID `gorm:"column:user_id"`
	Email     string    `gorm:"column:email"`
	Name      *string   `gorm:"column:name"`
	Reminders bool      `gorm:"column:email_session_reminders"`
	Digest    bool      `gorm:"column:email_weekly_digest"`
}

// ActiveStudents returns the students with an ACTIVE enrollment and an active account (SPEC-042 RN-09).
func (r *Repository) ActiveStudents(ctx context.Context, classID uuid.UUID) ([]service.Recipient, error) {
	var rows []recipientRow
	if err := r.db.Conn(ctx).Table("class_enrollments ce").
		Select("u.id AS user_id, u.email, u.name, u.email_session_reminders, u.email_weekly_digest").
		Joins("INNER JOIN users u ON u.id = ce.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'").
		Where("ce.class_id = ? AND ce.status = 'ACTIVE' AND ce.deleted_at IS NULL", classID).
		Order("u.email").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]service.Recipient, 0, len(rows))
	for _, row := range rows {
		name := ""
		if row.Name != nil {
			name = *row.Name
		}
		out = append(out, service.Recipient{UserID: row.UserID, Email: row.Email, Name: name, Reminders: row.Reminders, Digest: row.Digest})
	}
	return out, nil
}

// ListMeetings returns the weekly meetings of a class.
func (r *Repository) ListMeetings(ctx context.Context, classID uuid.UUID) ([]domain.WeeklyMeeting, error) {
	var meetings []domain.WeeklyMeeting
	err := r.db.Conn(ctx).Where("class_id = ?", classID).Order("weekday, start_time").Find(&meetings).Error
	return meetings, err
}

// ReplaceMeetings saves the meetings, removes the others, drops the untouched weekly sessions from `from` on and
// inserts the new sessions, skipping a meeting and date that already have one, all in one transaction (RN-02, D-08).
func (r *Repository) ReplaceMeetings(ctx context.Context, classID uuid.UUID, meetings []domain.WeeklyMeeting, from time.Time, sessions []domain.ClassSession) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		keep := make([]uuid.UUID, 0, len(meetings))
		for i := range meetings {
			meetings[i].ClassID = classID
			if err := conn.Save(&meetings[i]).Error; err != nil {
				return err
			}
			keep = append(keep, meetings[i].ID)
		}
		drop := conn.Where("class_id = ?", classID)
		if len(keep) > 0 {
			drop = drop.Where("id NOT IN ?", keep)
		}
		if err := drop.Delete(&domain.WeeklyMeeting{}).Error; err != nil {
			return err
		}
		if err := conn.Where("class_id = ? AND origin = ? AND overridden = false AND period_id IS NULL AND date >= ?",
			classID, domain.OriginWeekly, dateOnly(from)).Delete(&domain.ClassSession{}).Error; err != nil {
			return err
		}
		for i := range sessions {
			sessions[i].ClassID = classID
			err := conn.Clauses(clause.OnConflict{
				Columns:     []clause.Column{{Name: "class_id"}, {Name: "meeting_id"}, {Name: "date"}},
				TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "deleted_at IS NULL AND meeting_id IS NOT NULL"}}},
				DoNothing:   true,
			}).Create(&sessions[i]).Error
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func sessionsQuery(conn *gorm.DB, from, to time.Time) *gorm.DB {
	return conn.Where("date BETWEEN ? AND ?", dateOnly(from), dateOnly(to)).Order("date, start_time")
}

func normalizeSessions(list []domain.ClassSession) []domain.ClassSession {
	for i := range list {
		list[i].Date = domain.Day(list[i].Date.UTC())
	}
	return list
}

// ListSessions returns the sessions of the classes between from and to.
func (r *Repository) ListSessions(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.ClassSession, error) {
	sessions := []domain.ClassSession{}
	if len(classIDs) == 0 {
		return sessions, nil
	}
	err := sessionsQuery(r.db.Conn(ctx), from, to).Where("class_id IN ?", classIDs).Find(&sessions).Error
	return normalizeSessions(sessions), err
}

// ListAllSessions returns the sessions of every class that is not removed between from and to.
func (r *Repository) ListAllSessions(ctx context.Context, from, to time.Time) ([]domain.ClassSession, error) {
	var sessions []domain.ClassSession
	err := sessionsQuery(r.db.Conn(ctx), from, to).
		Where("class_id IN (SELECT id FROM classes WHERE deleted_at IS NULL)").Find(&sessions).Error
	return normalizeSessions(sessions), err
}

// FindSession returns a session.
func (r *Repository) FindSession(ctx context.Context, id uuid.UUID) (domain.ClassSession, error) {
	var s domain.ClassSession
	err := r.db.Conn(ctx).Where("id = ?", id).First(&s).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.ClassSession{}, domain.ErrSessionNotFound
	}
	s.Date = domain.Day(s.Date.UTC())
	return s, err
}

// SaveSession creates or updates a session.
func (r *Repository) SaveSession(ctx context.Context, s *domain.ClassSession) error {
	return r.db.Conn(ctx).Save(s).Error
}

// DeleteSession removes a session (soft delete).
func (r *Repository) DeleteSession(ctx context.Context, id uuid.UUID) error {
	return r.db.Conn(ctx).Where("id = ?", id).Delete(&domain.ClassSession{}).Error
}

// ListEvents returns the events of the classes between from and to.
func (r *Repository) ListEvents(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.ClassEvent, error) {
	events := []domain.ClassEvent{}
	if len(classIDs) == 0 {
		return events, nil
	}
	err := r.db.Conn(ctx).Where("class_id IN ? AND date BETWEEN ? AND ?", classIDs, dateOnly(from), dateOnly(to)).
		Order("date, start_time NULLS FIRST").Find(&events).Error
	for i := range events {
		events[i].Date = domain.Day(events[i].Date.UTC())
	}
	return events, err
}

// FindEvent returns an event.
func (r *Repository) FindEvent(ctx context.Context, id uuid.UUID) (domain.ClassEvent, error) {
	var e domain.ClassEvent
	err := r.db.Conn(ctx).Where("id = ?", id).First(&e).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.ClassEvent{}, domain.ErrEventNotFound
	}
	e.Date = domain.Day(e.Date.UTC())
	return e, err
}

// SaveEvent creates or updates an event.
func (r *Repository) SaveEvent(ctx context.Context, e *domain.ClassEvent) error {
	return r.db.Conn(ctx).Save(e).Error
}

// DeleteEvent removes an event (soft delete).
func (r *Repository) DeleteEvent(ctx context.Context, id uuid.UUID) error {
	return r.db.Conn(ctx).Where("id = ?", id).Delete(&domain.ClassEvent{}).Error
}

func normalizePeriod(p *domain.SpecialPeriod) {
	p.FirstDay = domain.Day(p.FirstDay.UTC())
	p.LastDay = domain.Day(p.LastDay.UTC())
}

// ListPeriods returns the periods of the classes that touch the range.
func (r *Repository) ListPeriods(ctx context.Context, classIDs []uuid.UUID, from, to time.Time) ([]domain.SpecialPeriod, error) {
	periods := []domain.SpecialPeriod{}
	if len(classIDs) == 0 {
		return periods, nil
	}
	err := r.db.Conn(ctx).Where("class_id IN ? AND last_day >= ? AND first_day <= ?", classIDs, dateOnly(from), dateOnly(to)).
		Order("first_day").Find(&periods).Error
	for i := range periods {
		normalizePeriod(&periods[i])
	}
	return periods, err
}

// FindPeriod returns a period.
func (r *Repository) FindPeriod(ctx context.Context, id uuid.UUID) (domain.SpecialPeriod, error) {
	var p domain.SpecialPeriod
	err := r.db.Conn(ctx).Where("id = ?", id).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.SpecialPeriod{}, domain.ErrPeriodNotFound
	}
	normalizePeriod(&p)
	return p, err
}

// SavePeriod creates a period and saves the sessions it changed in one transaction (RN-07).
func (r *Repository) SavePeriod(ctx context.Context, p *domain.SpecialPeriod, sessions []domain.ClassSession) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		if err := conn.Create(p).Error; err != nil {
			return err
		}
		for i := range sessions {
			if err := conn.Save(&sessions[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// DeletePeriod removes a period and saves the restored sessions in one transaction (RN-07).
func (r *Repository) DeletePeriod(ctx context.Context, id uuid.UUID, sessions []domain.ClassSession) error {
	return r.db.WithinTransaction(ctx, func(txCtx context.Context) error {
		conn := r.db.Conn(txCtx)
		for i := range sessions {
			if err := conn.Save(&sessions[i]).Error; err != nil {
				return err
			}
		}
		return conn.Where("id = ?", id).Delete(&domain.SpecialPeriod{}).Error
	})
}

// ListHolidays returns the holidays between from and to, active or not.
func (r *Repository) ListHolidays(ctx context.Context, from, to time.Time) ([]domain.Holiday, error) {
	holidays := []domain.Holiday{}
	err := r.db.Conn(ctx).Where("date BETWEEN ? AND ?", dateOnly(from), dateOnly(to)).Order("date, name").Find(&holidays).Error
	for i := range holidays {
		holidays[i].Date = domain.Day(holidays[i].Date.UTC())
	}
	return holidays, err
}

// FindHoliday returns a holiday.
func (r *Repository) FindHoliday(ctx context.Context, id uuid.UUID) (domain.Holiday, error) {
	var h domain.Holiday
	err := r.db.Conn(ctx).Where("id = ?", id).First(&h).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Holiday{}, domain.ErrHolidayNotFound
	}
	h.Date = domain.Day(h.Date.UTC())
	return h, err
}

// SaveHoliday creates or updates a holiday.
func (r *Repository) SaveHoliday(ctx context.Context, h *domain.Holiday) error {
	return r.db.Conn(ctx).Save(h).Error
}

// DeleteHoliday removes a holiday (soft delete).
func (r *Repository) DeleteHoliday(ctx context.Context, id uuid.UUID) error {
	return r.db.Conn(ctx).Where("id = ?", id).Delete(&domain.Holiday{}).Error
}

// EnsureNationalHolidays adds the national holidays that are not there yet (RN-11).
func (r *Repository) EnsureNationalHolidays(ctx context.Context, seeds []domain.HolidaySeed) error {
	conn := r.db.Conn(ctx)
	for _, seed := range seeds {
		h := domain.Holiday{Date: domain.Day(seed.Date), Name: seed.Name, Scope: domain.HolidayNational, Active: true}
		err := conn.Clauses(clause.OnConflict{
			Columns:     []clause.Column{{Name: "date"}, {Name: "name"}},
			TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "deleted_at IS NULL"}}},
			DoNothing:   true,
		}).Create(&h).Error
		if err != nil {
			return err
		}
	}
	return nil
}

type outboxRow struct {
	ID              uuid.UUID  `gorm:"column:id"`
	RecipientUserID *uuid.UUID `gorm:"column:recipient_user_id"`
	Recipient       string     `gorm:"column:recipient"`
	Kind            string     `gorm:"column:kind"`
	Subject         string     `gorm:"column:subject"`
	BodyText        string     `gorm:"column:body_text"`
	BodyHTML        string     `gorm:"column:body_html"`
	DedupeKey       *string    `gorm:"column:dedupe_key"`
	Status          string     `gorm:"column:status"`
	SendAfter       time.Time  `gorm:"column:send_after"`
	CreatedAt       time.Time  `gorm:"column:created_at"`
	UpdatedAt       time.Time  `gorm:"column:updated_at"`
}

// Enqueue puts e-mails in the outbox; an item whose key is already there is skipped (RN-09).
func (r *Repository) Enqueue(ctx context.Context, items []service.OutboxItem) error {
	conn := r.db.Conn(ctx).Table("email_outbox")
	now := time.Now()
	for _, it := range items {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		row := outboxRow{ID: id, Recipient: it.To, Kind: it.Kind, Subject: it.Subject, BodyText: it.TextBody,
			BodyHTML: it.HTMLBody, Status: "PENDING", SendAfter: it.SendAfter, CreatedAt: now, UpdatedAt: now}
		if it.RecipientUserID != uuid.Nil {
			userID := it.RecipientUserID
			row.RecipientUserID = &userID
		}
		if it.DedupeKey != "" {
			key := it.DedupeKey
			row.DedupeKey = &key
		}
		err = conn.Clauses(clause.OnConflict{
			Columns:     []clause.Column{{Name: "dedupe_key"}},
			TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "dedupe_key IS NOT NULL"}}},
			DoNothing:   true,
		}).Create(&row).Error
		if err != nil {
			return err
		}
	}
	return nil
}

type activationRow struct {
	EnrollmentID uuid.UUID `gorm:"column:enrollment_id"`
	ClassID      uuid.UUID `gorm:"column:class_id"`
	UserID       uuid.UUID `gorm:"column:user_id"`
	Email        string    `gorm:"column:email"`
	Name         *string   `gorm:"column:name"`
}

// RecentActivations returns the enrollments that became ACTIVE since `since` (RN-09b).
func (r *Repository) RecentActivations(ctx context.Context, since time.Time) ([]service.Activation, error) {
	var rows []activationRow
	if err := r.db.Conn(ctx).Table("class_enrollments ce").
		Select("ce.id AS enrollment_id, ce.class_id, u.id AS user_id, u.email, u.name").
		Joins("INNER JOIN users u ON u.id = ce.user_id AND u.deleted_at IS NULL AND u.status = 'ACTIVE'").
		Joins("INNER JOIN classes c ON c.id = ce.class_id AND c.deleted_at IS NULL").
		Where("ce.status = 'ACTIVE' AND ce.deleted_at IS NULL AND ce.decided_at >= ?", since).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]service.Activation, 0, len(rows))
	for _, row := range rows {
		name := ""
		if row.Name != nil {
			name = *row.Name
		}
		out = append(out, service.Activation{EnrollmentID: row.EnrollmentID, ClassID: row.ClassID, UserID: row.UserID, Email: row.Email, Name: name})
	}
	return out, nil
}

// Preferences returns the e-mail preferences of a user (RN-10).
func (r *Repository) Preferences(ctx context.Context, userID uuid.UUID) (bool, bool, error) {
	var rows []recipientRow
	if err := r.db.Conn(ctx).Table("users").Select("id AS user_id, email, email_session_reminders, email_weekly_digest").
		Where("id = ? AND deleted_at IS NULL", userID).Limit(1).Scan(&rows).Error; err != nil {
		return false, false, err
	}
	if len(rows) == 0 {
		return true, true, nil
	}
	return rows[0].Reminders, rows[0].Digest, nil
}

// SetPreferences saves the e-mail preferences of a user (RN-10).
func (r *Repository) SetPreferences(ctx context.Context, userID uuid.UUID, reminders, digest bool) error {
	return r.db.Conn(ctx).Table("users").Where("id = ?", userID).
		Updates(map[string]any{"email_session_reminders": reminders, "email_weekly_digest": digest, "updated_at": time.Now()}).Error
}
