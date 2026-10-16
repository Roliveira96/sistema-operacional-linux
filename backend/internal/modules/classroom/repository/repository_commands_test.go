package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-071: the commands of the teacher in the live classroom ----

// lesson inserts a lesson of the schedule of the class, which a room may be linked to.
func (e env) lesson(t *testing.T, class uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	require.NoError(t, e.db.Conn(e.ctx).Exec(`INSERT INTO class_sessions (id, class_id, date, start_time, end_time, lesson_count, mode, status, origin, created_at, updated_at)
        VALUES (?, ?, CURRENT_DATE, '08:00', '10:00', 2, 'IN_PERSON', 'SCHEDULED', 'EXTRA', NOW(), NOW())`, id, class).Error)
	return id
}

// command saves a command of the room, with the moment the test chose.
func (e env) command(t *testing.T, s domain.LiveClassroomSession, terminal int, cmd string, status *int, output string, at time.Time) domain.LiveTerminalCommand {
	t.Helper()
	c := domain.LiveTerminalCommand{SessionID: s.ID, Terminal: terminal, Command: cmd, ExitStatus: status, Output: output, RanAt: at}
	require.NoError(t, e.repo.CreateCommand(e.ctx, &c))
	return c
}

// linkedRoom inserts a room of the class linked to a lesson; an ended one when ended is set.
func (e env) linkedRoom(t *testing.T, class uuid.UUID, lesson *uuid.UUID, started time.Time, ended bool) domain.LiveClassroomSession {
	t.Helper()
	s := e.session(class, started)
	s.ClassSessionID = lesson
	if ended {
		at := started.Add(time.Hour)
		s.Status, s.EndedAt = domain.StatusFinished, &at
	}
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	return s
}

// Covers SPEC-071 CA-06 and section 4: the commands are saved and read back in the order they ran, whatever the order they were saved in, with
// the exit status (or none) and the output; the count is of the room alone.
func TestCommands_OrderedByRanAt(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	zero, two := 0, 2
	third := e.command(t, s, 1, "cat x", &two, "cat: x: No such file or directory\n", e.now.Add(3*time.Second))
	first := e.command(t, s, 1, "ls", &zero, "a\nb\n", e.now.Add(1*time.Second))
	second := e.command(t, s, 2, "sleep 100", nil, "", e.now.Add(2*time.Second))
	other := e.newClass(t, "SO99X")
	otherRoom := e.session(other.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &otherRoom))
	e.command(t, otherRoom, 1, "de outra sala", &zero, "", e.now)

	list, err := e.repo.ListCommands(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []uuid.UUID{first.ID, second.ID, third.ID}, []uuid.UUID{list[0].ID, list[1].ID, list[2].ID})
	assert.Equal(t, "ls", list[0].Command)
	assert.Equal(t, "a\nb\n", list[0].Output)
	assert.Equal(t, 0, *list[0].ExitStatus)
	assert.Nil(t, list[1].ExitStatus)
	assert.Equal(t, 2, list[1].Terminal)
	assert.Equal(t, 2, *list[2].ExitStatus)
	assert.False(t, list[2].OutputTruncated)

	n, err := e.repo.CountCommands(e.ctx, s.ID)
	require.NoError(t, err)
	assert.EqualValues(t, 3, n)

	none, err := e.repo.ListCommands(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.NotNil(t, none)
	assert.Empty(t, none)
}

// Covers SPEC-071 CA-01 and section 3.2 (the port of the schedule): the rooms linked to any of the lessons asked, oldest first, each with how
// many commands it has; rooms of other lessons, and rooms linked to none, stay out.
func TestLinkedSessions_WithTheirCommandCounts(t *testing.T) {
	e := newEnv(t)
	lesson, lesson2, unasked := e.lesson(t, e.class.ID), e.lesson(t, e.class.ID), e.lesson(t, e.class.ID)
	zero := 0
	ended := e.linkedRoom(t, e.class.ID, &lesson, e.now.Add(-2*time.Hour), true)
	second := e.linkedRoom(t, e.class.ID, &lesson2, e.now.Add(-time.Hour), true)
	open := e.linkedRoom(t, e.class.ID, &lesson, e.now, false)
	e.linkedRoom(t, e.class.ID, &unasked, e.now.Add(-3*time.Hour), true)
	e.linkedRoom(t, e.class.ID, nil, e.now.Add(-4*time.Hour), true)
	e.command(t, ended, 1, "ls", &zero, "", e.now.Add(-2*time.Hour))
	e.command(t, ended, 1, "pwd", &zero, "", e.now.Add(-2*time.Hour+time.Second))
	e.command(t, open, 1, "whoami", &zero, "", e.now)

	rooms, err := e.repo.ListLinkedSessions(e.ctx, []uuid.UUID{lesson, lesson2})
	require.NoError(t, err)
	require.Len(t, rooms, 3)
	assert.Equal(t, []uuid.UUID{ended.ID, second.ID, open.ID}, []uuid.UUID{rooms[0].Session.ID, rooms[1].Session.ID, rooms[2].Session.ID}, "oldest first")
	assert.Equal(t, []int{2, 0, 1}, []int{rooms[0].CommandCount, rooms[1].CommandCount, rooms[2].CommandCount})
	assert.Equal(t, lesson, *rooms[0].Session.ClassSessionID)
	assert.Equal(t, domain.StatusFinished, rooms[0].Session.Status)
	assert.NotNil(t, rooms[0].Session.EndedAt)
	assert.Equal(t, domain.StatusActive, rooms[2].Session.Status)

	none, err := e.repo.ListLinkedSessions(e.ctx, nil)
	require.NoError(t, err)
	assert.NotNil(t, none)
	assert.Empty(t, none)
}
