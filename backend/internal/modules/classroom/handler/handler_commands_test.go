package handler_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- SPEC-071: the commands of the teacher in the live classroom ----

const typeTerminalCommand = "live:terminal:command"

// commandState is the double of the commands: what the handler asked of the service, and what it answers.
type commandState struct {
	err      error // every RecordCommand answers with it when set
	calls    []service.CommandInput
	sessions []uuid.UUID
	list     []domain.LiveTerminalCommand
}

// RecordCommand answers as the real service does: the domain checks the command, and the moment is the server's.
func (f *fakeService) RecordCommand(_ context.Context, session uuid.UUID, in service.CommandInput) (domain.LiveTerminalCommand, error) {
	f.record("command")
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands.calls = append(f.commands.calls, in)
	f.commands.sessions = append(f.commands.sessions, session)
	if f.commands.err != nil {
		return domain.LiveTerminalCommand{}, f.commands.err
	}
	at := time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC).Add(time.Duration(len(f.commands.calls)) * time.Second)
	return domain.NewTerminalCommand(session, in.Terminal, in.Command, in.ExitStatus, in.Output, in.OutputTruncated, at)
}

func (f *fakeService) ListCommands(_ context.Context, a service.Actor, _, _ uuid.UUID) ([]domain.LiveTerminalCommand, error) {
	f.actor = a
	if f.err != nil {
		return nil, f.err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.commands.list, nil
}

func (f *fakeService) recordedCommands() []service.CommandInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]service.CommandInput(nil), f.commands.calls...)
}

// Covers SPEC-071 CA-05, CA-07 and RN-05: the presentation window of the teacher records a command, which is kept and relayed to nobody;
// the panel, a student and one who waits are dropped with audit, and the service is never asked.
func TestTerminalCommand_PresenterOnly(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	panel := w.dialView(t, "teacher2", "panel")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	data := `{"terminal":1,"command":"ls -la","exitStatus":0,"output":"total 0\n","outputTruncated":false}`
	sendMsg(t, presenter, typeTerminalCommand, data)
	eventually(t, func() bool { return w.svc.called("command") == 1 })
	calls := w.svc.recordedCommands()
	require.Len(t, calls, 1)
	assert.Equal(t, 1, calls[0].Terminal)
	assert.Equal(t, "ls -la", calls[0].Command)
	require.NotNil(t, calls[0].ExitStatus)
	assert.Equal(t, 0, *calls[0].ExitStatus)
	assert.Equal(t, "total 0\n", calls[0].Output)
	assert.False(t, calls[0].OutputTruncated)
	w.svc.mu.Lock()
	assert.Equal(t, w.session.ID, w.svc.commands.sessions[0])
	w.svc.mu.Unlock()

	// nobody gets it: the panel and the students already see the terminal (SPEC-056)
	nothingMore(t, panel, typeTerminalCommand)
	nothingMore(t, student, typeTerminalCommand)
	nothingMore(t, presenter, typeTerminalCommand)

	// an interrupted command has no exit status
	sendMsg(t, presenter, typeTerminalCommand, `{"terminal":2,"command":"sleep 100","exitStatus":null,"output":"","outputTruncated":true}`)
	eventually(t, func() bool { return w.svc.called("command") == 2 })
	calls = w.svc.recordedCommands()
	assert.Nil(t, calls[1].ExitStatus)
	assert.True(t, calls[1].OutputTruncated)

	// the panel and a student are dropped with audit
	sendMsg(t, panel, typeTerminalCommand, data)
	sendMsg(t, student, typeTerminalCommand, data)
	eventually(t, func() bool { return len(droppedFor(w, typeTerminalCommand)) == 2 })
	assert.ElementsMatch(t, []string{"wrong-view", "not-controller"}, droppedFor(w, typeTerminalCommand))
	assert.Equal(t, 2, w.svc.called("command"), "the service was not asked")

	// one who waits in the waiting room is dropped too
	w.svc.mu.Lock()
	w.svc.waiting = true
	w.svc.mu.Unlock()
	waiting := w.dial(t, "stranger")
	readUntil(t, waiting, "live:admission:state")
	sendMsg(t, waiting, typeTerminalCommand, data)
	eventually(t, func() bool { return len(droppedFor(w, typeTerminalCommand)) == 3 })
	assert.Contains(t, droppedFor(w, typeTerminalCommand), "not-admitted")
	assert.Equal(t, 2, w.svc.called("command"))
}

// Covers SPEC-071 CA-05: a command the handler cannot read, one the domain refuses and one the service refuses are rejected with the log of
// the room, and nothing is kept or sent.
func TestTerminalCommand_InvalidRejected(t *testing.T) {
	w := setup(t)
	presenter := w.dialView(t, "teacher", "presenter")
	student := w.dial(t, "student")
	readUntil(t, presenter, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	sendMsg(t, presenter, typeTerminalCommand, `{"terminal":"one","command":"ls"}`)
	sendMsg(t, presenter, typeTerminalCommand, `{"terminal":9,"command":"ls","output":""}`)
	sendMsg(t, presenter, typeTerminalCommand, `{"terminal":1,"command":"","output":""}`)
	eventually(t, func() bool { return rejectedCount(w) == 3 })

	w.svc.mu.Lock()
	w.svc.commands.err = domain.ErrCommandLimit
	w.svc.mu.Unlock()
	sendMsg(t, presenter, typeTerminalCommand, `{"terminal":1,"command":"ls","output":""}`)
	eventually(t, func() bool { return rejectedCount(w) == 4 })
	assert.Empty(t, droppedFor(w, typeTerminalCommand), "these are rejections, not drops")
	nothingMore(t, student, typeTerminalCommand)
}

// Covers SPEC-071 CA-06 and section 5: the commands of a room are read by the route, in order, with the fields of the contract; the problems
// of the service are mapped, and the ids are checked.
func TestCommandsRoute(t *testing.T) {
	w := setup(t)
	zero := 0
	ran := time.Date(2026, 10, 14, 19, 5, 0, 0, time.UTC)
	w.svc.commands.list = []domain.LiveTerminalCommand{
		{Model: database.Model{ID: uuid.New()}, SessionID: w.session.ID, Terminal: 1, Command: "ls -la", ExitStatus: &zero, Output: "total 0\n", RanAt: ran},
		{Model: database.Model{ID: uuid.New()}, SessionID: w.session.ID, Terminal: 2, Command: "sleep 100", Output: "", OutputTruncated: true, RanAt: ran.Add(time.Minute)},
	}
	path := w.path("/sessions/" + w.session.ID.String() + "/commands")

	status, body := w.call(t, "student", http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, w.student.UserID, w.svc.actor.UserID)
	assert.Equal(t, w.session.ID.String(), body["sessionId"])
	commands := body["commands"].([]any)
	require.Len(t, commands, 2)
	first, second := commands[0].(map[string]any), commands[1].(map[string]any)
	assert.EqualValues(t, 1, first["terminal"])
	assert.Equal(t, "ls -la", first["command"])
	assert.EqualValues(t, 0, first["exitStatus"])
	assert.Equal(t, "total 0\n", first["output"])
	assert.Equal(t, false, first["outputTruncated"])
	assert.Equal(t, "2026-10-14T19:05:00Z", first["ranAt"])
	assert.Nil(t, second["exitStatus"])
	assert.Contains(t, second, "exitStatus")
	assert.Equal(t, true, second["outputTruncated"])

	// a room with no command is an empty list
	w.svc.commands.list = nil
	status, body = w.call(t, "teacher", http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, []any{}, body["commands"])

	for _, tc := range []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrSessionNotFound, http.StatusNotFound, "session-not-found"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
	} {
		w.svc.err = tc.err
		status, out := w.call(t, "student", http.MethodGet, path, nil)
		assert.Equal(t, tc.status, status, tc.typ)
		assert.Equal(t, tc.typ, out["type"])
	}
	w.svc.err = nil
	status, out := w.call(t, "teacher", http.MethodGet, w.path("/sessions/not-a-uuid/commands"), nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
}
