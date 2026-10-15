package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// rename gives the class a name of its own, so the rooms can be told apart.
func (e env) rename(t *testing.T, class uuid.UUID, name string) {
	t.Helper()
	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE classes SET name = ? WHERE id = ?", name, class).Error)
}

// openRoomIn opens a room in the class, started at the given moment.
func (e env) openRoomIn(t *testing.T, class uuid.UUID, title string, started time.Time) domain.LiveClassroomSession {
	t.Helper()
	s := e.session(class, started)
	s.Title = title
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	return s
}

// Covers SPEC-067 CA-01, CA-03 (RN-01, RN-02, RN-03, RN-06): the student gets the open rooms of the classes where the enrollment is ACTIVE, and only
// them, in one query.
func TestListOpenRoomsOfStudent_OnlyOpenRoomsOfActiveEnrollments(t *testing.T) {
	e := newEnv(t)
	e.rename(t, e.class.ID, "Sistemas Operacionais")
	mine := e.openRoomIn(t, e.class.ID, "Processos", e.now)

	// Not seen: a pending enrollment, an enrollment that was deleted, a room that ended or was deleted, a class that was deleted, and a
	// class where the student is not enrolled.
	pending := e.newClass(t, "SO01P", e.student.ID)
	e.openRoomIn(t, pending.ID, "Pendente", e.now)
	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE class_enrollments SET status = 'PENDING_MODERATION' WHERE class_id = ? AND user_id = ?", pending.ID, e.student.ID).Error)

	left := e.newClass(t, "SO02L", e.student.ID)
	e.openRoomIn(t, left.ID, "Saiu", e.now)
	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE class_enrollments SET deleted_at = now() WHERE class_id = ? AND user_id = ?", left.ID, e.student.ID).Error)

	ended := e.newClass(t, "SO03E", e.student.ID)
	endedRoom := e.openRoomIn(t, ended.ID, "Encerrada", e.now.Add(-2*time.Hour))
	endedRoom.End(e.now.Add(-time.Hour))
	require.NoError(t, e.repo.SaveSession(e.ctx, &endedRoom))

	removed := e.newClass(t, "SO04R", e.student.ID)
	removedRoom := e.openRoomIn(t, removed.ID, "Apagada", e.now)
	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE live_classroom_sessions SET deleted_at = now() WHERE id = ?", removedRoom.ID).Error)

	gone := e.newClass(t, "SO05G", e.student.ID)
	e.openRoomIn(t, gone.ID, "Turma excluída", e.now)
	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE classes SET deleted_at = now() WHERE id = ?", gone.ID).Error)

	other := e.newStudent(t, "1000002", "Bia")
	strangers := e.newClass(t, "SO06S", other.ID)
	e.openRoomIn(t, strangers.ID, "De outra turma", e.now)

	rooms, err := e.repo.ListOpenRoomsOfStudent(e.ctx, e.student.ID)
	require.NoError(t, err)
	require.Len(t, rooms, 1)
	assert.Equal(t, e.class.ID, rooms[0].ClassID)
	assert.Equal(t, "Sistemas Operacionais", rooms[0].ClassName)
	assert.Equal(t, mine.ID, rooms[0].SessionID)
	assert.Equal(t, "Processos", rooms[0].Title)
	assert.True(t, mine.StartedAt.Equal(rooms[0].StartedAt), "the start of the room")

	// The other student sees only the room of his own class.
	theirs, err := e.repo.ListOpenRoomsOfStudent(e.ctx, other.ID)
	require.NoError(t, err)
	require.Len(t, theirs, 1)
	assert.Equal(t, strangers.ID, theirs[0].ClassID)

	// A student with no class at all gets nothing.
	nobody := e.newStudent(t, "1000003", "Caio")
	none, err := e.repo.ListOpenRoomsOfStudent(e.ctx, nobody.ID)
	require.NoError(t, err)
	assert.Empty(t, none)
}

// Covers SPEC-067 CA-14, CA-15 (RN-07, RN-08): rooms of several classes come together, the newest first, and a room that the teacher kept open from
// the day before, to answer doubts, is still there.
func TestListOpenRoomsOfStudent_NewestFirstAndNoLookAtTheSchedule(t *testing.T) {
	e := newEnv(t)
	e.rename(t, e.class.ID, "Turma A")
	keptOpen := e.openRoomIn(t, e.class.ID, "Dúvidas de ontem", e.now.Add(-30*time.Hour))

	b := e.newClass(t, "SO07B", e.student.ID)
	e.rename(t, b.ID, "Turma B")
	today := e.openRoomIn(t, b.ID, "Aula de hoje", e.now.Add(-10*time.Minute))

	c := e.newClass(t, "SO08C", e.student.ID)
	e.rename(t, c.ID, "Turma C")
	newest := e.openRoomIn(t, c.ID, "Agora", e.now)

	rooms, err := e.repo.ListOpenRoomsOfStudent(e.ctx, e.student.ID)
	require.NoError(t, err)
	require.Len(t, rooms, 3)
	assert.Equal(t, []uuid.UUID{newest.ID, today.ID, keptOpen.ID}, []uuid.UUID{rooms[0].SessionID, rooms[1].SessionID, rooms[2].SessionID})
	assert.Equal(t, []string{"Turma C", "Turma B", "Turma A"}, []string{rooms[0].ClassName, rooms[1].ClassName, rooms[2].ClassName})
}
