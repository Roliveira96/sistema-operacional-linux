package service

import (
	"maps"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// What a room keeps in memory of its exercise (SPEC-065): the round as it was last seen, so that the progress of the students, which arrives
// every 2 seconds from each one, never asks the repository anything; the timer of the round; who is in the round; the progress and the attempts
// of each student; and the student whose terminal the teacher watches. None of it is saved except the round and the results, which the
// repository keeps. It lives while the room is open.
type exerciseMemory struct {
	// known tells that the round of the room was read: run is the current one, or nil when the room has none.
	known bool
	run   *domain.LiveExerciseRun
	// timerRun is the round that the timer was armed for, and stop cancels it.
	timerRun uuid.UUID
	stop     func()

	participants map[uuid.UUID]struct{}
	progress     map[uuid.UUID]exerciseProgress
	attempts     map[uuid.UUID]int
	watching     *uuid.UUID
	// takeover is the student whose terminal the teacher took over now (SPEC-071)
	takeover *uuid.UUID
}

// exerciseProgress is the last report of a student, with the most commands he reported and when that number last grew (SPEC-071 RN-09).
type exerciseProgress struct {
	met, total    int
	last          string
	at            time.Time
	commands      int
	lastCommandAt *time.Time
}

func (m *exerciseMemory) running() bool { return m.run != nil && m.run.Running() }

// exerciseRun returns the round of the room that memory has. known is false when the room was never read, and has is false when it was read and
// has no round.
func (l *liveStates) exerciseRun(id uuid.UUID) (run domain.LiveExerciseRun, has, known bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok || !st.exercise.known {
		return domain.LiveExerciseRun{}, false, false
	}
	if st.exercise.run == nil {
		return domain.LiveExerciseRun{}, false, true
	}
	return *st.exercise.run, true, true
}

// loadExerciseRun remembers the round that the repository gave (nil: none), unless something already told the room: a round that started or
// ended in the meantime is newer than what was read.
func (l *liveStates) loadExerciseRun(id uuid.UUID, run *domain.LiveExerciseRun) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	if !m.known {
		m.known, m.run = true, cloneRun(run)
	}
}

// setExerciseRun puts the round in place of the one that memory has; the students and the progress stay.
func (l *liveStates) setExerciseRun(id uuid.UUID, run domain.LiveExerciseRun) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	m.known, m.run = true, cloneRun(&run)
}

func cloneRun(run *domain.LiveExerciseRun) *domain.LiveExerciseRun {
	if run == nil {
		return nil
	}
	c := *run
	return &c
}

// startExercise begins the memory of a new round: nobody but who was online, no progress, no attempts, nobody watched.
func (l *liveStates) startExercise(id uuid.UUID, run domain.LiveExerciseRun, online []uuid.UUID) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	if m.stop != nil {
		m.stop()
	}
	*m = exerciseMemory{known: true, run: &run, participants: map[uuid.UUID]struct{}{}, progress: map[uuid.UUID]exerciseProgress{}, attempts: map[uuid.UUID]int{}}
	for _, student := range online {
		m.participants[student] = struct{}{}
	}
}

// armExercise starts the timer of the round, once: start is called only when none is armed for the round yet.
func (l *liveStates) armExercise(id, runID uuid.UUID, start func() (stop func())) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	if m.timerRun == runID {
		return
	}
	if m.stop != nil {
		m.stop()
	}
	m.timerRun, m.stop = runID, start()
}

// endExercise puts the ended round in memory, stops its timer and ends the observation and the takeover; it returns the student who was being
// watched and the one who was taken over.
func (l *liveStates) endExercise(id uuid.UUID, run domain.LiveExerciseRun) (watched, released *uuid.UUID) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	m.known, m.run = true, cloneRun(&run)
	if m.stop != nil {
		m.stop()
		m.stop = nil
	}
	m.timerRun = uuid.Nil
	watched, released = m.watching, m.takeover
	m.watching, m.takeover = nil, nil
	return watched, released
}

// disarmExercise stops the timer of the round, so that the next arming starts a new one: the end changed (SPEC-071).
func (l *liveStates) disarmExercise(id uuid.UUID) {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	if m.stop != nil {
		m.stop()
		m.stop = nil
	}
	m.timerRun = uuid.Nil
}

// takeoverOf is the student whose terminal the teacher took over, nil when none.
func (l *liveStates) takeoverOf(id uuid.UUID) *uuid.UUID {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok || st.exercise.takeover == nil {
		return nil
	}
	s := *st.exercise.takeover
	return &s
}

// setTakeover keeps the student taken over.
func (l *liveStates) setTakeover(id, student uuid.UUID) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.of(id).exercise.takeover = &student
}

// releaseTakeover ends the takeover, if the student (any, with nil) is the one taken over, and returns who was.
func (l *liveStates) releaseTakeover(id uuid.UUID, student *uuid.UUID) *uuid.UUID {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok || st.exercise.takeover == nil || (student != nil && *st.exercise.takeover != *student) {
		return nil
	}
	was := st.exercise.takeover
	st.exercise.takeover = nil
	return was
}

// exerciseCommands are the commands that each student reported in the round.
func (l *liveStates) exerciseCommands(id uuid.UUID) map[uuid.UUID]int {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := map[uuid.UUID]int{}
	if st, ok := l.rooms[id]; ok {
		for student, p := range st.exercise.progress {
			out[student] = p.commands
		}
	}
	return out
}

// joinExercise puts the students in the round that runs and returns it; with none running, nobody joins.
func (l *liveStates) joinExercise(id uuid.UUID, students ...uuid.UUID) *domain.LiveExerciseRun {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok || !st.exercise.running() {
		return nil
	}
	m := &st.exercise
	if m.participants == nil {
		m.participants = map[uuid.UUID]struct{}{}
	}
	for _, student := range students {
		m.participants[student] = struct{}{}
	}
	return cloneRun(m.run)
}

// recordExerciseProgress keeps the last report of the student, who is then in the round, and returns it as kept: the commands only grow, and the
// moment of the last command is the moment of the first report or of the report in which they grew.
func (l *liveStates) recordExerciseProgress(id, student uuid.UUID, p exerciseProgress) exerciseProgress {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	if m.participants == nil {
		m.participants, m.progress, m.attempts = map[uuid.UUID]struct{}{}, map[uuid.UUID]exerciseProgress{}, map[uuid.UUID]int{}
	}
	m.participants[student] = struct{}{}
	prev, had := m.progress[student]
	switch {
	case !had || p.commands > prev.commands:
		at := p.at
		p.lastCommandAt = &at
	default:
		p.commands, p.lastCommandAt = prev.commands, prev.lastCommandAt
	}
	m.progress[student] = p
	return p
}

// countExerciseAttempt counts one more state of the student sent to be graded, and returns how many he has sent.
func (l *liveStates) countExerciseAttempt(id, student uuid.UUID) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	if m.attempts == nil {
		m.participants, m.progress, m.attempts = map[uuid.UUID]struct{}{}, map[uuid.UUID]exerciseProgress{}, map[uuid.UUID]int{}
	}
	m.attempts[student]++
	return m.attempts[student]
}

// isExerciseParticipant tells whether the student is in the round.
func (l *liveStates) isExerciseParticipant(id, student uuid.UUID) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return false
	}
	_, in := st.exercise.participants[student]
	return in
}

// watchExercise sets the student that the teacher watches (nil: none) and returns the one that he watched before.
func (l *liveStates) watchExercise(id uuid.UUID, student *uuid.UUID) *uuid.UUID {
	l.mu.Lock()
	defer l.mu.Unlock()
	m := &l.of(id).exercise
	previous := m.watching
	m.watching = nil
	if student != nil {
		s := *student
		m.watching = &s
	}
	return previous
}

// exerciseWatched tells whether the student is the one that the teacher watches in the round that runs; with a runID, in that round.
func (l *liveStates) exerciseWatched(id uuid.UUID, runID *uuid.UUID, student uuid.UUID) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return false
	}
	m := &st.exercise
	return m.running() && (runID == nil || m.run.ID == *runID) && m.watching != nil && *m.watching == student
}

// exerciseCrowd returns copies of who is in the round, the progress and the attempts of each.
func (l *liveStates) exerciseCrowd(id uuid.UUID) (participants []uuid.UUID, progress map[uuid.UUID]exerciseProgress, attempts map[uuid.UUID]int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	st, ok := l.rooms[id]
	if !ok {
		return nil, nil, nil
	}
	m := &st.exercise
	for student := range m.participants {
		participants = append(participants, student)
	}
	return participants, maps.Clone(m.progress), maps.Clone(m.attempts)
}
