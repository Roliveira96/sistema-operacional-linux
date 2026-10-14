package service_test

import (
	"context"
	"encoding/json"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- test doubles of the waiting room and of the modules (SPEC-054) ----

func (f *fakeRepo) FindAdmission(_ context.Context, session, student uuid.UUID) (domain.LiveClassroomAdmission, error) {
	a, ok := f.admissions[[2]uuid.UUID{session, student}]
	if !ok {
		return domain.LiveClassroomAdmission{}, domain.ErrAdmissionNotFound
	}
	return *a, nil
}

func (f *fakeRepo) UpsertAdmission(_ context.Context, session, student uuid.UUID, status string, now time.Time, by *uuid.UUID) (domain.LiveClassroomAdmission, error) {
	key := [2]uuid.UUID{session, student}
	a, ok := f.admissions[key]
	if !ok {
		a = &domain.LiveClassroomAdmission{SessionID: session, StudentID: student, RequestedAt: now}
		f.admissions[key] = a
	}
	a.Status = status
	if status == domain.AdmissionWaiting {
		a.RequestedAt, a.DecidedAt, a.DecidedBy = now, nil, nil
	} else {
		a.DecidedAt, a.DecidedBy = &now, by
	}
	return *a, nil
}

func (f *fakeRepo) ListAdmissions(_ context.Context, session uuid.UUID) ([]domain.AdmissionEntry, error) {
	out := []domain.AdmissionEntry{}
	for k, a := range f.admissions {
		if k[0] == session && a.Status != domain.AdmissionRemoved {
			out = append(out, domain.AdmissionEntry{StudentID: a.StudentID, Name: f.studentNames[a.StudentID], Status: a.Status, RequestedAt: a.RequestedAt})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RequestedAt.Before(out[j].RequestedAt) })
	return out, nil
}

func (f *fakeRepo) AdmitAllWaiting(_ context.Context, session uuid.UUID, now time.Time, by *uuid.UUID) ([]uuid.UUID, error) {
	var ids []uuid.UUID
	for k, a := range f.admissions {
		if k[0] == session && a.Status == domain.AdmissionWaiting {
			a.Status, a.DecidedAt, a.DecidedBy = domain.AdmissionAdmitted, &now, by
			ids = append(ids, a.StudentID)
		}
	}
	return ids, nil
}

// admit puts the students straight in the room, as if the teacher had accepted them.
func (w *world) admit(session uuid.UUID, students ...uuid.UUID) {
	for _, id := range students {
		w.repo.admissions[[2]uuid.UUID{session, id}] = &domain.LiveClassroomAdmission{SessionID: session, StudentID: id, Status: domain.AdmissionAdmitted, RequestedAt: w.now}
	}
}

type fakeModules struct {
	available map[uuid.UUID]bool
	views     map[uuid.UUID]service.ModuleView
}

func (m *fakeModules) Available(_ context.Context, _ service.Actor, id uuid.UUID) error {
	if !m.available[id] {
		return domain.ErrModuleNotFound
	}
	return nil
}

func (m *fakeModules) Read(_ context.Context, id uuid.UUID) (service.ModuleView, error) {
	v, ok := m.views[id]
	if !ok {
		return service.ModuleView{}, domain.ErrModuleNotFound
	}
	return v, nil
}

func (w *world) withModules(ids ...uuid.UUID) *fakeModules {
	m := &fakeModules{available: map[uuid.UUID]bool{}, views: map[uuid.UUID]service.ModuleView{}}
	for _, id := range ids {
		m.available[id] = true
		m.views[id] = service.ModuleView{ID: id, Title: "Processos", Blocks: []service.ModuleBlock{{ID: "b1", Type: "TEXT", Position: 1, Payload: json.RawMessage(`{"text":"oi"}`)}},
			Scenario: json.RawMessage(`{"fs":1}`)}
	}
	w.svc.WithModules(m)
	return m
}

func (w *world) newStudent(name string) service.Actor {
	a := service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.repo.students[w.class][a.UserID] = true
	w.repo.studentNames[a.UserID] = name
	return a
}

func names(entries []domain.AdmissionEntry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Name
	}
	return out
}

// ---- tests ----

// Covers SPEC-054 CA-01 and RN-01: a student comes in waiting; the teacher and the administrator come in directly.
func TestAdmission_WaitingByDefault(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)

	c, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionWaiting, c.Admission)
	st, err := w.svc.AdmissionState(ctx, s.ID, w.student.UserID)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionWaiting, st)

	for _, who := range []service.Actor{w.teacher, w.admin} {
		c, err = w.svc.Connect(ctx, who, w.class)
		require.NoError(t, err)
		assert.True(t, c.Controller)
		assert.Empty(t, c.Admission, "who runs the room needs no admission")
	}
	adm, err := w.svc.Admissions(ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana"}, names(adm.Waiting))
	assert.Empty(t, adm.Admitted)
}

// Covers SPEC-054 CA-02: accepting one student, or all, admits them.
func TestAdmission_AcceptAndAcceptAll(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	bruno, carla := w.newStudent("Bruno"), w.newStudent("Carla")
	for _, who := range []service.Actor{w.student, bruno, carla} {
		w.now = w.now.Add(time.Second)
		_, err := w.svc.Connect(ctx, who, w.class)
		require.NoError(t, err)
	}

	adm, err := w.svc.Admit(ctx, w.teacher, s.ID, bruno.UserID)
	require.NoError(t, err)
	assert.Equal(t, []string{"Ana", "Carla"}, names(adm.Waiting), "first in, first served")
	assert.Equal(t, []string{"Bruno"}, names(adm.Admitted))
	st, _ := w.svc.AdmissionState(ctx, s.ID, bruno.UserID)
	assert.Equal(t, domain.AdmissionAdmitted, st)

	again, err := w.svc.Admit(ctx, w.teacher, s.ID, bruno.UserID)
	require.NoError(t, err, "admitting who is already in changes nothing")
	assert.Equal(t, adm, again)

	ids, adm, err := w.svc.AdmitAll(ctx, w.teacher, s.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{w.student.UserID, carla.UserID}, ids)
	assert.Empty(t, adm.Waiting)
	assert.Len(t, adm.Admitted, 3)

	_, err = w.svc.Admit(ctx, w.teacher, s.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAdmissionNotFound, "nobody asked for it")
}

// Covers SPEC-054 CA-03 and RN-02: removing takes the access away; the student only comes back by asking again.
func TestAdmission_RemoveAndAskAgain(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	_, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	_, err = w.svc.Admit(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)

	adm, err := w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	assert.Empty(t, adm.Admitted)
	assert.Empty(t, adm.Waiting, "the removed is not in the list of the teacher")
	st, _ := w.svc.AdmissionState(ctx, s.ID, w.student.UserID)
	assert.Equal(t, domain.AdmissionRemoved, st)

	c, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionRemoved, c.Admission, "reconnecting does not bring the removed back")

	st, err = w.svc.RequestAgain(ctx, s.ID, w.student.UserID)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionWaiting, st)
	adm, _ = w.svc.Admissions(ctx, s.ID)
	assert.Equal(t, []string{"Ana"}, names(adm.Waiting))

	st, err = w.svc.RequestAgain(ctx, s.ID, w.student.UserID)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionWaiting, st, "asking while waiting changes nothing")

	// A waiting student can be refused too, and an admitted one asking again stays admitted.
	_, err = w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	_, err = w.svc.Remove(ctx, w.teacher, s.ID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrAdmissionNotFound)
	w.admit(s.ID, w.student.UserID)
	st, _ = w.svc.RequestAgain(ctx, s.ID, w.student.UserID)
	assert.Equal(t, domain.AdmissionAdmitted, st)
}

// Covers SPEC-054 CA-04: who was admitted stays admitted when the connection drops and comes back.
func TestAdmission_SurvivesReconnect(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	_, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	_, err = w.svc.Admit(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	for i := 0; i < 2; i++ {
		c, err := w.svc.Connect(ctx, w.student, w.class)
		require.NoError(t, err)
		assert.Equal(t, domain.AdmissionAdmitted, c.Admission)
	}

	// The next room of the class starts from nothing: the decision was for that lesson only.
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	w.now = w.now.Add(time.Hour)
	next := w.start(t)
	c, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.Equal(t, domain.AdmissionWaiting, c.Admission)
	assert.Equal(t, next.ID, c.Session.ID)
}

// Covers SPEC-054 RN-02: only who runs the class decides.
func TestAdmission_OnlyTheTeacherDecides(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	_, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)

	for _, who := range []service.Actor{w.student, w.other, w.outside} {
		_, err = w.svc.Admit(ctx, who, s.ID, w.student.UserID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
		_, _, err = w.svc.AdmitAll(ctx, who, s.ID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
		_, err = w.svc.Remove(ctx, who, s.ID, w.student.UserID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
	}
	st, _ := w.svc.AdmissionState(ctx, s.ID, w.student.UserID)
	assert.Equal(t, domain.AdmissionWaiting, st)

	_, err = w.svc.Admit(ctx, w.admin, s.ID, w.student.UserID)
	assert.NoError(t, err, "the administrator may")
	_, err = w.svc.Admit(ctx, w.teacher, uuid.New(), w.student.UserID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}

// Covers SPEC-054 CA-05 and RN-03: only the admitted student raises a hand and saves notes in an open room.
func TestAdmitted_OnlyCanRaiseHandAndWriteNotes(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	_, err := w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)

	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted)
	_, err = w.svc.SaveNote(ctx, w.student, w.class, s.ID, "x")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted)
	_, err = w.svc.GetNote(ctx, w.student, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrNotAdmitted)

	_, err = w.svc.Admit(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "")
	assert.NoError(t, err)
	_, err = w.svc.SaveNote(ctx, w.student, w.class, s.ID, "x")
	assert.NoError(t, err)

	_, err = w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	_, err = w.svc.RaiseHand(ctx, s.ID, w.student.UserID, "")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "the removed lost the right")

	// The notes of a lesson that ended stay readable to who wrote them.
	w.admit(s.ID, w.student.UserID)
	_, err = w.svc.SaveNote(ctx, w.student, w.class, s.ID, "final")
	require.NoError(t, err)
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	_, err = w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	got, err := w.svc.GetNote(ctx, w.student, w.class, s.ID)
	require.NoError(t, err)
	assert.Equal(t, "final", got.Content)
}

// Covers SPEC-054 CA-11 and RN-06: the module mode needs a module, which the teacher can use; the choice stays in the room.
func TestSwitchToModuleNeedsAModule(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	module, ghost := uuid.New(), uuid.New()
	w.withModules(module)

	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, nil), domain.ErrModuleNotFound, "no module chosen")
	assert.ErrorIs(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &ghost), domain.ErrModuleNotFound, "not available to the teacher")
	assert.Equal(t, domain.ModeSlides, w.repo.sessions[s.ID].DisplayMode)

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))
	assert.Equal(t, domain.ModeModule, w.repo.sessions[s.ID].DisplayMode)
	assert.Equal(t, &module, w.repo.sessions[s.ID].ActiveModuleID)

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	assert.Equal(t, &module, w.repo.sessions[s.ID].ActiveModuleID, "going back to the slides keeps the module of the lesson")
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module), "and the module can be shown again")
}

// Covers SPEC-054 RN-04 and CA-11: the block in focus is part of the published state, and a new module starts with none.
func TestModuleFocus_IsPublishedState(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	module, other := uuid.New(), uuid.New()
	w.withModules(module, other)
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))

	require.NoError(t, w.svc.FocusModuleBlock(ctx, s.ID, "block-2"))
	a, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Equal(t, "block-2", a.ModuleFocusBlockID)

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &other))
	a, _ = w.svc.Snapshot(ctx, s.ID)
	assert.Empty(t, a.ModuleFocusBlockID, "the focus belonged to the other module")

	assert.ErrorIs(t, w.svc.FocusModuleBlock(ctx, s.ID, string(make([]byte, 200))), domain.ErrInvalidBlock)
	assert.ErrorIs(t, w.svc.FocusModuleBlock(ctx, uuid.New(), "b"), domain.ErrSessionNotFound)
}

// Covers SPEC-055 CA-05 and RN-04, and SPEC-056 CA-05: the terminal screen of the teacher is always kept for the snapshot, with no switch;
// there is none before the first, the last one replaces the one before, and it lives through the slides and the modes of the lesson.
func TestTerminalScreen_AlwaysKept(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	module := uuid.New()
	w.withModules(module)

	a, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Empty(t, a.TerminalScreen, "no screen before the teacher sends one")

	w.svc.RememberTerminalScreen(s.ID, json.RawMessage(`{"tag":"div","children":["$ ls"]}`))
	w.svc.RememberTerminalScreen(s.ID, json.RawMessage(`{"tag":"div","children":["$ pwd"]}`))
	a, err = w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.JSONEq(t, `{"tag":"div","children":["$ pwd"]}`, string(a.TerminalScreen))

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))
	require.NoError(t, w.svc.FocusModuleBlock(ctx, s.ID, "block-1"))
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeSlides, nil))
	a, err = w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.JSONEq(t, `{"tag":"div","children":["$ pwd"]}`, string(a.TerminalScreen), "the screen is not tied to the mode or to the block in focus")
}

// Covers SPEC-056 section 4: the screen is kept in memory only, and ends with the lesson (the room is reopened in the fake repository just
// to look at what the service still holds for it).
func TestTerminalScreen_EndsWithTheLesson(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	w.svc.RememberTerminalScreen(s.ID, json.RawMessage(`{"tag":"div"}`))
	before, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.JSONEq(t, `{"tag":"div"}`, string(before.TerminalScreen), "the room had a screen")

	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	reopened := w.repo.sessions[s.ID]
	reopened.Status, reopened.EndedAt = domain.StatusActive, nil
	w.repo.sessions[s.ID] = reopened

	a, err := w.svc.Snapshot(ctx, s.ID)
	require.NoError(t, err)
	assert.Empty(t, a.TerminalScreen, "the lesson ended: nothing of its screen is left")
}

// Covers SPEC-055 CA-17: the black screen is kept in memory, false by default, and ends with the lesson.
func TestStageBlank_KeptUntilTurnedOffOrTheLessonEnds(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)

	assert.False(t, w.svc.StageBlank(s.ID))
	w.svc.SetStageBlank(s.ID, true)
	assert.True(t, w.svc.StageBlank(s.ID))
	w.svc.SetStageBlank(s.ID, false)
	assert.False(t, w.svc.StageBlank(s.ID))

	w.svc.SetStageBlank(s.ID, true)
	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	assert.False(t, w.svc.StageBlank(s.ID), "the lesson ended")
}

// Covers SPEC-054 CA-12 and RN-07: the module of the room is read by the teacher and by the admitted student only, with the room open.
func TestModuleOfTheRoom_ForTheAdmittedOnly(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	module := uuid.New()
	w.withModules(module)

	_, err := w.svc.ModuleOfRoom(ctx, w.teacher, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	_, err = w.svc.ModuleOfRoom(ctx, w.teacher, w.class)
	assert.ErrorIs(t, err, domain.ErrNoActiveSession)

	s := w.start(t)
	_, err = w.svc.ModuleOfRoom(ctx, w.teacher, w.class)
	assert.ErrorIs(t, err, domain.ErrModuleNotSelected)

	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))
	view, err := w.svc.ModuleOfRoom(ctx, w.teacher, w.class)
	require.NoError(t, err)
	assert.Equal(t, module, view.ID)
	assert.Equal(t, "Processos", view.Title)
	require.Len(t, view.Blocks, 1)
	assert.JSONEq(t, `{"fs":1}`, string(view.Scenario))
	_, err = w.svc.ModuleOfRoom(ctx, w.admin, w.class)
	assert.NoError(t, err)

	_, err = w.svc.Connect(ctx, w.student, w.class)
	require.NoError(t, err)
	_, err = w.svc.ModuleOfRoom(ctx, w.student, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "waiting")
	_, err = w.svc.ModuleOfRoom(ctx, w.outside, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "not of the class")
	_, err = w.svc.ModuleOfRoom(ctx, w.other, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "teacher of another class")

	_, err = w.svc.Admit(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	view, err = w.svc.ModuleOfRoom(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.Equal(t, module, view.ID)

	_, err = w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	_, err = w.svc.ModuleOfRoom(ctx, w.student, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "removed")

	w.admit(s.ID, w.student.UserID)
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	_, err = w.svc.ModuleOfRoom(ctx, w.student, w.class)
	assert.ErrorIs(t, err, domain.ErrNoActiveSession, "only while the lesson is going on")
}

// Without the module port (the tests of the older rules), the switch still checks that the module exists.
func TestModuleOfTheRoom_WithoutThePortItIsNotFound(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	module := uuid.New()
	w.repo.modules[module] = true
	require.NoError(t, w.svc.SwitchMode(ctx, w.teacher, s.ID, domain.ModeModule, &module))
	_, err := w.svc.ModuleOfRoom(ctx, w.teacher, w.class)
	assert.ErrorIs(t, err, domain.ErrModuleNotFound)
}
