package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- SPEC-063: the chat of the lesson ----

// chatState is the double of the chat: what the handler asked of the service, and the messages the service kept.
type chatState struct {
	err   error // every SendChat answers with it when set
	calls []chatCall
	log   []domain.LiveChatMessage
}

type chatCall struct {
	actor   service.Actor
	student *uuid.UUID
	text    string
}

// SendChat answers as the real service does: the student writes only to the teacher and must be admitted; the teacher writes to an admitted
// student or to all; the text is checked by the domain.
func (f *fakeService) SendChat(_ context.Context, a service.Actor, session uuid.UUID, student *uuid.UUID, text string) (domain.LiveChatMessage, error) {
	f.record("chat")
	f.mu.Lock()
	defer f.mu.Unlock()
	f.chat.calls = append(f.chat.calls, chatCall{actor: a, student: student, text: text})
	if f.chat.err != nil {
		return domain.LiveChatMessage{}, f.chat.err
	}
	admitted := func(id uuid.UUID) bool { return f.states[id] == domain.AdmissionAdmitted }
	m := domain.LiveChatMessage{SessionID: session, SenderID: a.UserID}
	if a.Role == authn.RoleStudent {
		if student != nil {
			return domain.LiveChatMessage{}, domain.ErrForbidden
		}
		if !admitted(a.UserID) {
			return domain.LiveChatMessage{}, domain.ErrNotAdmitted
		}
		own := a.UserID
		m.SenderRole, m.StudentID = domain.ChatSenderStudent, &own
	} else {
		m.SenderRole = domain.ChatSenderTeacher
		if student != nil {
			if !admitted(*student) {
				return domain.LiveChatMessage{}, domain.ErrNotAdmitted
			}
			m.StudentID = student
		}
	}
	body, err := domain.NormalizeChatText(text)
	if err != nil {
		return domain.LiveChatMessage{}, err
	}
	m.Body = body
	m.ID = uuid.New()
	m.CreatedAt = time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC).Add(time.Duration(len(f.chat.log)+1) * time.Second)
	f.chat.log = append(f.chat.log, m)
	return m, nil
}

// ChatHistory reads the log as the real service does: no student is the panel, with one it is the messages for everybody and his own.
func (f *fakeService) ChatHistory(_ context.Context, _ uuid.UUID, student *uuid.UUID) ([]domain.LiveChatMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []domain.LiveChatMessage
	for _, m := range f.chat.log {
		if student == nil || m.StudentID == nil || *m.StudentID == *student {
			out = append(out, m)
		}
	}
	return out, nil
}

func (f *fakeService) setChatError(err error) {
	f.mu.Lock()
	f.chat.err = err
	f.mu.Unlock()
}

// kept is what the service saved, in order.
func (f *fakeService) kept() []domain.LiveChatMessage {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]domain.LiveChatMessage(nil), f.chat.log...)
}

func (f *fakeService) chatCalls() []chatCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]chatCall(nil), f.chat.calls...)
}

// seedChat puts a message straight in the log, as if it had been sent before the connection under test.
func (f *fakeService) seedChat(session uuid.UUID, sender uuid.UUID, role string, student *uuid.UUID, body string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.chat.log = append(f.chat.log, domain.LiveChatMessage{SessionID: session, SenderID: sender, SenderRole: role, StudentID: student, Body: body,
		CreatedAt: time.Date(2026, 10, 14, 18, 0, 0, 0, time.UTC).Add(time.Duration(len(f.chat.log)) * time.Second)})
	f.chat.log[len(f.chat.log)-1].ID = uuid.New()
}

const typeChatSend = "live:chat:send"

// chatMessage is live:chat:message as a client reads it.
type chatMessage struct {
	ID        string `json:"id"`
	Scope     string `json:"scope"`
	StudentID string `json:"studentId"`
	From      string `json:"from"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
}

// nextChat reads the next live:chat:message of the connection, and checks the shape of the data: the keys of the contract and no others,
// with no studentId for a message to all.
func nextChat(t *testing.T, c *websocket.Conn) chatMessage {
	t.Helper()
	raw := readUntil(t, c, "live:chat:message").Data
	var keys map[string]any
	require.NoError(t, json.Unmarshal(raw, &keys))
	var m chatMessage
	require.NoError(t, json.Unmarshal(raw, &m))
	want := []string{"createdAt", "from", "id", "scope", "text"}
	if m.Scope == "private" {
		want = []string{"createdAt", "from", "id", "scope", "studentId", "text"}
	}
	got := make([]string, 0, len(keys))
	for k := range keys {
		got = append(got, k)
	}
	sort.Strings(got)
	assert.Equal(t, want, got, "the keys of live:chat:message")
	_, err := uuid.Parse(m.ID)
	assert.NoError(t, err, "the id comes from the server")
	_, err = time.Parse(time.RFC3339, m.CreatedAt)
	assert.NoError(t, err, "the moment comes from the server, in RFC 3339")
	return m
}

func (w *world) newPerson(token string) authn.Principal {
	p := authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	w.people[token] = p
	return p
}

func chatSend(t *testing.T, c *websocket.Conn, data string) {
	t.Helper()
	sendMsg(t, c, typeChatSend, data)
}

func droppedChat(w *world) []string {
	var out []string
	for _, r := range droppedReasons(w) {
		if strings.HasPrefix(r, typeChatSend+":") {
			out = append(out, strings.TrimPrefix(r, typeChatSend+":"))
		}
	}
	return out
}

// Covers SPEC-063 CA-02, CA-03, CA-04 and section 3.1: with three students (A with two tabs, B and C), the panel, the presentation window and
// one who waits: a message of A goes to the panel and to A's tabs only; the private message of the teacher to A goes to the panel and A's
// tabs; a message of B goes to the panel and B; the one for everybody goes to the panel and the three students, and never to the
// presentation window or to who waits. B never gets what A wrote or what the teacher said to A, and C gets only what is for everybody.
func TestChat_DeliveredOnlyToWhoMayRead(t *testing.T) {
	w := setup(t)
	w.newPerson("third")
	waiting := w.newPerson("waiting")
	w.svc.states = map[uuid.UUID]string{waiting.UserID: domain.AdmissionWaiting}
	a, aTab, b, c := w.dial(t, "student"), w.dial(t, "second"), w.dial(t, "stranger"), w.dial(t, "third")
	panel, presenter := w.dialView(t, "teacher", "panel"), w.dialView(t, "teacher2", "presenter")
	d := w.dial(t, "waiting")
	for _, conn := range []*websocket.Conn{a, aTab, b, c, panel, presenter} {
		readUntil(t, conn, "live:snapshot")
	}
	readUntil(t, d, "live:admission:state")

	// A writes to the teacher
	chatSend(t, a, `{"text":"Professor, não entendi o fork"}`)
	fromA := nextChat(t, panel)
	assert.Equal(t, "private", fromA.Scope)
	assert.Equal(t, w.student.UserID.String(), fromA.StudentID, "the conversation is A's")
	assert.Equal(t, "STUDENT", fromA.From)
	assert.Equal(t, "Professor, não entendi o fork", fromA.Text)
	assert.Equal(t, "2026-10-14T19:00:01Z", fromA.CreatedAt)
	assert.Equal(t, fromA, nextChat(t, a), "the confirmation of the sending")
	assert.Equal(t, fromA, nextChat(t, aTab), "and in the other tab")

	// the teacher answers A in particular
	chatSend(t, panel, `{"text":"Já explico, Ana","studentId":"`+w.student.UserID.String()+`"}`)
	toA := nextChat(t, panel)
	assert.Equal(t, "private", toA.Scope)
	assert.Equal(t, w.student.UserID.String(), toA.StudentID, "the conversation is A's, whoever wrote")
	assert.Equal(t, "TEACHER", toA.From)
	assert.Equal(t, toA, nextChat(t, a))
	assert.Equal(t, toA, nextChat(t, aTab))

	// B writes to the teacher
	chatSend(t, b, `{"text":"Posso entregar amanhã?"}`)
	fromB := nextChat(t, panel)
	assert.Equal(t, w.stranger.UserID.String(), fromB.StudentID)
	assert.Equal(t, "STUDENT", fromB.From)
	assert.Equal(t, fromB, nextChat(t, b), "B first message is his own: he did not get what A wrote nor what was said to A")

	// the teacher writes to everybody
	chatSend(t, panel, `{"text":"Atenção, turma","to":"all"}`)
	all := nextChat(t, panel)
	assert.Equal(t, "all", all.Scope)
	assert.Empty(t, all.StudentID, "for everybody: no student")
	assert.Equal(t, "TEACHER", all.From)
	for name, conn := range map[string]*websocket.Conn{"A": a, "A tab": aTab, "B": b, "C": c} {
		assert.Equal(t, all, nextChat(t, conn), name+": the next message is the one for everybody")
	}

	// kept before it was sent, one by one
	calls := w.svc.chatCalls()
	require.Len(t, calls, 4)
	assert.Equal(t, w.student.UserID, calls[0].actor.UserID)
	assert.Equal(t, authn.RoleStudent, calls[0].actor.Role)
	assert.Nil(t, calls[0].student, "a student gives no recipient")
	assert.Equal(t, w.teacher.UserID, calls[1].actor.UserID)
	assert.Equal(t, authn.RoleTeacher, calls[1].actor.Role)
	require.NotNil(t, calls[1].student)
	assert.Equal(t, w.student.UserID, *calls[1].student)
	assert.Nil(t, calls[3].student, "to all: no student")
	assert.Equal(t, "Atenção, turma", calls[3].text)
	assert.Len(t, w.svc.kept(), 4)

	// the presentation window and the waiting room get none of it
	nothingMore(t, presenter, "live:chat:message")
	nothingMore(t, d, "live:chat:message")
}

// Covers SPEC-063 CA-05: what the server rejects it rejects without sending anything and with the log "classroom message rejected": the
// student that gives a recipient or any other field, the teacher with no destination, with two, with a destination that is not "all", with an
// id that is not a UUID or of a student that is not admitted, a missing or wrong text, and a text that the domain refuses.
func TestChat_RejectionsSendNothing(t *testing.T) {
	w := setup(t)
	waiting := w.newPerson("waiting")
	w.svc.states = map[uuid.UUID]string{waiting.UserID: domain.AdmissionWaiting}
	a, b := w.dial(t, "student"), w.dial(t, "stranger")
	panel := w.dialView(t, "teacher", "panel")
	for _, conn := range []*websocket.Conn{a, b, panel} {
		readUntil(t, conn, "live:snapshot")
	}
	student, other := w.student.UserID.String(), w.stranger.UserID.String()
	long := strings.Repeat("a", 501)

	// the handler rejects these before it calls the service
	atTheHandler := 0
	for _, data := range []string{
		`{"text":"oi","to":"all"}`, `{"text":"oi","studentId":"` + other + `"}`, `{"text":"oi","studentId":"` + student + `"}`, `{"text":"oi","to":null}`,
		`{"text":"oi","extra":1}`, `{}`, `{"text":null}`, `{"text":123}`, `{"text":["oi"]}`, `"oi"`, `null`, `[]`, `7`,
	} {
		chatSend(t, a, data)
		atTheHandler++
	}
	for _, data := range []string{
		`{"text":"oi"}`,
		`{"text":"oi","to":"all","studentId":"` + student + `"}`,
		`{"text":"oi","to":"everyone"}`, `{"text":"oi","to":""}`, `{"text":"oi","to":1}`,
		`{"text":"oi","studentId":"not-a-uuid"}`, `{"text":"oi","studentId":""}`, `{"text":"oi","studentId":7}`,
		`{"to":"all"}`, `{"studentId":"` + student + `"}`, `{"text":7,"to":"all"}`, `[]`, `null`,
	} {
		chatSend(t, panel, data)
		atTheHandler++
	}
	require.NoError(t, a.WriteJSON(obj{"type": typeChatSend}))
	atTheHandler++ // no data at all

	// the service refuses these: a text of the domain's refusal, a recipient who is not admitted
	atTheService := 0
	for _, data := range []string{
		`{"text":""}`, `{"text":"   "}`, `{"text":"` + long + `"}`, `{"text":"a\u0007b"}`, `{"text":"a\tb"}`, `{"text":"a\n\n\n\nb"}`,
	} {
		chatSend(t, a, data)
		atTheService++
	}
	for _, data := range []string{
		`{"text":"","to":"all"}`, `{"text":"` + long + `","to":"all"}`, `{"text":"a\u0000b","studentId":"` + student + `"}`,
		`{"text":"oi","studentId":"` + waiting.UserID.String() + `"}`, `{"text":"oi","studentId":"` + uuid.NewString() + `"}`,
		`{"text":"oi","studentId":"` + w.teacher.UserID.String() + `"}`,
	} {
		chatSend(t, panel, data)
		atTheService++
	}

	total := atTheHandler + atTheService
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == total })
	assert.Len(t, w.svc.chatCalls(), atTheService, "the others were rejected before they reached the service")
	assert.Empty(t, w.svc.kept(), "nothing was kept")
	assert.Empty(t, w.logs.FilterMessage("classroom message dropped").All(), "these are rejections, not drops")
	senders := map[any]bool{}
	for _, entry := range w.logs.FilterMessage("classroom message rejected").All() {
		assert.Equal(t, typeChatSend, entry.ContextMap()["type"])
		senders[entry.ContextMap()["userId"]] = true
	}
	assert.Equal(t, map[any]bool{w.student.UserID.String(): true, w.teacher.UserID.String(): true}, senders, "the log says who sent it")

	// and nothing was sent: the first message anybody gets is the one that came after
	chatSend(t, panel, `{"text":"agora sim","to":"all"}`)
	sentinel := nextChat(t, panel)
	assert.Equal(t, "agora sim", sentinel.Text)
	assert.Equal(t, sentinel, nextChat(t, a))
	assert.Equal(t, sentinel, nextChat(t, b))
}

// Covers SPEC-063 CA-05: a failure of the service is a rejection too: the log, and nothing sent.
func TestChat_ServiceFailureSendsNothing(t *testing.T) {
	w := setup(t)
	a := w.dial(t, "student")
	panel := w.dialView(t, "teacher", "panel")
	readUntil(t, a, "live:snapshot")
	readUntil(t, panel, "live:snapshot")

	w.svc.setChatError(domain.ErrSessionNotFound)
	chatSend(t, a, `{"text":"oi"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	w.svc.setChatError(nil)

	chatSend(t, a, `{"text":"de novo"}`)
	assert.Equal(t, "de novo", nextChat(t, panel).Text, "the first message of the panel is the one that was kept")
	assert.Equal(t, "de novo", nextChat(t, a).Text)
}

// Covers SPEC-063 CA-05: the sending of the presentation window, of who waits, of who was removed and of a window of the teacher that
// another replaced is dropped, with the log "classroom message dropped"; nothing is kept and nothing is sent.
func TestChat_DiscardedSenders(t *testing.T) {
	w := setup(t)
	waiting := w.newPerson("waiting")
	w.svc.states = map[uuid.UUID]string{waiting.UserID: domain.AdmissionWaiting}
	removed := w.newPerson("removed")
	reader := w.dial(t, "student")
	panel, presenter := w.dialView(t, "teacher", "panel"), w.dialView(t, "teacher2", "presenter")
	for _, conn := range []*websocket.Conn{reader, panel, presenter} {
		readUntil(t, conn, "live:snapshot")
	}
	d := w.dial(t, "waiting")
	readUntil(t, d, "live:admission:state")
	e := w.dial(t, "removed")
	readUntil(t, e, "live:snapshot")
	sendMsg(t, panel, "live:admission:remove", `{"studentId":"`+removed.UserID.String()+`"}`)
	assert.Equal(t, "REMOVED", statusOf(t, readUntil(t, e, "live:admission:state")))

	chatSend(t, presenter, `{"text":"da janela de apresentação","to":"all"}`)
	chatSend(t, d, `{"text":"de quem espera"}`)
	chatSend(t, e, `{"text":"de quem foi removido"}`)
	// a second panel window takes the control, and the first goes on as a passive viewer
	oldPanel := w.dialView(t, "teacher2", "panel")
	readUntil(t, oldPanel, "live:snapshot")
	replacing := w.dialView(t, "teacher", "panel")
	readUntil(t, replacing, "live:snapshot")
	readUntil(t, oldPanel, "live:control:revoked")
	chatSend(t, oldPanel, `{"text":"da janela substituída","to":"all"}`)

	eventually(t, func() bool { return len(droppedChat(w)) == 4 })
	assert.ElementsMatch(t, []string{"wrong-view", "not-admitted", "not-admitted", "not-allowed"}, droppedChat(w))
	assert.Empty(t, w.svc.chatCalls(), "not one reached the service")
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All())

	chatSend(t, replacing, `{"text":"só esta vale","to":"all"}`)
	assert.Equal(t, "só esta vale", nextChat(t, replacing).Text)
	assert.Equal(t, "só esta vale", nextChat(t, reader).Text, "the student's first message is the valid one")
	nothingMore(t, presenter, "live:chat:message")
	nothingMore(t, d, "live:chat:message")
	nothingMore(t, e, "live:chat:message")
}

// Covers SPEC-063 CA-02 to CA-06 and the plan of tests: the chat counts against the rate limit of its sender.
func TestChat_IsLimitedByRate(t *testing.T) {
	w := setup(t)
	a := w.dial(t, "student")
	readUntil(t, a, "live:snapshot")

	const burst = 80
	for i := 0; i < burst; i++ {
		chatSend(t, a, `{"text":"spam"}`)
	}
	limited := func() int {
		n := 0
		for _, r := range droppedChat(w) {
			if r == "rate-limit" {
				n++
			}
		}
		return n
	}
	eventually(t, func() bool { return len(w.svc.chatCalls())+limited() == burst })
	assert.Positive(t, limited(), "some of the burst was dropped")
	assert.Positive(t, len(w.svc.chatCalls()), "and the first ones were not")
	assert.Less(t, len(w.svc.chatCalls()), burst)
}

func chatTextsOf(t *testing.T, snap map[string]any) []string {
	t.Helper()
	list, ok := snap["chat"].([]any)
	require.True(t, ok, "chat is a list")
	out := make([]string, len(list))
	for i, m := range list {
		out[i] = m.(map[string]any)["text"].(string)
	}
	return out
}

// Covers SPEC-063 CA-06 and section 3.1: the snapshot carries the history by role: the student gets what is for everybody and his own
// conversation, never another student's; the panel gets everything; the presentation window gets no chat. onlineStudents is for the panel
// only, with the admitted that are online (once each), in order.
func TestChat_SnapshotByRole(t *testing.T) {
	w := setup(t)
	third, waiting := w.newPerson("third"), w.newPerson("waiting")
	w.svc.states = map[uuid.UUID]string{waiting.UserID: domain.AdmissionWaiting}
	ana, bruno := w.student.UserID, w.stranger.UserID
	w.svc.seedChat(w.session.ID, ana, "STUDENT", &ana, "da Ana ao professor")
	w.svc.seedChat(w.session.ID, w.teacher.UserID, "TEACHER", &ana, "do professor à Ana")
	w.svc.seedChat(w.session.ID, w.teacher.UserID, "TEACHER", nil, "do professor para todos")
	w.svc.seedChat(w.session.ID, bruno, "STUDENT", &bruno, "do Bruno ao professor")
	w.svc.seedChat(w.session.ID, w.teacher.UserID, "TEACHER", &bruno, "do professor ao Bruno")

	a, aTab, b, c := w.dial(t, "student"), w.dial(t, "second"), w.dial(t, "stranger"), w.dial(t, "third")
	waitingConn := w.dial(t, "waiting")
	readUntil(t, waitingConn, "live:admission:state")
	snaps := map[string]map[string]any{"Ana": snapshotOf(t, a), "Ana tab": snapshotOf(t, aTab), "Bruno": snapshotOf(t, b), "Carla": snapshotOf(t, c)}
	assert.Equal(t, []string{"da Ana ao professor", "do professor à Ana", "do professor para todos"}, chatTextsOf(t, snaps["Ana"]))
	assert.Equal(t, chatTextsOf(t, snaps["Ana"]), chatTextsOf(t, snaps["Ana tab"]))
	assert.Equal(t, []string{"do professor para todos", "do Bruno ao professor", "do professor ao Bruno"}, chatTextsOf(t, snaps["Bruno"]))
	assert.Equal(t, []string{"do professor para todos"}, chatTextsOf(t, snaps["Carla"]), "who never wrote has the ones for everybody")
	for name, snap := range snaps {
		assert.NotContains(t, snap, "onlineStudents", name+": only the panel is told who is online")
	}
	first := snaps["Ana"]["chat"].([]any)[0].(map[string]any)
	assert.Equal(t, "private", first["scope"])
	assert.Equal(t, ana.String(), first["studentId"])
	assert.Equal(t, "STUDENT", first["from"])
	assert.Contains(t, first, "id")
	assert.Equal(t, "2026-10-14T18:00:00Z", first["createdAt"])
	forAll := snaps["Ana"]["chat"].([]any)[2].(map[string]any)
	assert.Equal(t, "all", forAll["scope"])
	assert.NotContains(t, forAll, "studentId", "for everybody: no student")

	panel := snapshotOf(t, w.dialView(t, "teacher", "panel"))
	assert.Equal(t, []string{"da Ana ao professor", "do professor à Ana", "do professor para todos", "do Bruno ao professor", "do professor ao Bruno"}, chatTextsOf(t, panel),
		"the panel reads everything")
	online := []string{ana.String(), bruno.String(), third.UserID.String()}
	sort.Strings(online)
	assert.Equal(t, toAny(online), panel["onlineStudents"], "three students online (Ana has two tabs), in order, and not who waits")

	presenter := snapshotOf(t, w.dialView(t, "teacher2", "presenter"))
	assert.NotContains(t, presenter, "chat", "the presentation window gets no chat")
	assert.NotContains(t, presenter, "onlineStudents")
}

func toAny(list []string) []any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

// Covers SPEC-063 CA-06: with no messages the history is an empty list, not null, and so is the list of who is online.
func TestChat_SnapshotWithNoMessages(t *testing.T) {
	w := setup(t)
	student := snapshotOf(t, w.dial(t, "student"))
	assert.Equal(t, []any{}, student["chat"])
	panel := snapshotOf(t, w.dialView(t, "teacher", "panel"))
	assert.Equal(t, []any{}, panel["chat"])
	assert.Equal(t, toAny([]string{w.student.UserID.String()}), panel["onlineStudents"])

	other := snapshotOf(t, w.dialView(t, "teacher2", "panel"))
	assert.Equal(t, []any{}, other["chat"])
}

// Covers SPEC-063 CA-06: the student who is admitted gets the history in the snapshot of his admission, his own and the ones for everybody.
func TestChat_AdmittedStudentGetsHisHistory(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	teacher := w.dial(t, "teacher")
	readUntil(t, teacher, "live:snapshot")
	student := w.dial(t, "student")
	readUntil(t, student, "live:admission:state")
	ana, bruno := w.student.UserID, w.stranger.UserID
	w.svc.seedChat(w.session.ID, w.teacher.UserID, "TEACHER", nil, "para todos")
	w.svc.seedChat(w.session.ID, bruno, "STUDENT", &bruno, "do Bruno")
	w.svc.seedChat(w.session.ID, w.teacher.UserID, "TEACHER", &ana, "para a Ana")

	sendMsg(t, teacher, "live:admission:accept", `{"studentId":"`+ana.String()+`"}`)
	snap := snapshotOf(t, student)
	assert.Equal(t, []string{"para todos", "para a Ana"}, chatTextsOf(t, snap))
	assert.NotContains(t, snap, "onlineStudents")
}

// Covers SPEC-063 section 3.1: GET /classes/:id/live/active does not change: no chat, no list of who is online.
func TestChat_ActiveRouteIsTheSame(t *testing.T) {
	w := setup(t)
	w.svc.seedChat(w.session.ID, w.teacher.UserID, "TEACHER", nil, "para todos")
	student := w.dial(t, "student")
	readUntil(t, student, "live:snapshot")
	for _, token := range []string{"teacher", "student"} {
		code, body := w.call(t, token, http.MethodGet, w.path("/active"), nil)
		require.Equal(t, http.StatusOK, code)
		assert.NotContains(t, body, "chat", token)
		assert.NotContains(t, body, "onlineStudents", token)
		assert.Contains(t, body, "onlineCount", token)
	}
}

// Covers SPEC-063 CA-01, section 3.1: the presence that goes to the panel carries onlineStudents (the admitted that are online, once each,
// in order); the presentation window and the students get the presence as it was, with no such key. A student who leaves, or who is sent
// back to the waiting room, is out of the list; one who is admitted is in.
func TestPresence_OnlineStudentsOnlyForThePanel(t *testing.T) {
	w := setup(t)
	waiting := w.newPerson("waiting")
	w.svc.states = map[uuid.UUID]string{waiting.UserID: domain.AdmissionWaiting}
	panel, presenter := w.dialView(t, "teacher", "panel"), w.dialView(t, "teacher2", "presenter")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, presenter, "live:snapshot")
	ana, bruno := w.student.UserID.String(), w.stranger.UserID.String()
	both := []string{ana, bruno}
	sort.Strings(both)
	list := func(ids ...string) string { b, _ := json.Marshal(ids); return string(b) }

	a := w.dial(t, "student")
	assert.JSONEq(t, `{"online":1,"presenterConnected":true,"onlineStudents":`+list(ana)+`}`, string(readUntil(t, panel, "live:presence").Data))
	assert.JSONEq(t, `{"online":1,"presenterConnected":true}`, string(readUntil(t, presenter, "live:presence").Data), "the presentation window gets none")
	readUntil(t, a, "live:snapshot")
	assert.JSONEq(t, `{"online":1,"presenterConnected":true}`, string(readUntil(t, a, "live:presence").Data), "nor does a student")

	b := w.dial(t, "stranger")
	assert.JSONEq(t, `{"online":2,"presenterConnected":true,"onlineStudents":`+list(both...)+`}`, string(readUntil(t, panel, "live:presence").Data), "in order")
	assert.JSONEq(t, `{"online":2,"presenterConnected":true}`, string(readUntil(t, presenter, "live:presence").Data))
	readUntil(t, b, "live:snapshot")

	// a second tab of Ana is one more connection and the same student
	aTab := w.dial(t, "second")
	assert.JSONEq(t, `{"online":3,"presenterConnected":true,"onlineStudents":`+list(both...)+`}`, string(readUntil(t, panel, "live:presence").Data), "no repeat")
	_ = aTab.Close()
	assert.JSONEq(t, `{"online":2,"presenterConnected":true,"onlineStudents":`+list(both...)+`}`, string(readUntil(t, panel, "live:presence").Data), "she has the other tab")

	// who waits is not online; admitted, he is; sent back, he is not
	d := w.dial(t, "waiting")
	readUntil(t, d, "live:admission:state")
	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+waiting.UserID.String()+`"}`)
	withD := []string{ana, bruno, waiting.UserID.String()}
	sort.Strings(withD)
	assert.JSONEq(t, `{"online":3,"presenterConnected":true,"onlineStudents":`+list(withD...)+`}`, string(readUntil(t, panel, "live:presence").Data), "admitted")
	sendMsg(t, panel, "live:admission:remove", `{"studentId":"`+waiting.UserID.String()+`"}`)
	assert.JSONEq(t, `{"online":2,"presenterConnected":true,"onlineStudents":`+list(both...)+`}`, string(readUntil(t, panel, "live:presence").Data), "removed")

	_ = a.Close()
	assert.JSONEq(t, `{"online":1,"presenterConnected":true,"onlineStudents":`+list(bruno)+`}`, string(readUntil(t, panel, "live:presence").Data), "Ana left")
	_ = b.Close()
	assert.JSONEq(t, `{"online":0,"presenterConnected":true,"onlineStudents":[]}`, string(readUntil(t, panel, "live:presence").Data), "an empty list, not null")
}
