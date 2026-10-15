package domain

import (
	"errors"
	"sort"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// The exercise of the lesson (SPEC-065): the levels of an exercise of a block of the module, who ended a round, and the limits of the round and
// of what the students send during it.
const (
	DifficultyEasy   = "EASY"
	DifficultyMedium = "MEDIUM"
	DifficultyHard   = "HARD"

	EndedByTimer   = "TIMER"
	EndedByTeacher = "TEACHER"
	EndedBySession = "SESSION"

	// The minutes of a round: from 1 to 60, 5 when the teacher does not say.
	DefaultExerciseMinutes = 5
	MinExerciseMinutes     = 1
	MaxExerciseMinutes     = 60

	// MaxExerciseProgressTotal is the most conditions that the progress of a student counts, and MaxExerciseLastLength the most characters of
	// the last command that he typed.
	MaxExerciseProgressTotal = 100
	MaxExerciseLastLength    = 200

	// ExerciseSubmitGrace is how long after the end of a round the server still takes a submission, for one that was in transit.
	ExerciseSubmitGrace = 2 * time.Second
	// ExerciseSubmitInterval is the least time between two submissions of a student, and MaxExerciseStateBytes the largest state he may send.
	ExerciseSubmitInterval = 2 * time.Second
	MaxExerciseStateBytes  = 2 << 20

	// The bonus of speed is up to this fraction of the base points, in proportion to the time that was left.
	exerciseBonusDivisor = 2
)

// Errors of the exercise of the lesson.
var (
	ErrInvalidExerciseMinutes  = errors.New("the time of the exercise must be from 1 to 60 minutes")
	ErrExerciseUnavailable     = errors.New("the exercise is not in the module of the lesson, or has no condition to be graded")
	ErrExerciseRunning         = errors.New("an exercise round is in progress")
	ErrNoExerciseRun           = errors.New("there is no exercise round")
	ErrExerciseEnded           = errors.New("the exercise round has ended")
	ErrInvalidExerciseState    = errors.New("the state sent is not a machine of the simulator")
	ErrInvalidExerciseProgress = errors.New("the progress must have met and total from 0 to 100, met up to total, and the last command with up to 200 characters and no control characters")
	ErrNoExerciseResult        = errors.New("the student has no result in this exercise round")
	ErrInvalidExerciseEnd      = errors.New("a round ends by the timer, by the teacher or by the lesson")
	ErrNotInExerciseRun        = errors.New("the student is not in this exercise round")
)

// ValidExerciseDifficulty tells whether the level is one of the three.
func ValidExerciseDifficulty(difficulty string) bool {
	return ExerciseBasePoints(difficulty) > 0
}

// ExerciseBasePoints is what an exercise of the level is worth: 10, 20 or 30. An unknown level is worth nothing.
func ExerciseBasePoints(difficulty string) int {
	switch difficulty {
	case DifficultyEasy:
		return 10
	case DifficultyMedium:
		return 20
	case DifficultyHard:
		return 30
	}
	return 0
}

// ExercisePoints are the points of a student who concluded with `remaining` of the `duration` of the round still left: the base of the level
// plus a bonus of speed, up to half of the base, in proportion to the time left and rounded down (SPEC-065 section 3.1). The first instant gives
// 1.5 times the base; the last, and any moment after the end, give the base. The time left is kept between 0 and the duration, so that a clock
// that went back cannot give more than the first instant.
func ExercisePoints(difficulty string, duration, remaining time.Duration) int {
	base := ExerciseBasePoints(difficulty)
	if base == 0 || duration <= 0 {
		return base
	}
	remaining = min(max(remaining, 0), duration)
	// integer arithmetic: base × 0.5 × remaining ÷ duration, rounded down, with no float to round it the wrong way
	return base + int(int64(base)*int64(remaining)/(exerciseBonusDivisor*int64(duration)))
}

// ExerciseMinutes is the time of a round in minutes: the one the teacher chose, from 1 to 60, or 5 when he did not say.
func ExerciseMinutes(minutes *int) (int, error) {
	if minutes == nil {
		return DefaultExerciseMinutes, nil
	}
	if *minutes < MinExerciseMinutes || *minutes > MaxExerciseMinutes {
		return 0, ErrInvalidExerciseMinutes
	}
	return *minutes, nil
}

// ValidExerciseProgress tells whether met and total are from 0 to 100, with met up to total.
func ValidExerciseProgress(met, total int) bool {
	return met >= 0 && met <= total && total <= MaxExerciseProgressTotal
}

// NormalizeExerciseLast checks the last command that a student typed: valid UTF-8, up to 200 characters (counted by character) and no control
// character at all. It is plain text and stays as it came.
func NormalizeExerciseLast(last string) (string, error) {
	if !utf8.ValidString(last) || utf8.RuneCountInString(last) > MaxExerciseLastLength {
		return "", ErrInvalidExerciseProgress
	}
	for _, r := range last {
		if unicode.IsControl(r) {
			return "", ErrInvalidExerciseProgress
		}
	}
	return last, nil
}

// LiveExerciseRun is a round of the exercise of the lesson: one exercise of a block of the module, given to the whole room with a time. The
// title and the level are kept as they were when it started.
type LiveExerciseRun struct {
	database.Model
	SessionID       uuid.UUID
	BlockID         uuid.UUID
	ExerciseIndex   int
	Title           string
	Difficulty      string
	DurationSeconds int
	StartedAt       time.Time
	EndsAt          time.Time
	EndedAt         *time.Time
	EndedBy         *string
	ResultVisible   bool
}

// TableName maps LiveExerciseRun to its table.
func (LiveExerciseRun) TableName() string { return "live_exercise_runs" }

// StartExerciseRun is a round that starts now, for the given minutes (already checked with ExerciseMinutes).
func StartExerciseRun(sessionID, blockID uuid.UUID, index int, title, difficulty string, minutes int, now time.Time) LiveExerciseRun {
	d := time.Duration(minutes) * time.Minute
	return LiveExerciseRun{
		SessionID: sessionID, BlockID: blockID, ExerciseIndex: index, Title: title, Difficulty: difficulty,
		DurationSeconds: int(d / time.Second), StartedAt: now, EndsAt: now.Add(d),
	}
}

// Running tells whether the round has not ended.
func (r LiveExerciseRun) Running() bool { return r.EndedAt == nil }

// Duration is the time that the round was given.
func (r LiveExerciseRun) Duration() time.Duration {
	return time.Duration(r.DurationSeconds) * time.Second
}

// Expired tells whether the round still runs after its time was up: the server ends it at endsAt, and finding one like this means that it
// was not ended yet.
func (r LiveExerciseRun) Expired(now time.Time) bool { return r.Running() && !now.Before(r.EndsAt) }

// End takes the round from running to ended, with the moment and the reason. Ending twice keeps the first end (ErrExerciseEnded).
func (r *LiveExerciseRun) End(at time.Time, by string) error {
	if by != EndedByTimer && by != EndedByTeacher && by != EndedBySession {
		return ErrInvalidExerciseEnd
	}
	if !r.Running() {
		return ErrExerciseEnded
	}
	r.EndedAt, r.EndedBy = &at, &by
	return nil
}

// ShowResult shows or hides the result to the students. Only a round that ended has a result to show (ErrExerciseRunning).
func (r *LiveExerciseRun) ShowResult(visible bool) error {
	if r.Running() {
		return ErrExerciseRunning
	}
	r.ResultVisible = visible
	return nil
}

// AcceptsAnswerAt tells whether the round still takes the answer of a student at `now`: while it runs, and up to ExerciseSubmitGrace after it
// ended, for the one that was in transit (ErrExerciseEnded after that). A running round that is expired is ended by the service before this.
func (r LiveExerciseRun) AcceptsAnswerAt(now time.Time) error {
	if r.EndedAt != nil && now.After(r.EndedAt.Add(ExerciseSubmitGrace)) {
		return ErrExerciseEnded
	}
	return nil
}

// ElapsedAt is the time that a student took, in whole seconds from the start of the round; never negative.
func (r LiveExerciseRun) ElapsedAt(completedAt time.Time) int {
	return max(int(completedAt.Sub(r.StartedAt)/time.Second), 0)
}

// PointsAt are the points of a student who concluded at that moment: the time left is what is between the moment and the end of the time of
// the round, and none when it was over.
func (r LiveExerciseRun) PointsAt(completedAt time.Time) int {
	return ExercisePoints(r.Difficulty, r.Duration(), r.EndsAt.Sub(completedAt))
}

// LiveExerciseResult is the conclusion of one student in one round: when, how long it took, the points and how many times he sent his state to
// be graded. A student has at most one in a round, and a round only keeps the ones who concluded.
type LiveExerciseResult struct {
	database.Model
	RunID          uuid.UUID
	StudentID      uuid.UUID
	CompletedAt    time.Time
	ElapsedSeconds int
	Points         int
	Attempts       int
}

// TableName maps LiveExerciseResult to its table.
func (LiveExerciseResult) TableName() string { return "live_exercise_results" }

// ExerciseResultEntry is a result with the name of the student.
type ExerciseResultEntry struct {
	StudentID      uuid.UUID
	Name           string
	CompletedAt    time.Time
	ElapsedSeconds int
	Points         int
	Attempts       int
}

// SortScoreboard puts the results in the order of the scoreboard: by points, from the highest, then by time, from the shortest. A tie of both
// is told by the moment of the conclusion and then by the student, so that the order is always the same.
func SortScoreboard(list []ExerciseResultEntry) {
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		switch {
		case a.Points != b.Points:
			return a.Points > b.Points
		case a.ElapsedSeconds != b.ElapsedSeconds:
			return a.ElapsedSeconds < b.ElapsedSeconds
		case !a.CompletedAt.Equal(b.CompletedAt):
			return a.CompletedAt.Before(b.CompletedAt)
		}
		return a.StudentID.String() < b.StudentID.String()
	})
}

// StudentExercisePoints is what a student made in the rounds of a class: the sum of his points and in how many rounds he concluded. It is
// what the gamification reads (SPEC-065 CA-11).
type StudentExercisePoints struct {
	StudentID uuid.UUID
	Points    int
	Rounds    int
}
