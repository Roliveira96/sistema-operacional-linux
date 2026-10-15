package repository_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

// ---- SPEC-063: the chat of the lesson ----

// chat saves a message of the room, with the moment the test chose.
func (e env) chat(t *testing.T, s domain.LiveClassroomSession, sender uuid.UUID, role string, student *uuid.UUID, body string, at time.Time) domain.LiveChatMessage {
	t.Helper()
	m := domain.LiveChatMessage{SessionID: s.ID, SenderID: sender, SenderRole: role, StudentID: student, Body: body}
	m.CreatedAt = at
	require.NoError(t, e.repo.CreateChatMessage(e.ctx, &m))
	return m
}

func chatIDs(list []domain.LiveChatMessage) []uuid.UUID {
	out := make([]uuid.UUID, len(list))
	for i, m := range list {
		out[i] = m.ID
	}
	return out
}

func chatBodies(list []domain.LiveChatMessage) []string {
	out := make([]string, len(list))
	for i, m := range list {
		out[i] = m.Body
	}
	return out
}

// Covers SPEC-063 CA-06 and section 3.2: the messages are saved and read back, oldest first, by who reads: the panel reads them all; a
// student reads the ones for everybody and the ones of his own conversation (his own and the teacher's to him), and no other student's.
func TestChat_SavedAndReadByRole(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	ana := e.student
	bruno := e.newStudent(t, "1000002", "Bruno")
	carla := e.newStudent(t, "1000003", "Carla")
	other := e.newClass(t, "SO99X")
	otherRoom := e.session(other.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &otherRoom))

	m1 := e.chat(t, s, ana.ID, domain.ChatSenderStudent, &ana.ID, "Professor, não entendi o fork", e.now.Add(1*time.Second))
	m2 := e.chat(t, s, e.teacher.ID, domain.ChatSenderTeacher, &ana.ID, "Já explico, Ana", e.now.Add(2*time.Second))
	m3 := e.chat(t, s, e.teacher.ID, domain.ChatSenderTeacher, nil, "Atenção, turma: o fork cria um processo filho", e.now.Add(3*time.Second))
	m4 := e.chat(t, s, bruno.ID, domain.ChatSenderStudent, &bruno.ID, "Posso entregar amanhã?", e.now.Add(4*time.Second))
	m5 := e.chat(t, s, e.teacher.ID, domain.ChatSenderTeacher, &bruno.ID, "Pode", e.now.Add(5*time.Second))
	e.chat(t, otherRoom, e.teacher.ID, domain.ChatSenderTeacher, nil, "de outra aula", e.now.Add(6*time.Second))

	all, err := e.repo.ListChatMessages(e.ctx, s.ID, nil, 500)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{m1.ID, m2.ID, m3.ID, m4.ID, m5.ID}, chatIDs(all), "the panel reads every message of the room, oldest first")

	for _, tc := range []struct {
		name    string
		student uuid.UUID
		want    []uuid.UUID
	}{
		{"Ana", ana.ID, []uuid.UUID{m1.ID, m2.ID, m3.ID}},
		{"Bruno", bruno.ID, []uuid.UUID{m3.ID, m4.ID, m5.ID}},
		{"Carla, who never wrote", carla.ID, []uuid.UUID{m3.ID}},
	} {
		got, err := e.repo.ListChatMessages(e.ctx, s.ID, &tc.student, 200)
		require.NoError(t, err, tc.name)
		assert.Equal(t, tc.want, chatIDs(got), tc.name)
	}

	// what comes back is what went in
	first := all[0]
	assert.Equal(t, m1.ID, first.ID)
	assert.Equal(t, 7, int(first.ID.Version()), "the id is a UUIDv7 made by the server")
	assert.Equal(t, s.ID, first.SessionID)
	assert.Equal(t, ana.ID, first.SenderID)
	assert.Equal(t, domain.ChatSenderStudent, first.SenderRole)
	require.NotNil(t, first.StudentID)
	assert.Equal(t, ana.ID, *first.StudentID)
	assert.Equal(t, "Professor, não entendi o fork", first.Body)
	assert.True(t, first.CreatedAt.Equal(e.now.Add(time.Second)), "the moment is the one that was given")
	assert.Equal(t, domain.ChatSenderTeacher, all[2].SenderRole)
	assert.Nil(t, all[2].StudentID, "for everybody: no student")

	none, err := e.repo.ListChatMessages(e.ctx, uuid.New(), nil, 500)
	require.NoError(t, err)
	assert.Empty(t, none, "a room with no messages")
}

// Covers SPEC-063 CA-10: the text is kept as it came: line breaks, emoji, quotes and markup are not touched.
func TestChat_BodyIsKeptAsItCame(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	body := "Linha 1\n\nLinha 2 <b>negrito</b> 😀 'a' \"b\"; DROP TABLE live_chat_messages; --"
	e.chat(t, s, e.student.ID, domain.ChatSenderStudent, &e.student.ID, body, e.now)

	got, err := e.repo.ListChatMessages(e.ctx, s.ID, nil, 500)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, body, got[0].Body)
}

// Covers SPEC-063 CA-06 and section 3.1: the history is the last messages, as many as the limit, and they come oldest first: the last 200
// for a student and the last 500 for the panel.
func TestChat_ReadsTheLastOnesOldestFirst(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	var rows []domain.LiveChatMessage
	for i := 0; i < 505; i++ {
		m := domain.LiveChatMessage{SessionID: s.ID, SenderID: e.teacher.ID, SenderRole: domain.ChatSenderTeacher, Body: fmt.Sprintf("m%03d", i)}
		m.CreatedAt = e.now.Add(time.Duration(i) * time.Millisecond)
		rows = append(rows, m)
	}
	require.NoError(t, e.db.Conn(e.ctx).CreateInBatches(&rows, 100).Error)
	// a private message of Bruno, the newest of all: it is the last one for the panel and for him, and not for Ana
	e.chat(t, s, bruno.ID, domain.ChatSenderStudent, &bruno.ID, "do Bruno", e.now.Add(time.Hour))

	panel, err := e.repo.ListChatMessages(e.ctx, s.ID, nil, domain.ChatHistoryPanel)
	require.NoError(t, err)
	require.Len(t, panel, 500)
	assert.Equal(t, "m006", panel[0].Body, "the 500 last: 506 messages, the first 6 are left out")
	assert.Equal(t, "do Bruno", panel[499].Body, "oldest first: the newest is the last")
	assert.Equal(t, "m504", panel[498].Body)

	ana, err := e.repo.ListChatMessages(e.ctx, s.ID, &e.student.ID, domain.ChatHistoryStudent)
	require.NoError(t, err)
	require.Len(t, ana, 200)
	assert.Equal(t, "m305", ana[0].Body, "the 200 last that Ana may read: Bruno's message is not hers")
	assert.Equal(t, "m504", ana[199].Body)
	for i := 1; i < len(ana); i++ {
		assert.True(t, !ana[i].CreatedAt.Before(ana[i-1].CreatedAt), "in order of time")
	}

	himself, err := e.repo.ListChatMessages(e.ctx, s.ID, &bruno.ID, domain.ChatHistoryStudent)
	require.NoError(t, err)
	require.Len(t, himself, 200)
	assert.Equal(t, "m306", himself[0].Body)
	assert.Equal(t, "do Bruno", himself[199].Body)

	few, err := e.repo.ListChatMessages(e.ctx, s.ID, nil, 3)
	require.NoError(t, err)
	assert.Equal(t, []string{"m504", "do Bruno"}, chatBodies(few)[1:], "any limit")
	assert.Len(t, few, 3)
}

// Covers SPEC-063 section 3.2 and CA-05: the database holds the rules of the table, as the service and the domain do: the text has from 1 to
// 500 characters (characters, not bytes); the sender is the teacher or a student; a student writes in his own conversation; and the room,
// the sender and the student exist.
func TestChat_TheDatabaseHoldsTheRules(t *testing.T) {
	e := newEnv(t)
	s := e.openRoom(t)
	ana, nobody := e.student.ID, uuid.New()
	save := func(sender uuid.UUID, role string, student *uuid.UUID, body string) error {
		m := domain.LiveChatMessage{SessionID: s.ID, SenderID: sender, SenderRole: role, StudentID: student, Body: body}
		m.CreatedAt = e.now
		return e.repo.CreateChatMessage(e.ctx, &m)
	}

	assert.NoError(t, save(ana, domain.ChatSenderStudent, &ana, "a"), "one character")
	assert.NoError(t, save(ana, domain.ChatSenderStudent, &ana, strings.Repeat("😀", 500)), "500 characters, 2,000 bytes")
	assert.Error(t, save(ana, domain.ChatSenderStudent, &ana, strings.Repeat("😀", 501)), "501 characters")
	assert.Error(t, save(ana, domain.ChatSenderStudent, &ana, ""), "empty")

	assert.NoError(t, save(e.teacher.ID, domain.ChatSenderTeacher, nil, "para todos"), "the teacher to everybody")
	assert.NoError(t, save(e.teacher.ID, domain.ChatSenderTeacher, &ana, "só para a Ana"), "the teacher to a student")
	assert.Error(t, save(e.teacher.ID, "ADMIN", nil, "outro papel"), "the sender is the teacher or a student")
	assert.Error(t, save(e.teacher.ID, "", nil, "sem papel"), "and has a role")

	assert.Error(t, save(ana, domain.ChatSenderStudent, nil, "para todos"), "a student cannot write to everybody")
	bruno := e.newStudent(t, "1000002", "Bruno")
	assert.Error(t, save(ana, domain.ChatSenderStudent, &bruno.ID, "na conversa do Bruno"), "a student writes only in his own conversation")

	assert.Error(t, save(nobody, domain.ChatSenderTeacher, nil, "remetente que não existe"), "the sender is a user")
	assert.Error(t, save(e.teacher.ID, domain.ChatSenderTeacher, &nobody, "aluno que não existe"), "so is the student")
	m := domain.LiveChatMessage{SessionID: uuid.New(), SenderID: e.teacher.ID, SenderRole: domain.ChatSenderTeacher, Body: "outra sala"}
	m.CreatedAt = e.now
	assert.Error(t, e.repo.CreateChatMessage(e.ctx, &m), "the room exists")
}

// migrationParts splits a migration in its two parts: what goes up and what comes down.
func migrationParts(t *testing.T, prefix string) (up, down string) {
	t.Helper()
	entries, err := migrations.FS.ReadDir(".")
	require.NoError(t, err)
	var text string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), prefix) {
			raw, err := migrations.FS.ReadFile(entry.Name())
			require.NoError(t, err)
			text = string(raw)
		}
	}
	require.NotEmpty(t, text, "migration %s exists", prefix)
	upAt, downAt := strings.Index(text, "-- +goose Up"), strings.Index(text, "-- +goose Down")
	require.True(t, upAt >= 0 && downAt > upAt, "migration %s has its Up and its Down", prefix)
	return text[upAt+len("-- +goose Up") : downAt], text[downAt+len("-- +goose Down"):]
}

func chatTable(t *testing.T, e env) (columns []string, indexes []string) {
	t.Helper()
	require.NoError(t, e.db.Conn(e.ctx).Raw(
		"SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'live_chat_messages' ORDER BY column_name").
		Scan(&columns).Error)
	require.NoError(t, e.db.Conn(e.ctx).Raw(
		"SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'live_chat_messages'").
		Scan(&indexes).Error)
	return columns, indexes
}

// Covers SPEC-063 CA-12 and section 3.2: the migration 00034 creates the table of the chat, with the index of the room and the moment;
// going down takes it away and leaves the rest of the classroom; going up again brings it back, ready to use.
func TestMigration00034_CreatesTheTableAndTakesItBack(t *testing.T) {
	e := newEnv(t) // every migration was applied by the helper
	up, down := migrationParts(t, "00034_")

	columns, indexes := chatTable(t, e)
	assert.Equal(t, []string{"body", "created_at", "deleted_at", "id", "sender_id", "sender_role", "session_id", "student_id", "updated_at"}, columns)
	indexed := false
	for _, def := range indexes {
		indexed = indexed || strings.Contains(def, "(session_id, created_at)")
	}
	assert.True(t, indexed, "an index on (session_id, created_at): %v", indexes)

	s := e.openRoom(t)
	e.chat(t, s, e.student.ID, domain.ChatSenderStudent, &e.student.ID, "ficará só até a reversão", e.now)

	require.NoError(t, e.db.Conn(e.ctx).Exec(down).Error, "the Down runs")
	columns, _ = chatTable(t, e)
	assert.Empty(t, columns, "the Down took the table away")
	found, err := e.repo.FindSession(e.ctx, s.ID)
	require.NoError(t, err, "and left the room")
	assert.Equal(t, s.ID, found.ID)

	require.NoError(t, e.db.Conn(e.ctx).Exec(up).Error, "the Up runs again")
	columns, _ = chatTable(t, e)
	assert.Len(t, columns, 9)
	got, err := e.repo.ListChatMessages(e.ctx, s.ID, nil, 500)
	require.NoError(t, err)
	assert.Empty(t, got, "the table comes back empty")
	e.chat(t, s, e.student.ID, domain.ChatSenderStudent, &e.student.ID, "de novo", e.now)
}
