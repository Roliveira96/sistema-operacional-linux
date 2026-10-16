package service_test

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-071: the repository double of the guided practice ----

func (f *fakeRepo) runAt(id uuid.UUID) *domain.LiveExerciseRun {
	for i := range f.exercise.runs {
		if f.exercise.runs[i].ID == id {
			return &f.exercise.runs[i]
		}
	}
	return nil
}

// participantRow is the row of the student in the round, a new one IN_PROGRESS when he has none.
func (f *fakeRepo) participantRow(key [2]uuid.UUID) domain.ExerciseParticipant {
	if f.exercise.participants == nil {
		f.exercise.participants = map[[2]uuid.UUID]domain.ExerciseParticipant{}
	}
	p, ok := f.exercise.participants[key]
	if !ok {
		p = domain.ExerciseParticipant{StudentID: key[1], Name: f.studentNames[key[1]], Status: domain.ParticipantInProgress}
	}
	return p
}

func (f *fakeRepo) PauseExerciseRun(_ context.Context, id uuid.UUID, at time.Time) (bool, error) {
	run := f.runAt(id)
	if run == nil || run.Pause(at) != nil {
		return false, nil
	}
	return true, nil
}

func (f *fakeRepo) ResumeExerciseRun(_ context.Context, r domain.LiveExerciseRun) (bool, error) {
	run := f.runAt(r.ID)
	if run == nil || !run.Paused() || !run.Running() {
		return false, nil
	}
	run.PausedAt, run.PausedSeconds, run.EndsAt = nil, r.PausedSeconds, r.EndsAt
	return true, nil
}

func (f *fakeRepo) ExtendExerciseRun(_ context.Context, r domain.LiveExerciseRun, reopen bool) (bool, error) {
	run := f.runAt(r.ID)
	if run == nil || run.Closed() || run.Running() == reopen {
		return false, nil
	}
	if reopen {
		for _, other := range f.exercise.runs {
			if other.SessionID == run.SessionID && other.ID != run.ID && other.Running() {
				return false, domain.ErrExerciseRunning
			}
		}
		run.EndedAt, run.EndedBy, run.ResultVisible = nil, nil, false
	}
	run.DurationSeconds, run.EndsAt = r.DurationSeconds, r.EndsAt
	return true, nil
}

func (f *fakeRepo) CloseExerciseRun(_ context.Context, id uuid.UUID, at time.Time) (bool, error) {
	run := f.runAt(id)
	if run == nil || run.Close(at) != nil {
		return false, nil
	}
	return true, nil
}

func (f *fakeRepo) JoinExerciseRun(_ context.Context, runID uuid.UUID, students []uuid.UUID) error {
	for _, s := range students {
		key := [2]uuid.UUID{runID, s}
		p := f.participantRow(key)
		f.exercise.participants[key] = p
	}
	return nil
}

func (f *fakeRepo) MarkExerciseHelp(_ context.Context, runID, student uuid.UUID) error {
	key := [2]uuid.UUID{runID, student}
	p := f.participantRow(key)
	p.HelpRequested = true
	f.exercise.participants[key] = p
	return nil
}

func (f *fakeRepo) MarkExerciseTakeover(_ context.Context, runID, student uuid.UUID) error {
	key := [2]uuid.UUID{runID, student}
	p := f.participantRow(key)
	p.TakenOver = true
	f.exercise.participants[key] = p
	return nil
}

func (f *fakeRepo) FinishExerciseParticipants(_ context.Context, runID uuid.UUID, commands map[uuid.UUID]int) error {
	for key, p := range f.exercise.participants {
		if key[0] != runID {
			continue
		}
		p.Commands = max(p.Commands, commands[key[1]])
		if p.Status == domain.ParticipantInProgress {
			p.Status = domain.ParticipantNotCompleted
		}
		f.exercise.participants[key] = p
	}
	return nil
}

func (f *fakeRepo) ReopenExerciseParticipants(_ context.Context, runID uuid.UUID) error {
	for key, p := range f.exercise.participants {
		if key[0] == runID && p.Status == domain.ParticipantNotCompleted {
			p.Status = domain.ParticipantInProgress
			f.exercise.participants[key] = p
		}
	}
	return nil
}

func (f *fakeRepo) ListExerciseParticipants(_ context.Context, runID uuid.UUID) ([]domain.ExerciseParticipant, error) {
	var out []domain.ExerciseParticipant
	for key, p := range f.exercise.participants {
		if key[0] == runID {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StudentID.String() < out[j].StudentID.String() })
	return out, nil
}
