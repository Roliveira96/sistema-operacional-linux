package service_test

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
)

// ---- SPEC-063: the chat of the lesson ----

// the repository double keeps the messages of the chat in the order they were saved
func (f *fakeRepo) CreateChatMessage(_ context.Context, m *domain.LiveChatMessage) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	f.chat = append(f.chat, *m)
	return nil
}

// ListChatMessages is the reading of the real repository: the last `limit` messages, oldest first; with no student it is the panel's, with
// one it is the messages for everybody and the ones of his conversation.
func (f *fakeRepo) ListChatMessages(_ context.Context, session uuid.UUID, student *uuid.UUID, limit int) ([]domain.LiveChatMessage, error) {
	var out []domain.LiveChatMessage
	for _, m := range f.chat {
		if m.SessionID == session && (student == nil || m.StudentID == nil || *m.StudentID == *student) {
			out = append(out, m)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out, nil
}

// chatRoom opens a room with Ana (the student of the world) and Bruno admitted; time moves one second with each message.
func chatRoom(t *testing.T) (*world, domain.LiveClassroomSession, service.Actor) {
	t.Helper()
	w := setup(t)
	s := w.start(t)
	bruno := twoStudents(t, w, s.ID)
	return w, s, bruno
}

func (w *world) sendChat(t *testing.T, from service.Actor, session uuid.UUID, to *uuid.UUID, text string) domain.LiveChatMessage {
	t.Helper()
	w.now = w.now.Add(time.Second)
	m, err := w.svc.SendChat(context.Background(), from, session, to, text)
	require.NoError(t, err, text)
	return m
}

func chatTexts(list []domain.LiveChatMessage) []string {
	out := make([]string, len(list))
	for i, m := range list {
		out[i] = m.Body
	}
	return out
}

// Covers SPEC-063 CA-04 and section 3.2: an admitted student writes to the teacher, in his own conversation; the text is trimmed and the
// server gives the id and the moment.
func TestSendChat_AdmittedStudentWritesInHisConversation(t *testing.T) {
	w, s, _ := chatRoom(t)
	w.now = w.now.Add(time.Second)

	m, err := w.svc.SendChat(context.Background(), w.student, s.ID, nil, "  Professor, não entendi o fork\n ")
	require.NoError(t, err)
	assert.NotEqual(t, uuid.Nil, m.ID)
	assert.Equal(t, s.ID, m.SessionID)
	assert.Equal(t, w.student.UserID, m.SenderID)
	assert.Equal(t, domain.ChatSenderStudent, m.SenderRole)
	require.NotNil(t, m.StudentID)
	assert.Equal(t, w.student.UserID, *m.StudentID, "the conversation is his")
	assert.Equal(t, "Professor, não entendi o fork", m.Body, "trimmed")
	assert.True(t, m.CreatedAt.Equal(w.now), "the moment is the server's")
	assert.Equal(t, []domain.LiveChatMessage{m}, w.repo.chat, "what was returned is what was kept")
}

// Covers SPEC-063 CA-05: a student who is not admitted to this room writes nothing: one who never asked to come in, one who waits, one who
// was removed, one of no class of the room, and a room that does not exist or has ended.
func TestSendChat_OnlyAnAdmittedStudent(t *testing.T) {
	w := setup(t)
	ctx := context.Background()
	s := w.start(t)

	_, err := w.svc.SendChat(ctx, w.student, s.ID, nil, "posso entrar?")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "he never asked to come in")
	_, err = w.svc.Connect(ctx, w.student, w.class) // now he waits
	require.NoError(t, err)
	_, err = w.svc.SendChat(ctx, w.student, s.ID, nil, "posso entrar?")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "waiting")
	_, err = w.svc.SendChat(ctx, w.outside, s.ID, nil, "sou de outra turma")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "a student who is not of the class")

	w.admit(s.ID, w.student.UserID)
	_, err = w.svc.Remove(ctx, w.teacher, s.ID, w.student.UserID)
	require.NoError(t, err)
	_, err = w.svc.SendChat(ctx, w.student, s.ID, nil, "posso voltar?")
	assert.ErrorIs(t, err, domain.ErrNotAdmitted, "removed")

	_, err = w.svc.SendChat(ctx, w.student, uuid.New(), nil, "outra sala")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a room that does not exist")
	w.admit(s.ID, w.student.UserID)
	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	_, err = w.svc.SendChat(ctx, w.student, s.ID, nil, "a aula acabou")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound, "a room that has ended takes no message")

	assert.Empty(t, w.repo.chat, "nothing was kept")
}

// Covers SPEC-063 CA-05 and section 3.1: the student writes only to the teacher: a recipient is refused, even his own id.
func TestSendChat_StudentCannotChooseTheRecipient(t *testing.T) {
	w, s, bruno := chatRoom(t)
	ctx := context.Background()

	_, err := w.svc.SendChat(ctx, w.student, s.ID, &bruno.UserID, "oi, Bruno")
	assert.ErrorIs(t, err, domain.ErrForbidden, "to another student")
	_, err = w.svc.SendChat(ctx, w.student, s.ID, &w.student.UserID, "oi, eu")
	assert.ErrorIs(t, err, domain.ErrForbidden, "to himself")
	assert.Empty(t, w.repo.chat)
}

// Covers SPEC-063 CA-02, CA-03 and section 3.2: the teacher who runs the class writes to one admitted student, in particular, or to all.
// The administrator may too.
func TestSendChat_TeacherToOneStudentAndToAll(t *testing.T) {
	w, s, bruno := chatRoom(t)

	one := w.sendChat(t, w.teacher, s.ID, &bruno.UserID, " Já explico \n")
	assert.Equal(t, domain.ChatSenderTeacher, one.SenderRole)
	assert.Equal(t, w.teacher.UserID, one.SenderID)
	require.NotNil(t, one.StudentID)
	assert.Equal(t, bruno.UserID, *one.StudentID, "the conversation is Bruno's, whoever wrote")
	assert.Equal(t, "Já explico", one.Body)
	assert.True(t, one.CreatedAt.Equal(w.now))
	assert.NotEqual(t, uuid.Nil, one.ID)

	all := w.sendChat(t, w.teacher, s.ID, nil, "Atenção, turma")
	assert.Equal(t, domain.ChatSenderTeacher, all.SenderRole)
	assert.Nil(t, all.StudentID, "for everybody: no student")

	byAdmin := w.sendChat(t, w.admin, s.ID, &w.student.UserID, "do administrador")
	assert.Equal(t, w.admin.UserID, byAdmin.SenderID)
	assert.Equal(t, domain.ChatSenderTeacher, byAdmin.SenderRole)
	assert.Equal(t, []domain.LiveChatMessage{one, all, byAdmin}, w.repo.chat)
}

// Covers SPEC-063 CA-05: the student that the teacher writes to must be admitted to the room: not one who waits, who was removed, who
// never came, the teacher himself, nor someone else.
func TestSendChat_TheRecipientMustBeAnAdmittedStudent(t *testing.T) {
	w, s, _ := chatRoom(t)
	ctx := context.Background()
	waiting := w.newStudent("Carla")
	_, err := w.svc.Connect(ctx, waiting, w.class)
	require.NoError(t, err)
	removed := w.newStudent("Dani")
	w.admit(s.ID, removed.UserID)
	_, err = w.svc.Remove(ctx, w.teacher, s.ID, removed.UserID)
	require.NoError(t, err)

	for name, id := range map[string]uuid.UUID{
		"waiting": waiting.UserID, "removed": removed.UserID, "never came": w.outside.UserID, "the teacher": w.teacher.UserID, "nobody": uuid.New(),
	} {
		to := id
		_, err := w.svc.SendChat(ctx, w.teacher, s.ID, &to, "mensagem")
		assert.ErrorIs(t, err, domain.ErrNotAdmitted, name)
	}
	assert.Empty(t, w.repo.chat, "nothing was kept")
}

// Covers SPEC-063 CA-05: only who runs the class writes as the teacher: not another teacher, and no other role; and not in a room that does
// not exist or has ended.
func TestSendChat_OnlyWhoRunsTheClass(t *testing.T) {
	w, s, _ := chatRoom(t)
	ctx := context.Background()

	_, err := w.svc.SendChat(ctx, w.other, s.ID, nil, "de outro professor")
	assert.ErrorIs(t, err, domain.ErrForbidden, "a teacher of another class")
	_, err = w.svc.SendChat(ctx, service.Actor{UserID: uuid.New(), Role: "GUEST"}, s.ID, nil, "de um papel que não existe")
	assert.ErrorIs(t, err, domain.ErrForbidden, "another role")
	_, err = w.svc.SendChat(ctx, w.teacher, uuid.New(), nil, "outra sala")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)

	_, err = w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)
	_, err = w.svc.SendChat(ctx, w.teacher, s.ID, nil, "a aula acabou")
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	assert.Empty(t, w.repo.chat)
}

// Covers SPEC-063 CA-05 and CA-10: the text is checked before anything is kept, for a student and for the teacher: empty, over 500
// characters, a control character, too many line breaks. 500 characters of any size pass, and the text is kept as it came.
func TestSendChat_TheTextIsChecked(t *testing.T) {
	w, s, bruno := chatRoom(t)
	ctx := context.Background()
	bad := []string{"", " \t\n ", strings.Repeat("a", 501), strings.Repeat("😀", 501), "a\tb", "a\x00b", "a\r\nb", "a\n\n\n\nb", "a\xffb"}

	for _, text := range bad {
		_, err := w.svc.SendChat(ctx, w.student, s.ID, nil, text)
		assert.ErrorIs(t, err, domain.ErrInvalidChatText, "student: %q", text)
		_, err = w.svc.SendChat(ctx, w.teacher, s.ID, &bruno.UserID, text)
		assert.ErrorIs(t, err, domain.ErrInvalidChatText, "teacher: %q", text)
		_, err = w.svc.SendChat(ctx, w.teacher, s.ID, nil, text)
		assert.ErrorIs(t, err, domain.ErrInvalidChatText, "teacher to all: %q", text)
	}
	assert.Empty(t, w.repo.chat, "a refused text never reached the repository")

	for _, text := range []string{strings.Repeat("a", 500), strings.Repeat("ã", 500), strings.Repeat("😀", 500), "<b>oi</b>\n\n\nlinha & 'aspas'"} {
		m := w.sendChat(t, w.student, s.ID, nil, text)
		assert.Equal(t, text, m.Body, "kept as it came")
	}
}

// chatHistoryWorld has Ana, Bruno and Carla in the room and five messages in the chat, a second apart.
func chatHistoryWorld(t *testing.T) (w *world, s domain.LiveClassroomSession, ana, bruno, carla service.Actor) {
	t.Helper()
	w, s, bruno = chatRoom(t)
	ana = w.student
	carla = w.newStudent("Carla")
	w.admit(s.ID, carla.UserID)
	w.sendChat(t, ana, s.ID, nil, "da Ana ao professor")
	w.sendChat(t, w.teacher, s.ID, &ana.UserID, "do professor à Ana")
	w.sendChat(t, w.teacher, s.ID, nil, "do professor para todos")
	w.sendChat(t, bruno, s.ID, nil, "do Bruno ao professor")
	w.sendChat(t, w.teacher, s.ID, &bruno.UserID, "do professor ao Bruno")
	return w, s, ana, bruno, carla
}

// Covers SPEC-063 CA-06, CA-02 to CA-04: the history of a student has the messages for everybody and the ones of his own conversation, and
// never another student's, oldest first; the history of the panel has them all.
func TestChatHistory_ByRole(t *testing.T) {
	w, s, ana, bruno, carla := chatHistoryWorld(t)
	ctx := context.Background()

	for _, tc := range []struct {
		name string
		who  *uuid.UUID
		want []string
	}{
		{"the panel", nil, []string{"da Ana ao professor", "do professor à Ana", "do professor para todos", "do Bruno ao professor", "do professor ao Bruno"}},
		{"Ana", &ana.UserID, []string{"da Ana ao professor", "do professor à Ana", "do professor para todos"}},
		{"Bruno", &bruno.UserID, []string{"do professor para todos", "do Bruno ao professor", "do professor ao Bruno"}},
		{"Carla, who never wrote", &carla.UserID, []string{"do professor para todos"}},
	} {
		got, err := w.svc.ChatHistory(ctx, s.ID, tc.who)
		require.NoError(t, err, tc.name)
		assert.Equal(t, tc.want, chatTexts(got), tc.name)
	}

	other := uuid.New()
	empty, err := w.svc.ChatHistory(ctx, other, nil)
	require.NoError(t, err)
	assert.Empty(t, empty, "a room with no messages")
}

// Covers SPEC-063 CA-06: the history is the last 200 messages for a student and the last 500 for the panel, oldest first.
func TestChatHistory_Limits(t *testing.T) {
	w, s, _ := chatRoom(t)
	ctx := context.Background()
	for i := 0; i < 600; i++ {
		w.now = w.now.Add(time.Millisecond)
		_, err := w.svc.SendChat(ctx, w.teacher, s.ID, nil, fmt.Sprintf("m%03d", i))
		require.NoError(t, err)
	}

	student, err := w.svc.ChatHistory(ctx, s.ID, &w.student.UserID)
	require.NoError(t, err)
	require.Len(t, student, 200)
	assert.Equal(t, "m400", student[0].Body)
	assert.Equal(t, "m599", student[199].Body, "oldest first: the newest is the last")

	panel, err := w.svc.ChatHistory(ctx, s.ID, nil)
	require.NoError(t, err)
	require.Len(t, panel, 500)
	assert.Equal(t, "m100", panel[0].Body)
	assert.Equal(t, "m599", panel[499].Body)
}

// Covers SPEC-063 CA-06 and section 3.2: the room that ends does not erase the messages.
func TestChatHistory_SurvivesTheEndOfTheRoom(t *testing.T) {
	w, s, ana, _, _ := chatHistoryWorld(t)
	ctx := context.Background()
	_, err := w.svc.EndSession(ctx, w.teacher, w.class, s.ID)
	require.NoError(t, err)

	got, err := w.svc.ChatHistory(ctx, s.ID, &ana.UserID)
	require.NoError(t, err)
	assert.Equal(t, []string{"da Ana ao professor", "do professor à Ana", "do professor para todos"}, chatTexts(got))
	assert.Len(t, w.repo.chat, 5)
}
