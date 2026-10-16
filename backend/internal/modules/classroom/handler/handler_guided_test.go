package handler_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-071: the guided practice of the lesson ----

const (
	typeExPause    = "live:exercise:pause"
	typeExPaused   = "live:exercise:paused"
	typeExExtend   = "live:exercise:extend"
	typeExExtended = "live:exercise:extended"
	typeExClose    = "live:exercise:close"
	typeExClosed   = "live:exercise:closed"
	typeExTakeover = "live:exercise:takeover"
	typeExKey      = "live:exercise:key"
)

// guidedTypes are the messages that the server sends in the guided practice.
var guidedTypes = []string{typeExPaused, typeExExtended, typeExClosed, typeExTakeover, typeExKey}

// takeoverOf is who the double has taken over now, and released hands back the takeover as the service does when something ends it.
func (d *exerciseDouble) release() *uuid.UUID {
	was := d.takeover
	d.takeover = nil
	return was
}

func (f *fakeService) PauseExercise(_ context.Context, _ service.Actor, _ uuid.UUID, paused bool) (service.ExerciseState, error) {
	f.record("exercise:pause")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.run == nil {
		return service.ExerciseState{}, domain.ErrNoExerciseRun
	}
	var err error
	if paused {
		err = d.run.Pause(d.at())
	} else {
		err = d.run.Resume(d.at())
	}
	if err != nil {
		return service.ExerciseState{}, err
	}
	st := *d.state(false)
	if paused {
		st.Released = d.release()
	}
	return st, nil
}

func (f *fakeService) ExtendExercise(_ context.Context, _ service.Actor, _ uuid.UUID, minutes int) (service.ExerciseState, error) {
	f.record("exercise:extend")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.run == nil {
		return service.ExerciseState{}, domain.ErrNoExerciseRun
	}
	reopened, err := d.run.Extend(minutes, d.at())
	if err != nil {
		return service.ExerciseState{}, err
	}
	st := *d.state(false)
	st.Reopened = reopened
	return st, nil
}

func (f *fakeService) CloseExercise(_ context.Context, _ service.Actor, _ uuid.UUID) (service.ExerciseState, error) {
	f.record("exercise:close")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.run == nil {
		return service.ExerciseState{}, domain.ErrNoExerciseRun
	}
	ended := false
	if d.run.Running() {
		_ = d.run.End(d.at(), domain.EndedByTeacher)
		ended = true
	}
	if err := d.run.Close(d.at()); err != nil {
		return service.ExerciseState{}, err
	}
	st := *d.state(false)
	st.Ended, st.Released = ended, d.release()
	if ended {
		st.Unwatched, d.watching = d.watching, nil
	}
	return st, nil
}

func (f *fakeService) TakeoverExercise(_ context.Context, _ service.Actor, _ uuid.UUID, student uuid.UUID, on, online bool) (service.ExerciseTakeover, error) {
	f.record("exercise:takeover")
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	d.takeoverOnline = append(d.takeoverOnline, online)
	if !on {
		if d.takeover == nil || *d.takeover != student {
			return service.ExerciseTakeover{}, domain.ErrNoTakeover
		}
		d.takeover = nil
		return service.ExerciseTakeover{Student: student}, nil
	}
	if !d.running() || d.watching == nil || *d.watching != student || !online {
		return service.ExerciseTakeover{}, domain.ErrTakeoverUnavailable
	}
	id := student
	d.takeover = &id
	return service.ExerciseTakeover{Student: student, On: true, TeacherName: "Profa. Sediane"}, nil
}

func (f *fakeService) TakeoverKeyAllowed(_, student uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.exercise.takeover != nil && *f.exercise.takeover == student
}

func (f *fakeService) ExerciseTakenOver(session, student uuid.UUID) bool { return f.TakeoverKeyAllowed(session, student) }

func (f *fakeService) ReleaseTakeoverOf(_, student uuid.UUID) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	d := &f.exercise
	if d.takeover == nil || *d.takeover != student {
		return false
	}
	d.takeover = nil
	return true
}

// takeOver watches the student and takes his terminal over, and takes the messages of the student's tabs and of the panel.
func (cr *crowd) takeOver(t *testing.T, student uuid.UUID, tabs ...*tap) {
	t.Helper()
	cr.panel.send(t, typeExWatch, `{"studentId":"`+student.String()+`"}`)
	for _, tab := range tabs {
		tab.next(t, typeExWatch)
	}
	cr.panel.send(t, typeExTakeover, `{"studentId":"`+student.String()+`","on":true}`)
	for _, tab := range tabs {
		tab.next(t, typeExTakeover)
	}
	cr.panel.next(t, typeExTakeover)
}

// Covers SPEC-071 CA-01 and section 3.3 (live:exercise:pause, live:exercise:paused): the panel pauses and resumes; the panel and the admitted
// students are told with the end and the time paused; the presentation window and who waits are not; who is not the panel is dropped.
func TestGuided_PauseTellsTheRoom(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	w.svc.setExerciseNow(exerciseNow.Add(time.Minute))

	cr.panel.send(t, typeExPause, `{"paused":true}`)
	got := cr.panel.nextData(t, typeExPaused)
	assert.Equal(t, []string{"endsAt", "now", "paused", "pausedSeconds", "runId"}, sortedKeys(got))
	assert.Equal(t, run, got["runId"])
	assert.Equal(t, true, got["paused"])
	assert.Equal(t, "2026-10-14T19:05:00.000Z", got["endsAt"])
	for _, s := range cr.students() {
		assert.Equal(t, got, s.nextData(t, typeExPaused))
	}

	w.svc.setExerciseNow(exerciseNow.Add(2 * time.Minute))
	cr.panel.send(t, typeExPause, `{"paused":false}`)
	back := cr.panel.nextData(t, typeExPaused)
	assert.Equal(t, false, back["paused"])
	assert.Equal(t, "2026-10-14T19:06:00.000Z", back["endsAt"])
	assert.EqualValues(t, 60, back["pausedSeconds"])
	for _, s := range cr.students() {
		s.next(t, typeExPaused)
	}

	rejected := rejectedCount(w)
	for _, data := range []string{`{}`, `null`, `{"paused":"yes"}`, `{"paused":false}`} {
		cr.panel.send(t, typeExPause, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	cr.a.send(t, typeExPause, `{"paused":true}`)
	cr.presenter.send(t, typeExPause, `{"paused":true}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExPause)) == 2 })
	quiet(t, guidedTypes, cr.everyone()...)
}

// Covers SPEC-071 CA-02, CA-03 and section 3.3 (live:exercise:extend, live:exercise:extended): more minutes are told to the panel and the students,
// with the new end, the time in all and whether the round reopened; invalid minutes are rejected.
func TestGuided_ExtendTellsTheRoom(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)

	cr.panel.send(t, typeExExtend, `{"minutes":2}`)
	got := cr.panel.nextData(t, typeExExtended)
	assert.Equal(t, []string{"durationSeconds", "endsAt", "now", "reopened", "runId"}, sortedKeys(got))
	assert.Equal(t, run, got["runId"])
	assert.Equal(t, "2026-10-14T19:07:00.000Z", got["endsAt"])
	assert.EqualValues(t, 420, got["durationSeconds"])
	assert.Equal(t, false, got["reopened"])
	for _, s := range cr.students() {
		assert.Equal(t, got, s.nextData(t, typeExExtended))
	}

	cr.panel.send(t, typeExEnd, `{}`)
	cr.panel.next(t, typeExEnded)
	w.svc.setExerciseNow(exerciseNow.Add(3 * time.Minute))
	cr.panel.send(t, typeExExtend, `{"minutes":3}`)
	reopened := cr.panel.nextData(t, typeExExtended)
	assert.Equal(t, true, reopened["reopened"])
	assert.Equal(t, "2026-10-14T19:06:00.000Z", reopened["endsAt"])

	rejected := rejectedCount(w)
	for _, data := range []string{`{}`, `{"minutes":0}`, `{"minutes":31}`, `{"minutes":"2"}`, `{"minutes":1.5}`} {
		cr.panel.send(t, typeExExtend, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	cr.b.send(t, typeExExtend, `{"minutes":2}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExExtend)) == 1 })
}

// Covers SPEC-071 CA-04, CA-05 and section 3.3 (live:exercise:close, live:exercise:closed): going back to the lesson with the round running tells
// the end first and then the close; with the round ended, only the close; the students get both.
func TestGuided_CloseTellsTheRoom(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)

	cr.panel.send(t, typeExClose, `{}`)
	ended := cr.panel.nextData(t, typeExEnded)
	assert.Equal(t, "TEACHER", ended["by"])
	closed := cr.panel.nextData(t, typeExClosed)
	assert.Equal(t, []string{"closedAt", "now", "runId"}, sortedKeys(closed))
	assert.Equal(t, run, closed["runId"])
	assert.Equal(t, "2026-10-14T19:00:00.000Z", closed["closedAt"])
	for _, s := range cr.students() {
		s.next(t, typeExEnded)
		assert.Equal(t, closed, s.nextData(t, typeExClosed))
	}
	cr.panel.send(t, typeExClose, `{}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
	quiet(t, append(guidedTypes, typeExEnded), cr.everyone()...)

	y := setup(t)
	cy := newCrowd(t, y)
	cy.start(t)
	cy.panel.send(t, typeExEnd, `{}`)
	cy.panel.next(t, typeExEnded)
	for _, s := range cy.students() {
		s.next(t, typeExEnded)
	}
	cy.panel.send(t, typeExClose, `{}`)
	cy.panel.next(t, typeExClosed)
	quiet(t, []string{typeExEnded}, cy.everyone()...)
}

// Covers SPEC-071 CA-07 and section 3.3 (live:exercise:takeover): the panel takes over the terminal of the student it watches: every tab of the
// student is told with the name of the teacher, the panel is told; the service is told whether the student is online; giving back tells both.
func TestGuided_TakeoverTellsTheStudentAndThePanel(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	ana := cr.ana.String()
	cr.panel.send(t, typeExWatch, `{"studentId":"`+ana+`"}`)
	cr.a.next(t, typeExWatch)
	cr.aTab.next(t, typeExWatch)

	cr.panel.send(t, typeExTakeover, `{"studentId":"`+ana+`","on":true}`)
	assert.JSONEq(t, `{"on":true,"teacherName":"Profa. Sediane"}`, string(cr.a.next(t, typeExTakeover).Data))
	assert.JSONEq(t, `{"on":true,"teacherName":"Profa. Sediane"}`, string(cr.aTab.next(t, typeExTakeover).Data))
	assert.JSONEq(t, `{"studentId":"`+ana+`","on":true}`, string(cr.panel.next(t, typeExTakeover).Data))
	quiet(t, guidedTypes, cr.everyone()...)
	assert.Equal(t, []bool{true}, w.svc.exercise.takeoverOnline, "Ana is online")

	cr.panel.send(t, typeExTakeover, `{"studentId":"`+ana+`","on":false}`)
	assert.JSONEq(t, `{"on":false}`, string(cr.a.next(t, typeExTakeover).Data))
	assert.JSONEq(t, `{"on":false}`, string(cr.aTab.next(t, typeExTakeover).Data))
	assert.JSONEq(t, `{"studentId":"`+ana+`","on":false}`, string(cr.panel.next(t, typeExTakeover).Data))

	rejected := rejectedCount(w)
	for _, data := range []string{
		`{"studentId":"` + cr.bruno.String() + `","on":true}`, // not watched
		`{"studentId":"` + ana + `","on":false}`,              // not taken over
		`{"studentId":"` + ana + `"}`, `{"on":true}`, `{"studentId":"x","on":true}`, `null`,
	} {
		cr.panel.send(t, typeExTakeover, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	cr.a.send(t, typeExTakeover, `{"studentId":"`+ana+`","on":true}`)
	cr.presenter.send(t, typeExTakeover, `{"studentId":"`+ana+`","on":true}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExTakeover)) == 2 })
	quiet(t, guidedTypes, cr.everyone()...)
}

// Covers SPEC-071 CA-07, CA-09 and section 3.3 (live:exercise:key): the keys and the pastes of the panel go, in order, only to the tabs of the
// student taken over; with no takeover they are dropped; an invalid key is rejected; the panel is not sent back its own keys.
func TestGuided_KeysGoOnlyToTheStudentTakenOver(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	bruno := cr.bruno.String()

	cr.panel.send(t, typeExKey, `{"studentId":"`+bruno+`","key":"l"}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExKey)) == 1 })
	assert.Equal(t, []string{"not-taken-over"}, droppedFor(w, typeExKey))

	cr.takeOver(t, cr.bruno, cr.b)
	for _, k := range []string{"l", "s", "Enter"} {
		cr.panel.send(t, typeExKey, `{"studentId":"`+bruno+`","key":"`+k+`"}`)
	}
	cr.panel.send(t, typeExKey, `{"studentId":"`+bruno+`","key":"c","ctrl":true}`)
	cr.panel.send(t, typeExKey, `{"studentId":"`+bruno+`","paste":"echo oi\n"}`)
	assert.JSONEq(t, `{"key":"l","ctrl":false,"alt":false,"shift":false}`, string(cr.b.next(t, typeExKey).Data))
	assert.JSONEq(t, `{"key":"s","ctrl":false,"alt":false,"shift":false}`, string(cr.b.next(t, typeExKey).Data))
	assert.JSONEq(t, `{"key":"Enter","ctrl":false,"alt":false,"shift":false}`, string(cr.b.next(t, typeExKey).Data))
	assert.JSONEq(t, `{"key":"c","ctrl":true,"alt":false,"shift":false}`, string(cr.b.next(t, typeExKey).Data))
	assert.JSONEq(t, `{"paste":"echo oi\n"}`, string(cr.b.next(t, typeExKey).Data))
	quiet(t, []string{typeExKey}, cr.everyone()...)

	rejected := rejectedCount(w)
	for _, data := range []string{
		`{"studentId":"` + bruno + `","key":""}`, `{"studentId":"` + bruno + `","key":"` + strings.Repeat("k", 21) + `"}`,
		`{"studentId":"` + bruno + `","key":"\u001b"}`, `{"studentId":"` + bruno + `","paste":""}`,
		`{"studentId":"` + bruno + `","paste":"` + strings.Repeat("x", 2001) + `"}`, `{"studentId":"` + bruno + `"}`,
		`{"studentId":"` + bruno + `","key":"a","paste":"b"}`, `{"key":"a"}`, `null`,
	} {
		cr.panel.send(t, typeExKey, data)
		rejected++
		eventually(t, func() bool { return rejectedCount(w) == rejected })
	}
	cr.panel.send(t, typeExKey, `{"studentId":"`+cr.carla.String()+`","key":"x"}`)
	cr.b.send(t, typeExKey, `{"studentId":"`+bruno+`","key":"x"}`)
	eventually(t, func() bool { return len(droppedFor(w, typeExKey)) == 3 })
	quiet(t, []string{typeExKey}, cr.everyone()...)
}

// Covers SPEC-071 section 3.3 and section 6 (muitas teclas): up to 40 keys a second go on; the rest of that second is dropped.
func TestGuided_KeysAreLimited(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	cr.takeOver(t, cr.carla, cr.c)
	for i := 0; i < 50; i++ {
		cr.panel.send(t, typeExKey, `{"studentId":"`+cr.carla.String()+`","key":"a"}`)
	}
	eventually(t, func() bool { return len(droppedFor(w, typeExKey)) >= 10 })
	for i := 0; i < 40; i++ {
		cr.c.next(t, typeExKey)
	}
	assert.Contains(t, droppedFor(w, typeExKey), "rate")
}

// Covers SPEC-071 RN-06 and CA-07: when the student leaves the room (all his tabs), the takeover ends and the panel is told; when the round pauses,
// the student and the panel are told that it ended; when the timer ends the round, too.
func TestGuided_TakeoverEndsAndIsTold(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	cr.start(t)
	cr.takeOver(t, cr.bruno, cr.b)
	require.NoError(t, cr.b.conn.Close())
	assert.JSONEq(t, `{"studentId":"`+cr.bruno.String()+`","on":false}`, string(cr.panel.next(t, typeExTakeover).Data))

	cr.takeOver(t, cr.carla, cr.c)
	cr.panel.send(t, typeExPause, `{"paused":true}`)
	cr.panel.next(t, typeExPaused)
	assert.JSONEq(t, `{"on":false}`, string(cr.c.next(t, typeExTakeover).Data))
	assert.JSONEq(t, `{"studentId":"`+cr.carla.String()+`","on":false}`, string(cr.panel.next(t, typeExTakeover).Data))

	y := setup(t)
	cy := newCrowd(t, y)
	cy.start(t)
	cy.takeOver(t, cy.carla, cy.c)
	y.svc.mu.Lock()
	y.svc.exercise.releaseOnTimer = true
	y.svc.mu.Unlock()
	y.svc.fireTimer(y.session.ID)
	assert.JSONEq(t, `{"on":false}`, string(cy.c.next(t, typeExTakeover).Data))
	assert.JSONEq(t, `{"studentId":"`+cy.carla.String()+`","on":false}`, string(cy.panel.next(t, typeExTakeover).Data))
}

// Covers SPEC-071 RN-09 and section 3.3: the progress of a student carries his commands and the moment of his last command to the panel.
func TestGuided_ProgressCarriesTheCommands(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	cr.a.send(t, typeExProgress, `{"runId":"`+run+`","met":1,"total":3,"commands":4}`)
	got := cr.panel.nextData(t, typeExProgress)
	assert.EqualValues(t, 4, got["commands"])
	assert.Equal(t, "2026-10-14T19:00:00.000Z", got["lastCommandAt"])
	require.Len(t, w.svc.exerciseRecorded(), 1)

	cr.a.send(t, typeExProgress, `{"runId":"`+run+`","met":1,"total":3,"commands":"x"}`)
	eventually(t, func() bool { return rejectedCount(w) == 1 })
}

// Covers SPEC-071 CA-13 and section 3.3 (instantâneo): a paused round is told as PAUSED with the time paused; the student taken over is told so,
// and the others not; the panel gets the commands, the status, the help and the takeover of each student.
func TestGuided_Snapshot(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	cr.a.send(t, typeExProgress, `{"runId":"`+run+`","met":1,"total":3,"commands":4}`)
	cr.panel.next(t, typeExProgress)
	cr.takeOver(t, cr.bruno, cr.b)

	bruno := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "stranger")))
	assert.Equal(t, true, bruno["takenOver"])
	ana := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "student")))
	assert.Equal(t, false, ana["takenOver"])
	panel := exerciseOfSnapshot(t, snapshotOf(t, w.dialView(t, "teacher", "panel")))
	for _, e := range panel["progress"].([]any) {
		entry := e.(map[string]any)
		switch entry["studentId"] {
		case cr.ana.String():
			assert.EqualValues(t, 4, entry["commands"])
			assert.Equal(t, "2026-10-14T19:00:00.000Z", entry["lastCommandAt"])
			assert.Equal(t, "IN_PROGRESS", entry["status"])
		case cr.bruno.String():
			assert.Equal(t, true, entry["takeoverOn"])
			assert.Equal(t, true, entry["takenOver"])
		}
	}

	cr.panel.send(t, typeExPause, `{"paused":true}`)
	cr.panel.next(t, typeExPaused)
	paused := exerciseOfSnapshot(t, snapshotOf(t, w.dial(t, "third")))
	assert.Equal(t, "PAUSED", paused["status"])
	assert.EqualValues(t, 0, paused["pausedSeconds"])
	assert.Nil(t, paused["closedAt"])
}

// Covers SPEC-071 RN-01 and section 5: a submission while the round is paused is a 409 exercise-paused.
func TestGuided_SubmitWhilePaused(t *testing.T) {
	w := setup(t)
	cr := newCrowd(t, w)
	run := cr.start(t)["runId"].(string)
	w.svc.mu.Lock()
	w.svc.exercise.submitErr = domain.ErrExercisePaused
	w.svc.mu.Unlock()
	code, body := w.submit(t, "student", obj{"runId": run, "snapshot": "pass"})
	assert.Equal(t, http.StatusConflict, code)
	assert.Contains(t, body["type"], "exercise-paused")
}
