package service_test

import (
	"context"
	"errors"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- SPEC-073: the commands of the teacher in the live classroom ----

// the repository double keeps the commands in the order they were saved
func (f *fakeRepo) CreateCommand(_ context.Context, c *domain.LiveTerminalCommand) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	f.commands = append(f.commands, *c)
	return nil
}

func (f *fakeRepo) CountCommands(_ context.Context, session uuid.UUID) (int64, error) {
	var n int64
	for _, c := range f.commands {
		if c.SessionID == session {
			n++
		}
	}
	return n, nil
}

// ListCommands is the reading of the real repository: the commands of the room in the order they ran.
func (f *fakeRepo) ListCommands(_ context.Context, session uuid.UUID) ([]domain.LiveTerminalCommand, error) {
	out := []domain.LiveTerminalCommand{}
	for _, c := range f.commands {
		if c.SessionID == session {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].RanAt.Before(out[j].RanAt) })
	return out, nil
}

// ListLinkedSessions is the reading of the real repository: the rooms linked to any of the lessons, oldest first, each with its commands.
func (f *fakeRepo) ListLinkedSessions(_ context.Context, lessons []uuid.UUID) ([]service.LinkedRoom, error) {
	out := []service.LinkedRoom{}
	for _, s := range f.sessions {
		if s.ClassSessionID == nil {
			continue
		}
		for _, id := range lessons {
			if *s.ClassSessionID == id {
				n, _ := f.CountCommands(context.Background(), s.ID)
				out = append(out, service.LinkedRoom{Session: s, CommandCount: int(n)})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Session.StartedAt.Before(out[j].Session.StartedAt) })
	return out, nil
}

func commandFieldOf(err error) string {
	var fe *domain.FieldError
	if errors.As(err, &fe) {
		return fe.Field
	}
	return ""
}

// Covers SPEC-073 CA-05, CA-06 and RN-05, RN-07: each command is kept with the moment of the server, and the list comes back in the order
// they ran, with the terminal, the exit status (or none) and the output; an output over the limit is cut and marked.
func TestRecordCommand_ServerTimeAndOrder(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	zero, one := 0, 1

	w.now = w.now.Add(time.Minute)
	first, err := w.svc.RecordCommand(ctx, s.ID, service.CommandInput{Terminal: 1, Command: "ls", ExitStatus: &zero, Output: "a  b\n"})
	require.NoError(t, err)
	assert.Equal(t, s.ID, first.SessionID)
	assert.Equal(t, w.now, first.RanAt, "the moment is the server's")
	w.now = w.now.Add(time.Minute)
	_, err = w.svc.RecordCommand(ctx, s.ID, service.CommandInput{Terminal: 2, Command: "cat x", ExitStatus: &one, Output: "cat: x: No such file or directory\n"})
	require.NoError(t, err)
	w.now = w.now.Add(time.Minute)
	_, err = w.svc.RecordCommand(ctx, s.ID, service.CommandInput{Terminal: 1, Command: "sleep 100", Output: "", OutputTruncated: true})
	require.NoError(t, err)

	list, err := w.svc.ListCommands(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []string{"ls", "cat x", "sleep 100"}, []string{list[0].Command, list[1].Command, list[2].Command})
	assert.Equal(t, []int{1, 2, 1}, []int{list[0].Terminal, list[1].Terminal, list[2].Terminal})
	assert.Equal(t, 1, *list[1].ExitStatus)
	assert.Nil(t, list[2].ExitStatus, "interrupted: no exit status")
	assert.True(t, list[2].OutputTruncated)
	assert.True(t, list[0].RanAt.Before(list[1].RanAt))

	cut, err := w.svc.RecordCommand(ctx, s.ID, service.CommandInput{Terminal: 1, Command: "yes", ExitStatus: &zero, Output: strings.Repeat("y\n", domain.MaxCommandOutputLength)})
	require.NoError(t, err)
	assert.Len(t, cut.Output, domain.MaxCommandOutputLength)
	assert.True(t, cut.OutputTruncated)
}

// Covers SPEC-073 CA-05: a command that is not valid is refused with its field, and nothing is kept; a room that does not exist or that ended
// takes no command.
func TestRecordCommand_InvalidAndEndedRoom(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	valid := service.CommandInput{Terminal: 1, Command: "ls"}

	for _, tc := range []struct {
		in    service.CommandInput
		field string
	}{
		{service.CommandInput{Terminal: 4, Command: "ls"}, "terminal"},
		{service.CommandInput{Terminal: 1, Command: ""}, "command"},
		{service.CommandInput{Terminal: 1, Command: "ls\x07"}, "command"},
		{service.CommandInput{Terminal: 1, Command: strings.Repeat("x", domain.MaxCommandLength+1)}, "command"},
	} {
		_, err := w.svc.RecordCommand(ctx, s.ID, tc.in)
		require.ErrorIs(t, err, domain.ErrInvalidCommand)
		assert.Equal(t, tc.field, commandFieldOf(err))
	}
	assert.Empty(t, w.repo.commands, "nothing was kept")

	_, err := w.svc.RecordCommand(ctx, uuid.New(), valid)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)

	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	_, err = w.svc.RecordCommand(ctx, s.ID, valid)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a room that ended takes no command")
	assert.Empty(t, w.repo.commands)
}

// Covers SPEC-073 CA-05 and RN-06: a room keeps at most 2,000 commands; the ones over the limit are refused, and nothing else breaks.
func TestRecordCommand_CapPerSession(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	for i := 0; i < domain.MaxCommandsPerSession; i++ {
		w.repo.commands = append(w.repo.commands, domain.LiveTerminalCommand{Model: database.Model{ID: uuid.New()}, SessionID: s.ID, Terminal: 1, Command: "ls", RanAt: w.now})
	}
	_, err := w.svc.RecordCommand(ctx, s.ID, service.CommandInput{Terminal: 1, Command: "ls"})
	assert.ErrorIs(t, err, domain.ErrCommandLimit)
	assert.Len(t, w.repo.commands, domain.MaxCommandsPerSession)

	// another room of another class is not affected by the count of this one
	other := uuid.New()
	w.repo.classes[other] = service.ClassInfo{ID: other, TeacherID: w.teacher.UserID}
	otherRoom, _, err := w.svc.StartSession(ctx, w.teacher, other, service.StartInput{Title: "Outra"})
	require.NoError(t, err)
	_, err = w.svc.RecordCommand(ctx, otherRoom.ID, service.CommandInput{Terminal: 1, Command: "ls"})
	assert.NoError(t, err)
}

// Covers SPEC-073 CA-06 and RN-07: the owner teacher, an administrator and a student with an active enrollment read the commands of a room
// of the class, while it is open and after it ended; who is outside the class is refused, and a room of another class is not found.
func TestListCommands_RolesAndForeignSession(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)
	_, err := w.svc.RecordCommand(ctx, s.ID, service.CommandInput{Terminal: 1, Command: "ls"})
	require.NoError(t, err)

	for _, actor := range []service.Actor{w.teacher, w.admin, w.student} {
		list, err := w.svc.ListCommands(ctx, actor, w.class, s.ID)
		require.NoError(t, err, actor.Role)
		assert.Len(t, list, 1)
	}
	_, err = w.svc.ListCommands(ctx, w.outside, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a student without an active enrollment")
	_, err = w.svc.ListCommands(ctx, w.other, w.class, s.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a teacher of another class")

	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	list, err := w.svc.ListCommands(ctx, w.student, w.class, s.ID)
	require.NoError(t, err)
	assert.Len(t, list, 1, "the commands stay readable after the room ended")

	otherClass := uuid.New()
	w.repo.classes[otherClass] = service.ClassInfo{ID: otherClass, TeacherID: w.other.UserID}
	_, err = w.svc.ListCommands(ctx, w.other, otherClass, s.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a room of another class is not found through this one")
	_, err = w.svc.ListCommands(ctx, w.teacher, w.class, uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)

	// a room with no command reads as an empty list, not nothing
	fresh, _, err := w.svc.StartSession(ctx, w.teacher, w.class, service.StartInput{Title: "Nova"})
	require.NoError(t, err)
	list, err = w.svc.ListCommands(ctx, w.teacher, w.class, fresh.ID)
	require.NoError(t, err)
	assert.NotNil(t, list)
	assert.Empty(t, list)
}

// Covers SPEC-073 CA-01, CA-02 and section 3.2 (the port of the schedule): the rooms linked to the lessons asked, oldest first, each with how
// many commands it has; and the open room of the class, with the lesson it is linked to.
func TestLinkedRooms_ForTheSchedule(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	lesson, lesson2, unasked := uuid.New(), uuid.New(), uuid.New()
	room := func(linked *uuid.UUID, started time.Time, status string) uuid.UUID {
		id := uuid.New()
		s := domain.LiveClassroomSession{Model: database.Model{ID: id}, ClassID: w.class, TeacherID: w.teacher.UserID, ClassSessionID: linked,
			Title: "Aula", DisplayMode: domain.ModeSlides, CurrentSlide: 1, Status: status, StartedAt: started}
		if status == domain.StatusFinished {
			ended := started.Add(time.Hour)
			s.EndedAt = &ended
		}
		w.repo.sessions[id] = s
		return id
	}
	ended := room(&lesson, w.now.Add(-2*time.Hour), domain.StatusFinished)
	second := room(&lesson2, w.now.Add(-time.Hour), domain.StatusFinished)
	open := room(&lesson, w.now, domain.StatusActive)
	room(&unasked, w.now.Add(-3*time.Hour), domain.StatusFinished)
	room(nil, w.now.Add(-4*time.Hour), domain.StatusFinished)
	for i := 0; i < 2; i++ {
		w.repo.commands = append(w.repo.commands, domain.LiveTerminalCommand{Model: database.Model{ID: uuid.New()}, SessionID: ended, Terminal: 1, Command: "ls", RanAt: w.now})
	}
	w.repo.commands = append(w.repo.commands, domain.LiveTerminalCommand{Model: database.Model{ID: uuid.New()}, SessionID: open, Terminal: 1, Command: "pwd", RanAt: w.now})

	rooms, err := w.svc.LinkedRooms(ctx, []uuid.UUID{lesson, lesson2})
	require.NoError(t, err)
	require.Len(t, rooms, 3)
	assert.Equal(t, []uuid.UUID{ended, second, open}, []uuid.UUID{rooms[0].Session.ID, rooms[1].Session.ID, rooms[2].Session.ID}, "oldest first")
	assert.Equal(t, []int{2, 0, 1}, []int{rooms[0].CommandCount, rooms[1].CommandCount, rooms[2].CommandCount})
	assert.Equal(t, lesson, *rooms[0].Session.ClassSessionID)
	assert.Equal(t, lesson2, *rooms[1].Session.ClassSessionID)

	none, err := w.svc.LinkedRooms(ctx, nil)
	require.NoError(t, err)
	assert.NotNil(t, none)
	assert.Empty(t, none)

	active, found, err := w.svc.ActiveRoom(ctx, w.class)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, open, active.ID)
	assert.Equal(t, lesson, *active.ClassSessionID)
	_, found, err = w.svc.ActiveRoom(ctx, w.archived)
	require.NoError(t, err)
	assert.False(t, found, "a class with no open room")
}
