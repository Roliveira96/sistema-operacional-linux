package repository

import (
	"context"
	"time"

	"github.com/google/uuid"

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
// first end, and the answer is false, so that only who ended it tells the room.
func (r *Repository) EndExerciseRun(ctx context.Context, id uuid.UUID, at time.Time, by string) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NULL", id).
		Updates(map[string]any{"ended_at": at, "ended_by": by})
	return res.RowsAffected > 0, res.Error
}

// SetExerciseResultVisible shows or hides the result of a round that ended, and tells whether it did: a running round, or one that does not
// exist, has no result to show.
func (r *Repository) SetExerciseResultVisible(ctx context.Context, id uuid.UUID, visible bool) (bool, error) {
	res := r.db.Conn(ctx).Model(&domain.LiveExerciseRun{}).Where("id = ? AND ended_at IS NOT NULL", id).Update("result_visible", visible)
	return res.RowsAffected > 0, res.Error
}

// SaveExerciseResult keeps the result of a student in a round once. When he already has one, nothing changes and the one that was kept comes
// back, with created false.
func (r *Repository) SaveExerciseResult(ctx context.Context, res *domain.LiveExerciseResult) (domain.LiveExerciseResult, bool, error) {
	if err := r.db.Conn(ctx).Create(res).Error; err != nil {
		if !isUnique(err) {
			return domain.LiveExerciseResult{}, false, err
		}
		kept, findErr := r.FindExerciseResult(ctx, res.RunID, res.StudentID)
		return kept, false, findErr
	}
	return *res, true, nil
}

// FindExerciseResult returns the result of the student in the round, or ErrNoExerciseResult.
func (r *Repository) FindExerciseResult(ctx context.Context, runID, studentID uuid.UUID) (domain.LiveExerciseResult, error) {
	var res domain.LiveExerciseResult
	err := r.db.Conn(ctx).Where("run_id = ? AND student_id = ?", runID, studentID).First(&res).Error
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
		Where("r.run_id = ? AND r.deleted_at IS NULL", runID).
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
		Where("s.class_id = ? AND r.deleted_at IS NULL", classID).
		Group("r.student_id").Order("points DESC, r.student_id").Scan(&rows).Error
	out := make([]domain.StudentExercisePoints, len(rows))
	for i, row := range rows {
		out[i] = domain.StudentExercisePoints(row)
	}
	return out, err
}
