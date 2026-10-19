package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- the guided practice of the lesson (SPEC-071) ----

// PauseExercise pauses the round that runs (paused) or resumes the paused one, and returns it (RN-01). The pause stops the timer and ends the
// takeover, which is told in Released; the resume puts the end after the time that was left and arms a timer for it.
func (s *Service) PauseExercise(ctx context.Context, actor Actor, sessionID uuid.UUID, paused bool) (ExerciseState, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return ExerciseState{}, err
	}
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseState{}, err
	}
	if !has {
		return ExerciseState{}, domain.ErrNoExerciseRun
	}
	now := s.now()
	var released *uuid.UUID
	if paused {
		if err := run.Pause(now); err != nil {
			return ExerciseState{}, err
		}
		changed, err := s.repo.PauseExerciseRun(ctx, run.ID, now)
		if err != nil {
			return ExerciseState{}, err
		}
		if !changed {
			return ExerciseState{}, domain.ErrExerciseEnded // the timer ended it a moment before
		}
		s.live.setExerciseRun(sessionID, run)
		s.live.disarmExercise(sessionID)
		released = s.live.releaseTakeover(sessionID, nil)
	} else {
		if err := run.Resume(now); err != nil {
			return ExerciseState{}, err
		}
		changed, err := s.repo.ResumeExerciseRun(ctx, run)
		if err != nil {
			return ExerciseState{}, err
		}
		if !changed {
			return ExerciseState{}, domain.ErrExerciseNotPaused
		}
		s.live.setExerciseRun(sessionID, run)
		s.live.disarmExercise(sessionID)
		s.armRoundTimer(run)
	}
	return ExerciseState{Run: run, Now: now, Participants: s.participantCount(sessionID), Released: released}, nil
}

// ExtendExercise gives the current round more minutes, from 1 to 30 and up to 60 in all (RN-02). A round that runs, or is paused, ends later. A
// round that ended and was not closed reopens: it runs again from now, the result is hidden and who did not conclude works again; its exercise
// must still be in the module of the lesson (domain.ErrExerciseUnavailable).
func (s *Service) ExtendExercise(ctx context.Context, actor Actor, sessionID uuid.UUID, minutes int) (ExerciseState, error) {
	session, err := s.decider(ctx, actor, sessionID)
	if err != nil {
		return ExerciseState{}, err
	}
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseState{}, err
	}
	if !has {
		return ExerciseState{}, domain.ErrNoExerciseRun
	}
	if !run.Running() && !run.Closed() && minutes >= 1 && minutes <= domain.MaxExerciseExtraMinutes {
		if s.exercises == nil || session.ActiveModuleID == nil {
			return ExerciseState{}, domain.ErrExerciseUnavailable
		}
		if _, err := s.exercises.Exercise(ctx, *session.ActiveModuleID, run.BlockID, run.ExerciseIndex); err != nil {
			return ExerciseState{}, err
		}
	}
	now := s.now()
	reopened, err := run.Extend(minutes, now)
	if err != nil {
		return ExerciseState{}, err
	}
	changed, err := s.repo.ExtendExerciseRun(ctx, run, reopened)
	if err != nil {
		return ExerciseState{}, err
	}
	if !changed {
		if reopened {
			return ExerciseState{}, domain.ErrExerciseClosed
		}
		return ExerciseState{}, domain.ErrExerciseEnded
	}
	if reopened {
		if err := s.repo.ReopenExerciseParticipants(ctx, run.ID); err != nil {
			return ExerciseState{}, err
		}
	}
	s.live.setExerciseRun(sessionID, run)
	if !run.Paused() {
		s.live.disarmExercise(sessionID)
		s.armRoundTimer(run)
	}
	return ExerciseState{Run: run, Now: now, Participants: s.participantCount(sessionID), Reopened: reopened}, nil
}

// CloseExercise is the class going back to the lesson (RN-04): the round that runs, or is paused, is ended by the teacher first (Ended), and the
// round is closed. A closed round has nothing to close (domain.ErrExerciseClosed).
func (s *Service) CloseExercise(ctx context.Context, actor Actor, sessionID uuid.UUID) (ExerciseState, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return ExerciseState{}, err
	}
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseState{}, err
	}
	if !has {
		return ExerciseState{}, domain.ErrNoExerciseRun
	}
	if run.Closed() {
		return ExerciseState{}, domain.ErrExerciseClosed
	}
	state := ExerciseState{Run: run, Now: s.now()}
	if run.Running() {
		ended, changed, err := s.endRound(ctx, run, s.now(), domain.EndedByTeacher, false)
		if err != nil {
			return ExerciseState{}, err
		}
		state, state.Ended = ended, changed
	}
	if err := s.closeRound(ctx, state.Run); err != nil {
		return ExerciseState{}, err
	}
	state.Run, _, _ = s.live.exerciseRun(sessionID)
	state.Participants = s.participantCount(sessionID)
	return state, nil
}

// TakeoverExercise takes over the terminal of the student (on) or gives it back (RN-05, RN-06). The teacher takes over only in a round that runs
// and is not paused, the student he watches, online and who did not conclude, one at a time; the mark that takes the points is kept before
// anything else. Giving back a student who is not taken over is domain.ErrNoTakeover.
func (s *Service) TakeoverExercise(ctx context.Context, actor Actor, sessionID, student uuid.UUID, on, online bool) (ExerciseTakeover, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return ExerciseTakeover{}, err
	}
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseTakeover{}, err
	}
	if !on {
		if s.live.releaseTakeover(sessionID, &student) == nil {
			return ExerciseTakeover{}, domain.ErrNoTakeover
		}
		return ExerciseTakeover{Student: student}, nil
	}
	switch {
	case !has || !run.Running():
		return ExerciseTakeover{}, domain.ErrNoExerciseRun
	case run.Paused():
		return ExerciseTakeover{}, domain.ErrExercisePaused
	case !online || !s.live.exerciseWatched(sessionID, &run.ID, student):
		return ExerciseTakeover{}, domain.ErrTakeoverUnavailable
	}
	if taken := s.live.takeoverOf(sessionID); taken != nil && *taken != student {
		return ExerciseTakeover{}, domain.ErrTakeoverBusy
	}
	if _, err := s.repo.FindExerciseResult(ctx, run.ID, student); err == nil {
		return ExerciseTakeover{}, domain.ErrTakeoverUnavailable // he concluded
	} else if !errors.Is(err, domain.ErrNoExerciseResult) {
		return ExerciseTakeover{}, err
	}
	if err := s.repo.MarkExerciseTakeover(ctx, run.ID, student); err != nil {
		return ExerciseTakeover{}, err
	}
	s.live.setTakeover(sessionID, student)
	names, err := s.repo.UserNames(ctx, []uuid.UUID{actor.UserID})
	if err != nil {
		return ExerciseTakeover{}, err
	}
	return ExerciseTakeover{Student: student, On: true, TeacherName: names[actor.UserID]}, nil
}

// TakeoverKeyAllowed tells whether a key of the teacher goes to the student: only to the one taken over, in the round that runs and is not paused.
func (s *Service) TakeoverKeyAllowed(sessionID, student uuid.UUID) bool {
	run, has, _ := s.live.exerciseRun(sessionID)
	if !has || !run.Running() || run.Paused() {
		return false
	}
	return s.ExerciseTakenOver(sessionID, student)
}

// ExerciseTakenOver tells whether the teacher has the terminal of the student now.
func (s *Service) ExerciseTakenOver(sessionID, student uuid.UUID) bool {
	taken := s.live.takeoverOf(sessionID)
	return taken != nil && *taken == student
}

// ReleaseTakeoverOf ends the takeover of the student, who left the room, and tells whether there was one.
func (s *Service) ReleaseTakeoverOf(sessionID, student uuid.UUID) bool {
	return s.live.releaseTakeover(sessionID, &student) != nil
}

// markExerciseHelp keeps that the student raised his hand during the round that runs (RN-08); out of a round nothing is kept.
func (s *Service) markExerciseHelp(ctx context.Context, sessionID, student uuid.UUID) error {
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil || !has || !run.Running() {
		return err
	}
	s.live.joinExercise(sessionID, student)
	return s.repo.MarkExerciseHelp(ctx, run.ID, student)
}
