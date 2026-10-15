package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ExerciseSpec is the exercise of a block of the module, as the room needs it to start a round: its title and its level.
type ExerciseSpec struct {
	Title      string
	Difficulty string
}

// Exercises is what the service needs from the teaching modules to give an exercise to the room and to grade it. The composition root gives
// it the content of the modules and the corrector of the machine, so that the room reads neither the repository nor the code of another
// module (SPEC-065 section 3.2).
type Exercises interface {
	// Exercise returns the exercise `index` of the block of exercises `blockID` of the module. It returns domain.ErrExerciseUnavailable
	// when the block is not of the module or is not a block of exercises, the index does not exist, or the exercise is not practical or has
	// no condition of finalization to be graded.
	Exercise(ctx context.Context, moduleID, blockID uuid.UUID, index int) (ExerciseSpec, error)
	// Grade tells whether the state of a machine meets the conditions of that exercise, as the module has them. It returns
	// domain.ErrInvalidExerciseState when the state is not a machine of the simulator, and domain.ErrExerciseUnavailable as Exercise does.
	Grade(ctx context.Context, moduleID, blockID uuid.UUID, index int, snapshot json.RawMessage) (bool, error)
}

// AfterFunc runs f after d and returns what cancels it. It is the timer of the rounds; time.AfterFunc is the default, and a test puts its own.
type AfterFunc func(d time.Duration, f func()) (stop func())

func timeAfter(d time.Duration, f func()) func() {
	t := time.AfterFunc(d, f)
	return func() { t.Stop() }
}

// WithExercises sets the reader and corrector of the exercises of the modules. Without it, no round starts.
func (s *Service) WithExercises(e Exercises) *Service {
	s.exercises = e
	return s
}

// WithExerciseTimer sets the timer that ends the rounds; it is time.AfterFunc unless a test puts its own.
func (s *Service) WithExerciseTimer(after AfterFunc) *Service {
	s.after = after
	return s
}

// WithExerciseEvents sets what runs when the service ends a round by itself, with no teacher asking: by the timer, by the end of the lesson or
// when it finds the time of a round up (onEnded, to tell the room), and when it cannot (onFailed, to log it).
func (s *Service) WithExerciseEvents(onEnded func(sessionID uuid.UUID, state ExerciseState), onFailed func(sessionID uuid.UUID, err error)) *Service {
	s.onExerciseEnded, s.onExerciseFailed = onEnded, onFailed
	return s
}

// ExerciseStartInput is what the teacher gives to start a round: the block and the exercise of its group, the minutes (nil is the default),
// and who is online in the room at that moment, who are the students of the round.
type ExerciseStartInput struct {
	BlockID uuid.UUID
	Index   int
	Minutes *int
	Online  []uuid.UUID
}

// ExerciseState is the state of a round at a moment. Participants is how many students were in it. Results are the ones who concluded, in the
// order of the scoreboard; Entries, only when asked for, are the students of the round with their progress and result (the panel's reading).
// Unwatched is the student whose terminal the teacher was watching when the round ended: his observation ended with it.
type ExerciseState struct {
	Run          domain.LiveExerciseRun
	Now          time.Time
	Participants int
	Results      []domain.ExerciseResultEntry
	Entries      []ExerciseEntry
	Unwatched    *uuid.UUID
}

// ExerciseEntry is a student of the round for the panel: his last progress (zero when he sent none), his attempts and, if he concluded, his
// result.
type ExerciseEntry struct {
	StudentID  uuid.UUID
	Name       string
	Met, Total int
	Last       string
	At         *time.Time
	Attempts   int
	Result     *domain.ExerciseResultEntry
}

// ExerciseWatch is the change of the observation: the student that the teacher watched before and the one he watches now (nil: none).
type ExerciseWatch struct {
	Previous *uuid.UUID
	Current  *uuid.UUID
}

// ExerciseProgressInput is the report of a student: the round, how many conditions he met of how many, and the last command he typed.
type ExerciseProgressInput struct {
	RunID      uuid.UUID
	Met, Total int
	Last       string
}

// ExerciseProgress is a report that was taken, with the moment of the server.
type ExerciseProgress struct {
	RunID      uuid.UUID
	StudentID  uuid.UUID
	Met, Total int
	Last       string
	At         time.Time
}

// ExerciseSubmitInput is the state that a student sends to be graded, for the round that he says.
type ExerciseSubmitInput struct {
	RunID    uuid.UUID
	Snapshot json.RawMessage
}

// ExerciseSubmitResult is the answer to a state that was sent. Passed says whether it met the conditions; Result is the conclusion of the
// student, when he has one: Created tells that this very submission made it, which is when the panel is told. Run is the round and Name the
// student's name.
type ExerciseSubmitResult struct {
	Passed  bool
	Result  *domain.LiveExerciseResult
	Created bool
	Run     domain.LiveExerciseRun
	Name    string
}

// currentRound returns the round of the room: the one that runs or, with none, the last one that ended; has is false for a room that never had
// one. Memory has it after the first reading, so the reports of the students never reach the repository. A round that still runs after its
// time was up (the timer did not end it: the server was down, or it failed) is ended here, by the timer, at the end of its time, and the room
// is told. A round that runs gets its timer.
func (s *Service) currentRound(ctx context.Context, sessionID uuid.UUID) (run domain.LiveExerciseRun, has bool, err error) {
	run, has, known := s.live.exerciseRun(sessionID)
	if !known {
		loaded, err := s.repo.CurrentExerciseRun(ctx, sessionID)
		switch {
		case errors.Is(err, domain.ErrNoExerciseRun):
			s.live.loadExerciseRun(sessionID, nil)
			return domain.LiveExerciseRun{}, false, nil
		case err != nil:
			return domain.LiveExerciseRun{}, false, err
		}
		s.live.loadExerciseRun(sessionID, &loaded)
		run, has, _ = s.live.exerciseRun(sessionID) // what memory has now, which is newer if somebody was faster
	}
	if !has {
		return domain.LiveExerciseRun{}, false, nil
	}
	if run.Expired(s.now()) {
		st, _, err := s.endRound(ctx, run, run.EndsAt, domain.EndedByTimer, true)
		return st.Run, true, err
	}
	if run.Running() {
		s.armRoundTimer(run)
	}
	return run, true, nil
}

// endRound ends a round that runs, with the moment and the reason, and tells whether this call did it: when somebody ended it first (the
// teacher and the timer at the same moment), what they did stays, and nobody is told twice. With notify the room is told by the hook; the
// teacher who ended it is answered by the state instead.
func (s *Service) endRound(ctx context.Context, run domain.LiveExerciseRun, at time.Time, by string, notify bool) (ExerciseState, bool, error) {
	changed, err := s.repo.EndExerciseRun(ctx, run.ID, at, by)
	if err != nil {
		return ExerciseState{Run: run}, false, err
	}
	if !changed {
		fresh, err := s.repo.FindExerciseRun(ctx, run.ID)
		if err != nil {
			return ExerciseState{Run: run}, false, err
		}
		s.live.setExerciseRun(run.SessionID, fresh)
		return ExerciseState{Run: fresh, Now: s.now()}, false, nil
	}
	if err := run.End(at, by); err != nil {
		return ExerciseState{Run: run}, false, err
	}
	unwatched := s.live.endExercise(run.SessionID, run)
	state := ExerciseState{Run: run, Now: s.now(), Participants: s.participantCount(run.SessionID), Unwatched: unwatched}
	if notify && s.onExerciseEnded != nil {
		s.onExerciseEnded(run.SessionID, state)
	}
	return state, true, nil
}

// endRoundWithLesson ends the round that runs because the lesson ends.
func (s *Service) endRoundWithLesson(ctx context.Context, sessionID uuid.UUID) error {
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil || !has || !run.Running() {
		return err
	}
	_, _, err = s.endRound(ctx, run, s.now(), domain.EndedBySession, true)
	return err
}

// armRoundTimer gives the round that runs a timer that ends it at the end of its time; once, however many times it is asked.
func (s *Service) armRoundTimer(run domain.LiveExerciseRun) {
	s.live.armExercise(run.SessionID, run.ID, func() func() {
		return s.after(max(run.EndsAt.Sub(s.now()), 0), func() { s.expireRound(run.SessionID, run.ID) })
	})
}

// expireRound is what the timer does: it ends the round by the timer, at the end of its time, if it still runs. A failure is told to the hook;
// the round is then found over and ended on the next reading.
func (s *Service) expireRound(sessionID, runID uuid.UUID) {
	ctx := context.Background()
	run, has, _ := s.live.exerciseRun(sessionID)
	if !has || run.ID != runID {
		var err error
		if run, err = s.repo.FindExerciseRun(ctx, runID); err != nil {
			s.exerciseFailed(sessionID, err)
			return
		}
	}
	if !run.Running() {
		return
	}
	if _, _, err := s.endRound(ctx, run, run.EndsAt, domain.EndedByTimer, true); err != nil {
		s.exerciseFailed(sessionID, err)
	}
}

func (s *Service) exerciseFailed(sessionID uuid.UUID, err error) {
	if s.onExerciseFailed != nil {
		s.onExerciseFailed(sessionID, err)
	}
}

func (s *Service) participantCount(sessionID uuid.UUID) int {
	participants, _, _ := s.live.exerciseCrowd(sessionID)
	return len(participants)
}

// StartExercise starts a round of the exercise `Index` of the block, in the module of the lesson, for the minutes the teacher chose (5 when he did
// not), and returns it. The block, the index and the conditions are checked in the module, so the round only starts for an exercise that can be
// graded; the title and the level are kept as they are now. Only one round runs in a room (domain.ErrExerciseRunning), and the module must be
// chosen (domain.ErrModuleNotSelected). The round ends at its end, by a timer that this call arms (SPEC-065 section 3.1).
func (s *Service) StartExercise(ctx context.Context, actor Actor, sessionID uuid.UUID, in ExerciseStartInput) (ExerciseState, error) {
	session, err := s.decider(ctx, actor, sessionID)
	if err != nil {
		return ExerciseState{}, err
	}
	if session.ActiveModuleID == nil {
		return ExerciseState{}, domain.ErrModuleNotSelected
	}
	minutes, err := domain.ExerciseMinutes(in.Minutes)
	if err != nil {
		return ExerciseState{}, err
	}
	if s.exercises == nil || in.Index < 0 {
		return ExerciseState{}, domain.ErrExerciseUnavailable
	}
	if run, has, err := s.currentRound(ctx, sessionID); err != nil {
		return ExerciseState{}, err
	} else if has && run.Running() {
		return ExerciseState{}, domain.ErrExerciseRunning
	}
	spec, err := s.exercises.Exercise(ctx, *session.ActiveModuleID, in.BlockID, in.Index)
	if err != nil {
		return ExerciseState{}, err
	}
	title := strings.TrimSpace(spec.Title)
	if title == "" || !domain.ValidExerciseDifficulty(spec.Difficulty) {
		return ExerciseState{}, domain.ErrExerciseUnavailable
	}
	run := domain.StartExerciseRun(sessionID, in.BlockID, in.Index, title, spec.Difficulty, minutes, s.now())
	if err := s.repo.CreateExerciseRun(ctx, &run); err != nil {
		return ExerciseState{}, err
	}
	s.live.startExercise(sessionID, run, in.Online)
	s.armRoundTimer(run)
	return ExerciseState{Run: run, Now: s.now(), Participants: s.participantCount(sessionID)}, nil
}

// EndExercise ends the round that runs, by the teacher, and returns it with the student whose terminal was being watched. With no round, or
// with one that ended, there is nothing to end (domain.ErrNoExerciseRun).
func (s *Service) EndExercise(ctx context.Context, actor Actor, sessionID uuid.UUID) (ExerciseState, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return ExerciseState{}, err
	}
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseState{}, err
	}
	if !has || !run.Running() {
		return ExerciseState{}, domain.ErrNoExerciseRun
	}
	state, changed, err := s.endRound(ctx, run, s.now(), domain.EndedByTeacher, false)
	if err != nil {
		return ExerciseState{}, err
	}
	if !changed {
		return ExerciseState{}, domain.ErrExerciseEnded // the timer ended it a moment before
	}
	return state, nil
}

// RevealExercise shows the result of the round to the students, or hides it, and returns the round with the scoreboard. Only a round that ended
// has a result to show (domain.ErrExerciseRunning while it runs, domain.ErrNoExerciseRun with none).
func (s *Service) RevealExercise(ctx context.Context, actor Actor, sessionID uuid.UUID, visible bool) (ExerciseState, error) {
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
	if err := run.ShowResult(visible); err != nil {
		return ExerciseState{}, err
	}
	if _, err := s.repo.SetExerciseResultVisible(ctx, run.ID, visible); err != nil {
		return ExerciseState{}, err
	}
	s.live.setExerciseRun(sessionID, run)
	return s.roundState(ctx, run, false)
}

// WatchExercise sets the student whose terminal the teacher watches, one at a time, and says who he watched before; with nil it stops. The
// student must be in the round that runs (domain.ErrNoExerciseRun, domain.ErrNotInExerciseRun).
func (s *Service) WatchExercise(ctx context.Context, actor Actor, sessionID uuid.UUID, student *uuid.UUID) (ExerciseWatch, error) {
	if _, err := s.decider(ctx, actor, sessionID); err != nil {
		return ExerciseWatch{}, err
	}
	if student == nil {
		return ExerciseWatch{Previous: s.live.watchExercise(sessionID, nil)}, nil
	}
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseWatch{}, err
	}
	if !has || !run.Running() {
		return ExerciseWatch{}, domain.ErrNoExerciseRun
	}
	if !s.live.isExerciseParticipant(sessionID, *student) {
		return ExerciseWatch{}, domain.ErrNotInExerciseRun
	}
	return ExerciseWatch{Previous: s.live.watchExercise(sessionID, student), Current: student}, nil
}

// ExerciseScreenAllowed tells whether the picture of a terminal is taken from the student: only from the one the teacher watches, in the round
// that runs. The picture of anybody else is discarded.
func (s *Service) ExerciseScreenAllowed(sessionID, student, runID uuid.UUID) bool {
	return s.live.exerciseWatched(sessionID, &runID, student)
}

// ExerciseWatching tells whether the teacher watches the student in the round that runs: for the student who comes back to the room, who is told
// again that he is watched.
func (s *Service) ExerciseWatching(sessionID, student uuid.UUID) bool {
	return s.live.exerciseWatched(sessionID, nil, student)
}

// JoinExercise puts the students in the round that runs, for who comes into the room in the middle of it; with none running, nothing happens.
func (s *Service) JoinExercise(sessionID uuid.UUID, students ...uuid.UUID) {
	s.live.joinExercise(sessionID, students...)
}

// RecordExerciseProgress keeps in memory how far a student is, and returns the report with the moment of the server. It is never saved. The
// report must be of the round that runs (domain.ErrNoExerciseRun, or domain.ErrExerciseEnded for the round that ended) and valid
// (domain.ErrInvalidExerciseProgress).
func (s *Service) RecordExerciseProgress(ctx context.Context, sessionID, student uuid.UUID, in ExerciseProgressInput) (ExerciseProgress, error) {
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil {
		return ExerciseProgress{}, err
	}
	if !has || run.ID != in.RunID {
		return ExerciseProgress{}, domain.ErrNoExerciseRun
	}
	if !run.Running() {
		return ExerciseProgress{}, domain.ErrExerciseEnded
	}
	if !domain.ValidExerciseProgress(in.Met, in.Total) {
		return ExerciseProgress{}, domain.ErrInvalidExerciseProgress
	}
	last, err := domain.NormalizeExerciseLast(in.Last)
	if err != nil {
		return ExerciseProgress{}, err
	}
	at := s.now()
	s.live.recordExerciseProgress(sessionID, student, exerciseProgress{met: in.Met, total: in.Total, last: last, at: at})
	return ExerciseProgress{RunID: run.ID, StudentID: student, Met: in.Met, Total: in.Total, Last: last, At: at}, nil
}

// ExerciseOf returns the state of the round of the room for who connects: the one that runs or the last that ended, nil when the room never
// had one. With progress, it also lists the students of the round with their progress and result (the panel's reading).
func (s *Service) ExerciseOf(ctx context.Context, sessionID uuid.UUID, withProgress bool) (*ExerciseState, error) {
	run, has, err := s.currentRound(ctx, sessionID)
	if err != nil || !has {
		return nil, err
	}
	state, err := s.roundState(ctx, run, withProgress)
	if err != nil {
		return nil, err
	}
	return &state, nil
}

// roundState reads the results of the round and, from memory, who is in it; the scoreboard is in the order of the domain whatever the repository
// gives. With progress it also builds the entries, by name.
func (s *Service) roundState(ctx context.Context, run domain.LiveExerciseRun, withProgress bool) (ExerciseState, error) {
	results, err := s.repo.ListExerciseResults(ctx, run.ID)
	if err != nil {
		return ExerciseState{}, err
	}
	domain.SortScoreboard(results)
	participants, progress, attempts := s.live.exerciseCrowd(run.SessionID)
	// Whoever concluded is in the round, even if the memory of who was online was lost with a restart.
	crowd := map[uuid.UUID]struct{}{}
	for _, id := range participants {
		crowd[id] = struct{}{}
	}
	concluded := make(map[uuid.UUID]*domain.ExerciseResultEntry, len(results))
	for i := range results {
		crowd[results[i].StudentID] = struct{}{}
		concluded[results[i].StudentID] = &results[i]
	}
	state := ExerciseState{Run: run, Now: s.now(), Results: results, Participants: len(crowd)}
	if !withProgress {
		return state, nil
	}

	var unnamed []uuid.UUID
	for id := range crowd {
		if concluded[id] == nil {
			unnamed = append(unnamed, id)
		}
	}
	names, err := s.repo.UserNames(ctx, unnamed)
	if err != nil {
		return ExerciseState{}, err
	}
	state.Entries = make([]ExerciseEntry, 0, len(crowd))
	for id := range crowd {
		entry := ExerciseEntry{StudentID: id, Name: names[id], Attempts: attempts[id]}
		if p, ok := progress[id]; ok {
			at := p.at
			entry.Met, entry.Total, entry.Last, entry.At = p.met, p.total, p.last, &at
		}
		if r := concluded[id]; r != nil {
			entry.Name, entry.Attempts, entry.Result = r.Name, r.Attempts, r
		}
		state.Entries = append(state.Entries, entry)
	}
	sort.Slice(state.Entries, func(i, j int) bool {
		a, b := state.Entries[i], state.Entries[j]
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.StudentID.String() < b.StudentID.String()
	})
	return state, nil
}

// SubmitExercise grades the state that a student sent for the round, with the conditions of the exercise that the module of the lesson has
// (never what the client says), and keeps his conclusion once. Only a student admitted to the open room of the class sends (domain.ErrForbidden,
// domain.ErrNoActiveSession, domain.ErrNotAdmitted), for the current round of the room (domain.ErrNoExerciseRun) while it runs and for 2 seconds
// after it ended (domain.ErrExerciseEnded). A student who already concluded gets his result again and nothing changes; a state that is not a
// machine of the simulator is refused and is not an attempt; every other state counts as an attempt, and the one that passes carries the
// attempts so far. The time and the points are those of the moment the request arrived (SPEC-065 section 3.1).
func (s *Service) SubmitExercise(ctx context.Context, actor Actor, classID uuid.UUID, in ExerciseSubmitInput) (ExerciseSubmitResult, error) {
	now := s.now()
	if actor.Role != authn.RoleStudent {
		return ExerciseSubmitResult{}, domain.ErrForbidden
	}
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return ExerciseSubmitResult{}, err
	}
	session, err := s.repo.FindActiveSession(ctx, classID)
	if errors.Is(err, domain.ErrSessionNotFound) {
		return ExerciseSubmitResult{}, domain.ErrNoActiveSession
	}
	if err != nil {
		return ExerciseSubmitResult{}, err
	}
	if err := s.requireAdmitted(ctx, session.ID, actor.UserID); err != nil {
		return ExerciseSubmitResult{}, err
	}
	run, has, err := s.currentRound(ctx, session.ID)
	if err != nil {
		return ExerciseSubmitResult{}, err
	}
	if !has || run.ID != in.RunID {
		return ExerciseSubmitResult{}, domain.ErrNoExerciseRun
	}
	if err := run.AcceptsAnswerAt(now); err != nil {
		return ExerciseSubmitResult{}, err
	}
	if kept, err := s.repo.FindExerciseResult(ctx, run.ID, actor.UserID); err == nil {
		return ExerciseSubmitResult{Passed: true, Result: &kept, Run: run}, nil
	} else if !errors.Is(err, domain.ErrNoExerciseResult) {
		return ExerciseSubmitResult{}, err
	}
	if s.exercises == nil || session.ActiveModuleID == nil {
		return ExerciseSubmitResult{}, domain.ErrExerciseUnavailable
	}
	passed, err := s.exercises.Grade(ctx, *session.ActiveModuleID, run.BlockID, run.ExerciseIndex, in.Snapshot)
	if err != nil {
		return ExerciseSubmitResult{}, err
	}
	attempts := s.live.countExerciseAttempt(session.ID, actor.UserID)
	s.live.joinExercise(session.ID, actor.UserID)
	if !passed {
		return ExerciseSubmitResult{Run: run}, nil
	}
	res := domain.LiveExerciseResult{RunID: run.ID, StudentID: actor.UserID, CompletedAt: now.Truncate(time.Microsecond), // the precision of the column
		ElapsedSeconds: run.ElapsedAt(now), Points: run.PointsAt(now), Attempts: attempts}
	saved, created, err := s.repo.SaveExerciseResult(ctx, &res)
	if err != nil {
		return ExerciseSubmitResult{}, err
	}
	out := ExerciseSubmitResult{Passed: true, Result: &saved, Created: created, Run: run}
	if created {
		names, err := s.repo.UserNames(ctx, []uuid.UUID{actor.UserID})
		if err != nil {
			return ExerciseSubmitResult{}, err
		}
		out.Name = names[actor.UserID]
	}
	return out, nil
}
