package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-071: the guided practice of the lesson ----

func (x *exWorld) run() domain.LiveExerciseRun { return x.repo.exercise.runs[len(x.repo.exercise.runs)-1] }

func (x *exWorld) participant(student uuid.UUID) domain.ExerciseParticipant {
	return x.repo.exercise.participants[[2]uuid.UUID{x.run().ID, student}]
}

// watchAndTakeOver watches the student and takes his terminal over.
func (x *exWorld) watchAndTakeOver(t *testing.T, student uuid.UUID) service.ExerciseTakeover {
	t.Helper()
	ctx := context.Background()
	_, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &student)
	require.NoError(t, err)
	got, err := x.svc.TakeoverExercise(ctx, x.teacher, x.room.ID, student, true, true)
	require.NoError(t, err)
	return got
}

// Covers SPEC-071 RN-08 and CA-12: every student online when the round starts, and who joins in the middle, has his row in the round.
func TestGuided_ParticipantsHaveARow(t *testing.T) {
	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, nil)
	newcomer := x.newStudent("Davi")
	x.svc.JoinExercise(x.room.ID, newcomer.UserID)
	for _, id := range append(x.everybody(), newcomer.UserID) {
		assert.Equal(t, domain.ParticipantInProgress, x.participant(id).Status, "%s", x.repo.studentNames[id])
	}
}

// Covers SPEC-071 RN-01 and CA-01: the teacher pauses: the timer stops, the answer and the progress are refused; on resume the end is the time that
// was left after it, with a new timer, and the round takes answers again.
func TestGuided_PauseAndResume(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, minutes(5))

	x.now = x.now.Add(2 * time.Minute)
	paused, err := x.svc.PauseExercise(ctx, x.teacher, x.room.ID, true)
	require.NoError(t, err)
	assert.Equal(t, domain.ExerciseStatusPaused, paused.Run.Status())
	assert.Empty(t, x.timers.running(), "the timer stopped")
	assert.Equal(t, domain.ExerciseStatusPaused, x.run().Status(), "kept")

	_, err = x.submit(x.ana, st.Run.ID, `"pass"`)
	assert.ErrorIs(t, err, domain.ErrExercisePaused)
	_, err = x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 1, Total: 2})
	assert.ErrorIs(t, err, domain.ErrExercisePaused)
	_, err = x.svc.PauseExercise(ctx, x.teacher, x.room.ID, true)
	assert.ErrorIs(t, err, domain.ErrExercisePaused, "paused already")

	x.now = x.now.Add(time.Minute)
	resumed, err := x.svc.PauseExercise(ctx, x.teacher, x.room.ID, false)
	require.NoError(t, err)
	assert.Equal(t, domain.ExerciseStatusRunning, resumed.Run.Status())
	assert.Equal(t, st.Run.EndsAt.Add(time.Minute), resumed.Run.EndsAt)
	assert.Equal(t, 60, resumed.Run.PausedSeconds)
	running := x.timers.running()
	require.Len(t, running, 1)
	assert.Equal(t, 3*time.Minute, running[0].d, "the 3 minutes that were left")
	_, err = x.svc.PauseExercise(ctx, x.teacher, x.room.ID, false)
	assert.ErrorIs(t, err, domain.ErrExerciseNotPaused)

	x.now = x.now.Add(time.Minute)
	res := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	require.True(t, res.Passed)
	assert.Equal(t, 180, res.Result.ElapsedSeconds, "4 minutes, 1 of them paused")

	for name, who := range map[string]service.Actor{"a student": x.ana, "another teacher": x.other} {
		_, err := x.svc.PauseExercise(ctx, who, x.room.ID, true)
		assert.ErrorIs(t, err, domain.ErrForbidden, name)
	}
}

// Covers SPEC-071 RN-01: the timer of a round that was paused does not end it, and the one of the resume does, at the new end.
func TestGuided_TimerAfterThePause(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, minutes(2))
	x.now = x.now.Add(time.Minute)
	_, err := x.svc.PauseExercise(ctx, x.teacher, x.room.ID, true)
	require.NoError(t, err)
	x.timers.timers[0].f() // as if the old timer had fired anyway
	assert.True(t, x.run().Running(), "a paused round is not ended by the timer")

	x.now = x.now.Add(10 * time.Minute)
	_, err = x.svc.PauseExercise(ctx, x.teacher, x.room.ID, false)
	require.NoError(t, err)
	x.now = x.now.Add(time.Minute)
	x.timers.fire(len(x.timers.timers) - 1)
	assert.Equal(t, domain.ExerciseStatusEnded, x.run().Status())
	assert.Equal(t, domain.EndedByTimer, *x.run().EndedBy)
	require.Len(t, x.events, 1)
}

// Covers SPEC-071 RN-02 and CA-02: more minutes push the end and the timer; the minutes and the total are checked; who is not the teacher cannot.
func TestGuided_ExtendRunning(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, minutes(5))
	x.now = x.now.Add(time.Minute)
	got, err := x.svc.ExtendExercise(ctx, x.teacher, x.room.ID, 2)
	require.NoError(t, err)
	assert.False(t, got.Reopened)
	assert.Equal(t, st.Run.EndsAt.Add(2*time.Minute), got.Run.EndsAt)
	assert.Equal(t, 420, x.run().DurationSeconds, "kept")
	running := x.timers.running()
	require.Len(t, running, 1)
	assert.Equal(t, 6*time.Minute, running[0].d)

	x.timers.timers[0].f() // the timer of the old end
	assert.True(t, x.run().Running(), "the old end does not end the round")

	for _, n := range []int{0, 31} {
		_, err := x.svc.ExtendExercise(ctx, x.teacher, x.room.ID, n)
		assert.ErrorIs(t, err, domain.ErrInvalidExerciseExtension)
	}
	_, err = x.svc.ExtendExercise(ctx, x.teacher, x.room.ID, 30)
	require.NoError(t, err)
	_, err = x.svc.ExtendExercise(ctx, x.teacher, x.room.ID, 30)
	assert.ErrorIs(t, err, domain.ErrExerciseTooLong)
	_, err = x.svc.ExtendExercise(ctx, x.ana, x.room.ID, 1)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

// Covers SPEC-071 RN-02, CA-03 and RN-08: more minutes for a round that ended reopen it: it runs again from now with a timer, the result is hidden,
// who did not conclude is IN_PROGRESS again and who concluded keeps his result.
func TestGuided_ExtendReopens(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, minutes(2))
	x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	_, err := x.svc.RecordExerciseProgress(ctx, x.room.ID, x.bruno.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 1, Total: 2, Commands: 4})
	require.NoError(t, err)
	x.now = x.now.Add(2 * time.Minute)
	x.timers.fire(0)
	_, err = x.svc.RevealExercise(ctx, x.teacher, x.room.ID, true)
	require.NoError(t, err)
	assert.Equal(t, domain.ParticipantNotCompleted, x.participant(x.bruno.UserID).Status)
	assert.Equal(t, 4, x.participant(x.bruno.UserID).Commands, "the commands he reported are kept at the end")

	x.now = x.now.Add(30 * time.Second)
	got, err := x.svc.ExtendExercise(ctx, x.teacher, x.room.ID, 3)
	require.NoError(t, err)
	assert.True(t, got.Reopened)
	assert.Equal(t, domain.ExerciseStatusRunning, x.run().Status())
	assert.False(t, x.run().ResultVisible)
	assert.Equal(t, x.now.Add(3*time.Minute), x.run().EndsAt)
	assert.Equal(t, domain.ParticipantInProgress, x.participant(x.bruno.UserID).Status)
	assert.Equal(t, domain.ParticipantCompleted, x.participant(x.ana.UserID).Status)
	running := x.timers.running()
	require.Len(t, running, 1)
	assert.Equal(t, 3*time.Minute, running[0].d)
	res := x.mustSubmit(t, x.bruno, st.Run.ID, `"pass"`)
	assert.True(t, res.Created, "Bruno concludes in the reopened round")
	again := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.False(t, again.Created, "Ana keeps her result")
}

// Covers SPEC-071 RN-02 and CA-03: a round does not reopen after the class went back to the lesson, when another one started after it, when the
// lesson ended or when its block is no longer in the module.
func TestGuided_ReopenRefusals(t *testing.T) {
	ctx := context.Background()

	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, nil)
	_, err := x.svc.CloseExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	_, err = x.svc.ExtendExercise(ctx, x.teacher, x.room.ID, 2)
	assert.ErrorIs(t, err, domain.ErrExerciseClosed)

	y := exerciseRoom(t)
	y.startRound(t, y.easyIndex, nil)
	_, err = y.svc.EndExercise(ctx, y.teacher, y.room.ID)
	require.NoError(t, err)
	delete(y.fx.specs, exerciseKey{y.module, y.block, y.easyIndex})
	_, err = y.svc.ExtendExercise(ctx, y.teacher, y.room.ID, 2)
	assert.ErrorIs(t, err, domain.ErrExerciseUnavailable, "the block is no longer in the module")
	assert.False(t, y.run().Running())

	z := exerciseRoom(t)
	z.startRound(t, z.easyIndex, nil)
	_, err = z.svc.EndSession(ctx, z.teacher, z.class, z.room.ID)
	require.NoError(t, err)
	_, err = z.svc.ExtendExercise(ctx, z.teacher, z.room.ID, 2)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "the lesson ended")
	assert.Equal(t, domain.ExerciseStatusClosed, z.run().Status(), "the end of the lesson closes the round")

	_, err = exerciseRoom(t).svc.ExtendExercise(ctx, x.teacher, uuid.New(), 2)
	assert.Error(t, err)
}

// Covers SPEC-071 RN-04 and CA-05: going back to the lesson ends the round that runs (by the teacher) and closes it; a round that ended is only
// closed; there is nothing to close twice or with no round.
func TestGuided_Close(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	_, err := x.svc.CloseExercise(ctx, x.teacher, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrNoExerciseRun)

	x.startRound(t, x.easyIndex, nil)
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	require.NoError(t, err)
	got, err := x.svc.CloseExercise(ctx, x.ana, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	got, err = x.svc.CloseExercise(ctx, x.teacher, x.room.ID)
	require.NoError(t, err)
	assert.True(t, got.Ended, "this call ended the round")
	assert.Equal(t, domain.EndedByTeacher, *got.Run.EndedBy)
	assert.Equal(t, domain.ExerciseStatusClosed, got.Run.Status())
	assert.Equal(t, domain.ExerciseStatusClosed, x.run().Status(), "kept")
	require.NotNil(t, got.Unwatched)
	assert.Equal(t, x.ana.UserID, *got.Unwatched)
	assert.Empty(t, x.timers.running())
	_, err = x.svc.CloseExercise(ctx, x.teacher, x.room.ID)
	assert.ErrorIs(t, err, domain.ErrExerciseClosed)
	_, err = x.svc.RevealExercise(ctx, x.teacher, x.room.ID, true)
	assert.NoError(t, err, "the result is still shown after going back")

	y := exerciseRoom(t)
	y.startRound(t, y.easyIndex, nil)
	_, err = y.svc.PauseExercise(ctx, y.teacher, y.room.ID, true)
	require.NoError(t, err)
	got, err = y.svc.CloseExercise(ctx, y.teacher, y.room.ID)
	require.NoError(t, err)
	assert.True(t, got.Ended, "a paused round is ended too")

	z := exerciseRoom(t)
	z.startRound(t, z.easyIndex, nil)
	_, err = z.svc.EndExercise(ctx, z.teacher, z.room.ID)
	require.NoError(t, err)
	got, err = z.svc.CloseExercise(ctx, z.teacher, z.room.ID)
	require.NoError(t, err)
	assert.False(t, got.Ended, "it had ended already")
	assert.Equal(t, domain.ExerciseStatusClosed, got.Run.Status())
}

// Covers SPEC-071 RN-05, CA-07 and RN-07: the teacher takes over the terminal of the student he watches: the mark is kept before any key, the
// keys of that student are allowed and nobody else's, and his name goes with it.
func TestGuided_TakeoverStarts(t *testing.T) {
	x := exerciseRoom(t)
	x.repo.studentNames[x.teacher.UserID] = "Profa. Sediane"
	x.startRound(t, x.easyIndex, nil)
	got := x.watchAndTakeOver(t, x.bruno.UserID)
	assert.Equal(t, x.bruno.UserID, got.Student)
	assert.True(t, got.On)
	assert.Equal(t, "Profa. Sediane", got.TeacherName)
	assert.True(t, x.participant(x.bruno.UserID).TakenOver, "kept before any key")
	assert.True(t, x.svc.TakeoverKeyAllowed(x.room.ID, x.bruno.UserID))
	assert.False(t, x.svc.TakeoverKeyAllowed(x.room.ID, x.ana.UserID))
	assert.True(t, x.svc.ExerciseTakenOver(x.room.ID, x.bruno.UserID))

	again, err := x.svc.TakeoverExercise(context.Background(), x.teacher, x.room.ID, x.bruno.UserID, true, true)
	require.NoError(t, err, "taking over the same student again changes nothing")
	assert.True(t, again.On)
}

// Covers SPEC-071 RN-05 and CA-09: the takeover is refused for who is not the teacher, with no round or a round that is not RUNNING, for a student
// who is not the one watched, offline, who concluded, or with another takeover on.
func TestGuided_TakeoverRefusals(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	take := func(who service.Actor, student uuid.UUID, online bool) error {
		_, err := x.svc.TakeoverExercise(ctx, who, x.room.ID, student, true, online)
		return err
	}
	assert.ErrorIs(t, take(x.teacher, x.ana.UserID, true), domain.ErrNoExerciseRun)
	st := x.startRound(t, x.easyIndex, nil)
	assert.ErrorIs(t, take(x.ana, x.ana.UserID, true), domain.ErrForbidden)
	assert.ErrorIs(t, take(x.teacher, x.ana.UserID, true), domain.ErrTakeoverUnavailable, "Ana is not watched")
	_, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.ana.UserID)
	require.NoError(t, err)
	assert.ErrorIs(t, take(x.teacher, x.ana.UserID, false), domain.ErrTakeoverUnavailable, "Ana is offline")
	x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.ErrorIs(t, take(x.teacher, x.ana.UserID, true), domain.ErrTakeoverUnavailable, "Ana concluded")
	assert.False(t, x.participant(x.ana.UserID).TakenOver, "nothing was marked")

	x.watchAndTakeOver(t, x.bruno.UserID)
	_, err = x.svc.TakeoverExercise(ctx, x.teacher, x.room.ID, x.carla.UserID, false, true)
	assert.ErrorIs(t, err, domain.ErrNoTakeover, "Carla is not the one taken over")

	_, err = x.svc.PauseExercise(ctx, x.teacher, x.room.ID, true)
	require.NoError(t, err)
	_, err = x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.carla.UserID)
	require.NoError(t, err)
	assert.ErrorIs(t, take(x.teacher, x.carla.UserID, true), domain.ErrExercisePaused)
}

// Covers SPEC-071 RN-06 and CA-07: the takeover ends when the teacher gives the control back, watches another student or stops watching, the
// student leaves, the round pauses, ends or closes; the one that ended is told, and the keys are no longer allowed.
func TestGuided_TakeoverEnds(t *testing.T) {
	ctx := context.Background()
	cases := map[string]func(x *exWorld) *uuid.UUID{
		"given back": func(x *exWorld) *uuid.UUID {
			got, err := x.svc.TakeoverExercise(ctx, x.teacher, x.room.ID, x.bruno.UserID, false, true)
			require.NoError(t, err)
			assert.False(t, got.On)
			return &got.Student
		},
		"another student watched": func(x *exWorld) *uuid.UUID {
			w, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, &x.carla.UserID)
			require.NoError(t, err)
			return w.Released
		},
		"no student watched": func(x *exWorld) *uuid.UUID {
			w, err := x.svc.WatchExercise(ctx, x.teacher, x.room.ID, nil)
			require.NoError(t, err)
			return w.Released
		},
		"the student left": func(x *exWorld) *uuid.UUID {
			if x.svc.ReleaseTakeoverOf(x.room.ID, x.bruno.UserID) {
				return &x.bruno.UserID
			}
			return nil
		},
		"paused": func(x *exWorld) *uuid.UUID {
			st, err := x.svc.PauseExercise(ctx, x.teacher, x.room.ID, true)
			require.NoError(t, err)
			return st.Released
		},
		"ended": func(x *exWorld) *uuid.UUID {
			st, err := x.svc.EndExercise(ctx, x.teacher, x.room.ID)
			require.NoError(t, err)
			return st.Released
		},
		"closed": func(x *exWorld) *uuid.UUID {
			st, err := x.svc.CloseExercise(ctx, x.teacher, x.room.ID)
			require.NoError(t, err)
			return st.Released
		},
		"by the timer": func(x *exWorld) *uuid.UUID {
			x.now = x.now.Add(10 * time.Minute)
			x.timers.fire(0)
			require.Len(t, x.events, 1)
			return x.events[0].state.Released
		},
	}
	for name, end := range cases {
		x := exerciseRoom(t)
		x.startRound(t, x.easyIndex, nil)
		x.watchAndTakeOver(t, x.bruno.UserID)
		released := end(x)
		require.NotNil(t, released, name)
		assert.Equal(t, x.bruno.UserID, *released, name)
		assert.False(t, x.svc.TakeoverKeyAllowed(x.room.ID, x.bruno.UserID), name)
		assert.False(t, x.svc.ExerciseTakenOver(x.room.ID, x.bruno.UserID), name)
		assert.True(t, x.participant(x.bruno.UserID).TakenOver, "%s: the mark stays for the points", name)
	}

	x := exerciseRoom(t)
	x.startRound(t, x.easyIndex, nil)
	assert.False(t, x.svc.ReleaseTakeoverOf(x.room.ID, x.ana.UserID), "nobody was taken over")
}

// Covers SPEC-071 RN-07 and CA-08: the student who had his terminal taken over concludes with 0 points, during the takeover or after it; the
// student who only got messages and hints keeps his points.
func TestGuided_TakeoverTakesThePoints(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.hardIndex, minutes(5))
	x.watchAndTakeOver(t, x.bruno.UserID)
	during := x.mustSubmit(t, x.bruno, st.Run.ID, `"pass"`)
	require.True(t, during.Passed)
	assert.Equal(t, 0, during.Result.Points, "concluded during the takeover")

	x.watchAndTakeOver(t, x.carla.UserID) // watching Carla ends the takeover of Bruno
	_, err := x.svc.TakeoverExercise(ctx, x.teacher, x.room.ID, x.carla.UserID, false, true)
	require.NoError(t, err)
	after := x.mustSubmit(t, x.carla, st.Run.ID, `"pass"`)
	assert.Equal(t, 0, after.Result.Points, "concluded by herself after the takeover")

	_, err = x.svc.SendChat(ctx, x.teacher, x.room.ID, &x.ana.UserID, "Use o mkdir")
	require.NoError(t, err)
	_, err = x.svc.SendChat(ctx, x.teacher, x.room.ID, nil, "Dica para todos")
	require.NoError(t, err)
	helped := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.Equal(t, 45, helped.Result.Points, "messages do not take the points")
}

// Covers SPEC-071 RN-09 and RN-10: the progress carries the commands, which only grow, and the moment of the last command, which only changes when
// they grow; a number out of range is refused.
func TestGuided_ProgressCommands(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	report := func(commands int) (service.ExerciseProgress, error) {
		return x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 0, Total: 2, Commands: commands})
	}
	first, err := report(2)
	require.NoError(t, err)
	assert.Equal(t, 2, first.Commands)
	require.NotNil(t, first.LastCommandAt)
	assert.Equal(t, x.now, *first.LastCommandAt)

	x.now = x.now.Add(10 * time.Second)
	same, err := report(2)
	require.NoError(t, err)
	assert.Equal(t, first.LastCommandAt, same.LastCommandAt, "no new command")
	smaller, err := report(1)
	require.NoError(t, err)
	assert.Equal(t, 2, smaller.Commands, "a smaller number is ignored")

	x.now = x.now.Add(10 * time.Second)
	more, err := report(3)
	require.NoError(t, err)
	assert.Equal(t, x.now, *more.LastCommandAt)

	_, err = report(-1)
	assert.ErrorIs(t, err, domain.ErrInvalidExerciseProgress)
	_, err = report(10001)
	assert.ErrorIs(t, err, domain.ErrInvalidExerciseProgress)

	res := x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	assert.Equal(t, 3, res.Result.Commands, "the conclusion keeps the commands")
}

// Covers SPEC-071 RN-08: a student who raises his hand during the round is marked as having asked for help; out of a round nothing is marked.
func TestGuided_HandMarksHelp(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	_, err := x.svc.RaiseHand(ctx, x.room.ID, x.carla.UserID, "")
	require.NoError(t, err)
	x.startRound(t, x.easyIndex, nil)
	assert.False(t, x.participant(x.carla.UserID).HelpRequested, "the hand was raised before the round")
	_, err = x.svc.RaiseHand(ctx, x.room.ID, x.ana.UserID, "Não sei")
	require.NoError(t, err)
	assert.True(t, x.participant(x.ana.UserID).HelpRequested)
	assert.False(t, x.participant(x.bruno.UserID).HelpRequested)
}

// Covers SPEC-071 CA-13: the state of the panel has, for each student, the commands, the last command, the status, whether he asked for help, and
// the takeover (had one, has it on now); the round has its status and the time paused.
func TestGuided_StateForThePanel(t *testing.T) {
	ctx := context.Background()
	x := exerciseRoom(t)
	st := x.startRound(t, x.easyIndex, nil)
	_, err := x.svc.RecordExerciseProgress(ctx, x.room.ID, x.ana.UserID, service.ExerciseProgressInput{RunID: st.Run.ID, Met: 1, Total: 2, Commands: 5})
	require.NoError(t, err)
	_, err = x.svc.RaiseHand(ctx, x.room.ID, x.carla.UserID, "")
	require.NoError(t, err)
	x.watchAndTakeOver(t, x.bruno.UserID)
	x.mustSubmit(t, x.ana, st.Run.ID, `"pass"`)
	_, err = x.svc.PauseExercise(ctx, x.teacher, x.room.ID, true)
	require.NoError(t, err)

	got, err := x.svc.ExerciseOf(ctx, x.room.ID, true)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, domain.ExerciseStatusPaused, got.Run.Status())
	entries := map[uuid.UUID]service.ExerciseEntry{}
	for _, e := range got.Entries {
		entries[e.StudentID] = e
	}
	require.Len(t, entries, 3)
	assert.Equal(t, 5, entries[x.ana.UserID].Commands)
	require.NotNil(t, entries[x.ana.UserID].LastCommandAt)
	assert.Equal(t, domain.ParticipantCompleted, entries[x.ana.UserID].Status)
	assert.True(t, entries[x.carla.UserID].HelpRequested)
	assert.Equal(t, domain.ParticipantInProgress, entries[x.carla.UserID].Status)
	assert.True(t, entries[x.bruno.UserID].TakenOver)
	assert.False(t, entries[x.bruno.UserID].TakeoverOn, "the pause ended the takeover")
}
