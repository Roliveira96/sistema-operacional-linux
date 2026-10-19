package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- exercise of the lesson (SPEC-065) ----

// CreateExerciseRun inserts a round; the unique index of the round that runs turns a second one in the room into ErrExerciseRunning.
func (r *Repository) CreateExerciseRun(ctx context.Context, run *domain.LiveExerciseRun) error {
	if err := r.db.Conn(ctx).Create(run).Error; err != nil {
		if isUnique(err) {
			return domain.ErrExerciseRunning
		}
		return err
	}
	return nil
}

// FindExerciseRun returns a round, or ErrNoExerciseRun.
func (r *Repository) FindExerciseRun(ctx context.Context, id uuid.UUID) (domain.LiveExerciseRun, error) {
	var run domain.LiveExerciseRun
	err := r.db.Conn(ctx).First(&run, "id = ?", id).Error
	return run, notFound(err, domain.ErrNoExerciseRun)
}

// CurrentExerciseRun returns the round of the room that runs or, when none does, the last one that ended; ErrNoExerciseRun for a room that had
// none.
func (r *Repository) CurrentExerciseRun(ctx context.Context, sessionID uuid.UUID) (domain.LiveExerciseRun, error) {
	var run domain.LiveExerciseRun
	err := r.db.Conn(ctx).Where("session_id = ?", sessionID).Order("(ended_at IS NULL) DESC, started_at DESC, id DESC").First(&run).Error
	return run, notFound(err, domain.ErrNoExerciseRun)
}

// EndExerciseRun ends the round that runs, with the moment and the reason, and tells whether it did: a round that already ended keeps its
// first end, and the answer is false, so that only who ended it tells the room. A round that ends paused counts the pause up to the end
// (SPEC-071 RN-01).
func (r *Repository) EndExerciseRun(ctx context.Context, id uuid.UUID, at time.Time, by string) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NULL", id).
		Updates(map[string]any{"ended_at": at, "ended_by": by, "paused_at": nil,
			"paused_seconds": gorm.Expr("paused_seconds + CASE WHEN paused_at IS NULL THEN 0 ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (?::timestamptz - paused_at))))::integer END", at)})
	return res.RowsAffected > 0, res.Error
}

// ---- the guided practice (SPEC-071) ----

// PauseExerciseRun keeps the start of the pause of a round that runs and is not paused, and tells whether it did.
func (r *Repository) PauseExerciseRun(ctx context.Context, id uuid.UUID, at time.Time) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NULL AND paused_at IS NULL", id).Update("paused_at", at)
	return res.RowsAffected > 0, res.Error
}

// ResumeExerciseRun keeps the resume of a paused round, as the domain made it (the new end and the time paused), and tells whether it did.
func (r *Repository) ResumeExerciseRun(ctx context.Context, run domain.LiveExerciseRun) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NULL AND paused_at IS NOT NULL", run.ID).
		Updates(map[string]any{"paused_at": nil, "paused_seconds": run.PausedSeconds, "ends_at": run.EndsAt})
	return res.RowsAffected > 0, res.Error
}

// ExtendExerciseRun keeps more time of a round, as the domain made it, and tells whether it did. Without reopen, only a round that runs (or is
// paused) gets it; with reopen, only a round that ended and was not closed, which runs again with the result hidden. A reopening while another
// round of the room runs is ErrExerciseRunning.
func (r *Repository) ExtendExerciseRun(ctx context.Context, run domain.LiveExerciseRun, reopen bool) (bool, error) {
	q := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND closed_at IS NULL", run.ID)
	values := map[string]any{"duration_seconds": run.DurationSeconds, "ends_at": run.EndsAt}
	if reopen {
		q = q.Where("ended_at IS NOT NULL")
		values["ended_at"], values["ended_by"], values["result_visible"] = nil, nil, false
	} else {
		q = q.Where("ended_at IS NULL")
	}
	res := q.Updates(values)
	if isUnique(res.Error) {
		return false, domain.ErrExerciseRunning
	}
	return res.RowsAffected > 0, res.Error
}

// CloseExerciseRun keeps the moment the class went back to the lesson, for a round that ended and was not closed, and tells whether it did.
func (r *Repository) CloseExerciseRun(ctx context.Context, id uuid.UUID, at time.Time) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NOT NULL AND closed_at IS NULL", id).Update("closed_at", at)
	return res.RowsAffected > 0, res.Error
}

// JoinExerciseRun makes the row of each student in the round, IN_PROGRESS; a student who has one keeps it (SPEC-071 RN-08).
func (r *Repository) JoinExerciseRun(ctx context.Context, runID uuid.UUID, students []uuid.UUID) error {
	for _, student := range students {
		id, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if err := r.db.Conn(ctx).Exec(`INSERT INTO live_exercise_results (id, run_id, student_id, status, attempts, created_at, updated_at)
			VALUES (?, ?, ?, ?, 0, now(), now()) ON CONFLICT (run_id, student_id) WHERE deleted_at IS NULL DO NOTHING`,
			id, runID, student, domain.ParticipantInProgress).Error; err != nil {
			return err
		}
	}
	return nil
}

// markParticipant sets a flag of the row of the student in the round, making the row when he has none.
func (r *Repository) markParticipant(ctx context.Context, runID, student uuid.UUID, column string) error {
	if err := r.JoinExerciseRun(ctx, runID, []uuid.UUID{student}); err != nil {
		return err
	}
	return r.participants(ctx, runID).Where("student_id = ?", student).Update(column, true).Error
}

func (r *Repository) participants(ctx context.Context, runID uuid.UUID) *gorm.DB {
	return r.db.Conn(ctx).Model(&domain.LiveExerciseResult{}).Where("run_id = ?", runID)
}

// MarkExerciseHelp keeps that the student raised his hand during the round.
func (r *Repository) MarkExerciseHelp(ctx context.Context, runID, student uuid.UUID) error {
	return r.markParticipant(ctx, runID, student, "help_requested")
}

// MarkExerciseTakeover keeps that the teacher took over the terminal of the student in the round; it is what takes his points (SPEC-071 RN-07).
func (r *Repository) MarkExerciseTakeover(ctx context.Context, runID, student uuid.UUID) error {
	return r.markParticipant(ctx, runID, student, "taken_over")
}

// FinishExerciseParticipants is the end of the round for its students: who did not conclude becomes NOT_COMPLETED, and each keeps the commands
// he reported, which only grow.
func (r *Repository) FinishExerciseParticipants(ctx context.Context, runID uuid.UUID, commands map[uuid.UUID]int) error {
	if err := r.participants(ctx, runID).Where("status = ?", domain.ParticipantInProgress).Update("status", domain.ParticipantNotCompleted).Error; err != nil {
		return err
	}
	for student, n := range commands {
		if err := r.participants(ctx, runID).Where("student_id = ?", student).Update("commands", gorm.Expr("GREATEST(commands, ?)", n)).Error; err != nil {
			return err
		}
	}
	return nil
}

// ReopenExerciseParticipants takes who did not conclude back to IN_PROGRESS, when the round reopens.
func (r *Repository) ReopenExerciseParticipants(ctx context.Context, runID uuid.UUID) error {
	return r.participants(ctx, runID).Where("status = ?", domain.ParticipantNotCompleted).Update("status", domain.ParticipantInProgress).Error
}

type participantRow struct {
	StudentID     uuid.UUID `gorm:"column:student_id"`
	Name          string    `gorm:"column:name"`
	Status        string    `gorm:"column:status"`
	Commands      int       `gorm:"column:commands"`
	HelpRequested bool      `gorm:"column:help_requested"`
	TakenOver     bool      `gorm:"column:taken_over"`
}

// ListExerciseParticipants returns every student of the round with his row, by name.
func (r *Repository) ListExerciseParticipants(ctx context.Context, runID uuid.UUID) ([]domain.ExerciseParticipant, error) {
	var rows []participantRow
	err := r.db.Conn(ctx).Table("live_exercise_results r").
		Select("r.student_id, COALESCE(u.name, u.email) AS name, r.status, r.commands, r.help_requested, r.taken_over").
		Joins("INNER JOIN users u ON u.id = r.student_id").
		Where("r.run_id = ? AND r.deleted_at IS NULL", runID).Order("name, r.student_id").Scan(&rows).Error
	out := make([]domain.ExerciseParticipant, len(rows))
	for i, row := range rows {
		out[i] = domain.ExerciseParticipant(row)
	}
	return out, err
}

// SetExerciseResultVisible shows or hides the result of a round that ended, and tells whether it did: a running round, or one that does not
// exist, has no result to show.
func (r *Repository) SetExerciseResultVisible(ctx context.Context, id uuid.UUID, visible bool) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NOT NULL", id).Update("result_visible", visible)
	return res.RowsAffected > 0, res.Error
}

// SaveExerciseResult keeps the conclusion of a student in a round once, over his row (SPEC-071 RN-08): the row becomes COMPLETED with the time,
// the points, the attempts and the commands, and a student whose terminal the teacher took over gets 0 points whatever was asked (RN-07). When he
// had concluded, nothing changes and the conclusion that was kept comes back, with created false.
func (r *Repository) SaveExerciseResult(ctx context.Context, res *domain.LiveExerciseResult) (domain.LiveExerciseResult, bool, error) {
	if err := r.JoinExerciseRun(ctx, res.RunID, []uuid.UUID{res.StudentID}); err != nil {
		return domain.LiveExerciseResult{}, false, err
	}
	update := r.participants(ctx, res.RunID).Where("student_id = ? AND status <> ?", res.StudentID, domain.ParticipantCompleted).
		Updates(map[string]any{"status": domain.ParticipantCompleted, "completed_at": res.CompletedAt, "elapsed_seconds": res.ElapsedSeconds,
			"points": gorm.Expr("CASE WHEN taken_over THEN 0 ELSE ? END", res.Points), "attempts": res.Attempts,
			"commands": gorm.Expr("GREATEST(commands, ?)", res.Commands)})
	if update.Error != nil {
		return domain.LiveExerciseResult{}, false, update.Error
	}
	kept, err := r.FindExerciseResult(ctx, res.RunID, res.StudentID)
	if err != nil {
		return domain.LiveExerciseResult{}, false, err
	}
	if update.RowsAffected > 0 {
		*res = kept
	}
	return kept, update.RowsAffected > 0, nil
}

// FindExerciseResult returns the result of the student in the round, or ErrNoExerciseResult.
func (r *Repository) FindExerciseResult(ctx context.Context, runID, studentID uuid.UUID) (domain.LiveExerciseResult, error) {
	var res domain.LiveExerciseResult
	err := r.db.Conn(ctx).Where("run_id = ? AND student_id = ? AND status = ?", runID, studentID, domain.ParticipantCompleted).First(&res).Error
	return res, notFound(err, domain.ErrNoExerciseResult)
}

type exerciseResultRow struct {
	StudentID      uuid.UUID `gorm:"column:student_id"`
	Name           string    `gorm:"column:name"`
	CompletedAt    time.Time `gorm:"column:completed_at"`
	ElapsedSeconds int       `gorm:"column:elapsed_seconds"`
	Points         int       `gorm:"column:points"`
	Attempts       int       `gorm:"column:attempts"`
}

// ListExerciseResults returns the results of the round with the name of each student, the best first (the order of the scoreboard).
func (r *Repository) ListExerciseResults(ctx context.Context, runID uuid.UUID) ([]domain.ExerciseResultEntry, error) {
	var rows []exerciseResultRow
	err := r.db.Conn(ctx).Table("live_exercise_results r").
		Select("r.student_id, COALESCE(u.name, u.email) AS name, r.completed_at, r.elapsed_seconds, r.points, r.attempts").
		Joins("INNER JOIN users u ON u.id = r.student_id").
		Where("r.run_id = ? AND r.status = ? AND r.deleted_at IS NULL", runID, domain.ParticipantCompleted).
		Order("r.points DESC, r.elapsed_seconds, r.completed_at, r.student_id").Scan(&rows).Error
	out := make([]domain.ExerciseResultEntry, len(rows))
	for i, row := range rows {
		out[i] = domain.ExerciseResultEntry(row)
	}
	return out, err
}

type userNameRow struct {
	ID   uuid.UUID `gorm:"column:id"`
	Name string    `gorm:"column:name"`
}

// UserNames returns the name of each of the users (the e-mail of one who has none); an id that is nobody is left out.
func (r *Repository) UserNames(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []userNameRow
	err := r.db.Conn(ctx).Table("users").Select("id, COALESCE(name, email) AS name").Where("id IN ? AND deleted_at IS NULL", ids).Scan(&rows).Error
	for _, row := range rows {
		out[row.ID] = row.Name
	}
	return out, err
}

type pointsRow struct {
	StudentID uuid.UUID `gorm:"column:student_id"`
	Points    int       `gorm:"column:points"`
	Rounds    int       `gorm:"column:rounds"`
}

// ExercisePointsByStudent is the sum of the points of each student in the rounds of the rooms of the class, the most points first. It is what
// the gamification reads (SPEC-065 CA-11); a student with no result is not in it.
func (r *Repository) ExercisePointsByStudent(ctx context.Context, classID uuid.UUID) ([]domain.StudentExercisePoints, error) {
	var rows []pointsRow
	err := r.db.Conn(ctx).Table("live_exercise_results r").
		Select("r.student_id, SUM(r.points) AS points, COUNT(*) AS rounds").
		Joins("INNER JOIN live_exercise_runs x ON x.id = r.run_id AND x.deleted_at IS NULL").
		Joins("INNER JOIN live_classroom_sessions s ON s.id = x.session_id").
		Where("s.class_id = ? AND r.status = ? AND r.deleted_at IS NULL", classID, domain.ParticipantCompleted).
		Group("r.student_id").Order("points DESC, r.student_id").Scan(&rows).Error
	out := make([]domain.StudentExercisePoints, len(rows))
	for i, row := range rows {
		out[i] = domain.StudentExercisePoints(row)
	}
	return out, err
}
