package handler_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---- SPEC-058: the doubt that comes with the raised hand ----

const handQueue = "live:hand:queue"

// queueItems are the hands of a live:hand:queue message.
func queueItems(t *testing.T, m message) []map[string]any {
	t.Helper()
	var q struct {
		Queue []map[string]any `json:"queue"`
	}
	require.NoError(t, json.Unmarshal(m.Data, &q))
	return q.Queue
}

// handsOf are the hands of the handRaises of a snapshot or of the REST state.
func handsOf(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	list, ok := body["handRaises"].([]any)
	require.True(t, ok, "handRaises is a list")
	out := make([]map[string]any, len(list))
	for i, item := range list {
		out[i] = item.(map[string]any)
	}
	return out
}

// requireNoQuestionKey checks that no hand has the question key (it is the panel only that gets it), and that each one still has its id,
// its name and the time it was raised.
func requireNoQuestionKey(t *testing.T, items []map[string]any, why string) {
	t.Helper()
	for _, item := range items {
		assert.NotContains(t, item, "question", why)
		assert.Contains(t, item, "studentId")
		assert.Contains(t, item, "name")
		assert.Contains(t, item, "requestedAt")
	}
}

// Covers SPEC-058 CA-06 (transport): the queue that the panel gets has the question of each hand ("" with none); the queue of the students
// (the one who asked too) and of the presentation window has the hands without the key, and the text is nowhere in what they get.
func TestHandQuestion_OnlyThePanelReadsIt(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	presenter := w.dialView(t, "teacher2", "presenter")
	ana := w.dial(t, "student")
	bruno := w.dial(t, "stranger")
	for _, c := range []*websocket.Conn{panel, presenter, ana, bruno} {
		readUntil(t, c, "live:snapshot")
	}
	question := "Como funciona o fork?\ncom duas linhas"

	sendMsg(t, ana, "live:hand:raise", `{"question":"Como funciona o fork?\ncom duas linhas"}`)
	items := queueItems(t, readUntil(t, panel, handQueue))
	require.Len(t, items, 1)
	assert.Equal(t, question, items[0]["question"])
	assert.Equal(t, w.student.UserID.String(), items[0]["studentId"])
	assert.Equal(t, "Ana", items[0]["name"])
	assert.Contains(t, items[0], "requestedAt")
	for name, c := range map[string]*websocket.Conn{"presentation": presenter, "the one who asked": ana, "another student": bruno} {
		m := readUntil(t, c, handQueue)
		requireNoQuestionKey(t, queueItems(t, m), name)
		assert.Len(t, queueItems(t, m), 1, name)
		assert.NotContains(t, string(m.Data), "fork", "%s never gets the text", name)
	}

	sendMsg(t, bruno, "live:hand:raise", `{}`)
	items = queueItems(t, readUntil(t, panel, handQueue))
	require.Len(t, items, 2)
	assert.Equal(t, question, items[0]["question"])
	require.Contains(t, items[1], "question", "with no question the panel still gets the key, empty")
	assert.Equal(t, "", items[1]["question"])
	for name, c := range map[string]*websocket.Conn{"presentation": presenter, "Ana": ana, "Bruno": bruno} {
		m := readUntil(t, c, handQueue)
		requireNoQuestionKey(t, queueItems(t, m), name)
		assert.Len(t, queueItems(t, m), 2, name)
		assert.NotContains(t, string(m.Data), "fork", name)
	}
}

// Covers SPEC-058 CA-08: the hand is raised with no data at all, with an empty object, with null or an empty question, with no question.
func TestHandQuestion_IsOptional(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, data := range []string{`{}`, `{"question":null}`, `{"question":""}`, `{"question":"   "}`, `null`} {
		sendMsg(t, student, "live:hand:raise", data)
		items := queueItems(t, readUntil(t, panel, handQueue))
		require.Len(t, items, 1, data)
		assert.Equal(t, "", items[0]["question"], data)
	}
	require.NoError(t, student.WriteJSON(map[string]any{"type": "live:hand:raise"}))
	assert.Len(t, queueItems(t, readUntil(t, panel, handQueue)), 1, "not even the data field is needed")
	assert.Empty(t, w.logs.FilterMessage("classroom message rejected").All())
	assert.Empty(t, droppedReasons(w))
}

// Covers SPEC-058 CA-08: raising the hand again, while it is up, only updates the question: the same hand, trimmed, or none at all.
func TestHandQuestion_AgainOnlyUpdatesIt(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, tc := range []struct{ sent, want string }{
		{`{"question":"primeira"}`, "primeira"},
		{`{"question":"  segunda  "}`, "segunda"},
		{`{}`, ""},
		{`{"question":"terceira"}`, "terceira"},
		{`{"question":""}`, ""},
	} {
		sendMsg(t, student, "live:hand:raise", tc.sent)
		items := queueItems(t, readUntil(t, panel, handQueue))
		require.Len(t, items, 1, "the same hand, not a second one: %s", tc.sent)
		assert.Equal(t, tc.want, items[0]["question"], tc.sent)
	}
}

// Covers SPEC-058 CA-08: a question that is too long, has a control character, has more than 3 line breaks in a row, or is not text is
// rejected, with an audit entry, and the hand does not change: the panel is told nothing and the student still has his question.
func TestHandQuestion_RefusedWithoutChangingTheHand(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")
	sendMsg(t, student, "live:hand:raise", `{"question":"a dúvida certa"}`)
	readUntil(t, panel, handQueue)

	bad := []string{
		`{"question":"` + strings.Repeat("a", 301) + `"}`, `{"question":"` + strings.Repeat("😀", 301) + `"}`,
		`{"question":"a\tb"}`, `{"question":"a\u0000b"}`, `{"question":"a\r\nb"}`, `{"question":"a\u001bb"}`, `{"question":"a\n\n\n\nb"}`,
		`{"question":123}`, `{"question":true}`, `{"question":["x"]}`, `{"question":{"a":1}}`, `"just a string"`, `[1]`, `42`,
	}
	for _, b := range bad {
		sendMsg(t, student, "live:hand:raise", b)
	}
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == len(bad) })
	assert.Empty(t, droppedReasons(w), "a bad question is rejected, not dropped")

	// the first thing the panel gets after them is the next good one: nothing was told about the bad ones
	sendMsg(t, student, "live:hand:raise", `{"question":"nova"}`)
	items := queueItems(t, readUntil(t, panel, handQueue))
	require.Len(t, items, 1)
	assert.Equal(t, "nova", items[0]["question"])
	sendMsg(t, student, "live:hand:raise", `{"question":"`+strings.Repeat("b", 301)+`"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == len(bad)+1 })
	snap := snapshotOf(t, w.dialView(t, "second", ""))
	assert.JSONEq(t, `{"raised":true,"question":"nova"}`, mustJSON(snap["myHand"]), "the refused one changed nothing")
}

// Covers SPEC-058 CA-08: the limit of 300 counts characters: 300 emoji (1,200 bytes) and 300 accented letters go through, 301 do not; and
// the frame has its own limit of 4 KiB, over which it is rejected as too large.
func TestHandQuestion_TheLimitIsPerCharacter(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")

	for _, text := range []string{strings.Repeat("😀", 300), strings.Repeat("ã", 300), strings.Repeat("a", 300)} {
		sendMsg(t, student, "live:hand:raise", `{"question":"`+text+`"}`)
		items := queueItems(t, readUntil(t, panel, handQueue))
		require.Len(t, items, 1)
		assert.Equal(t, text, items[0]["question"])
	}
	sendMsg(t, student, "live:hand:raise", `{"question":"`+strings.Repeat("😀", 301)+`"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 1 })
	assert.NotEqual(t, "too-large", w.logs.FilterMessage("classroom message rejected").All()[0].ContextMap()["reason"], "it is the text that is long, not the frame")

	frame := `{"type":"live:hand:raise","data":{"question":"` + strings.Repeat("a", 4100) + `"}}`
	require.NoError(t, student.WriteMessage(websocket.TextMessage, []byte(frame)))
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message rejected").Len() == 2 })
	assert.Equal(t, "too-large", w.logs.FilterMessage("classroom message rejected").All()[1].ContextMap()["reason"])
}

// Covers SPEC-058 CA-08: only an admitted student raises his hand with a question: a student who still waits is dropped by the hub, and
// the panel hears nothing.
func TestHandQuestion_OnlyAnAdmittedStudent(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	readUntil(t, panel, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, student, "live:hand:raise", `{"question":"posso entrar?"}`)
	eventually(t, func() bool { return w.logs.FilterMessage("classroom message dropped").Len() == 1 })
	assert.Equal(t, []string{"live:hand:raise:not-admitted"}, droppedReasons(w))
	assert.Equal(t, 0, w.svc.called("raise"), "it never reached the service")
	nothingMore(t, panel, handQueue)
}

// Covers SPEC-058 CA-07: who comes in, or comes back, gets the hands in the snapshot: the panel with the question of each, the presentation
// window and the students without; and the student gets his own hand in myHand, with his question, to restore the field. The REST state
// of the room has the questions for the teacher only.
func TestHandQuestion_TheSnapshotsAndTheRestState(t *testing.T) {
	w := setup(t)
	bruno := snapshotOf(t, w.dialView(t, "stranger", ""))
	assert.JSONEq(t, `{"raised":false,"question":""}`, mustJSON(bruno["myHand"]), "nobody raised a hand yet")

	ana := w.dial(t, "student")
	other := w.dial(t, "stranger")
	panel := w.dialView(t, "teacher", "panel")
	for _, c := range []*websocket.Conn{ana, other, panel} {
		readUntil(t, c, "live:snapshot")
	}
	sendMsg(t, ana, "live:hand:raise", `{"question":"Como funciona o fork?"}`)
	readUntil(t, panel, handQueue)
	sendMsg(t, other, "live:hand:raise", `{}`)
	readUntil(t, panel, handQueue)

	panelSnap := snapshotOf(t, w.dialView(t, "teacher2", "panel"))
	hands := handsOf(t, panelSnap)
	require.Len(t, hands, 2)
	assert.Equal(t, "Como funciona o fork?", hands[0]["question"], "the panel reads the questions")
	require.Contains(t, hands[1], "question")
	assert.Equal(t, "", hands[1]["question"])
	assert.NotContains(t, panelSnap, "myHand", "the panel has no hand")

	presenterSnap := snapshotOf(t, w.dialView(t, "teacher", "presenter"))
	requireNoQuestionKey(t, handsOf(t, presenterSnap), "the presentation window gets the hands without the text")
	assert.Len(t, handsOf(t, presenterSnap), 2)
	assert.NotContains(t, presenterSnap, "myHand")

	for _, tc := range []struct{ token, want string }{
		{"second", `{"raised":true,"question":"Como funciona o fork?"}`}, // Ana comes back
		{"stranger", `{"raised":true,"question":""}`},                    // the other student: his hand is up, with no question
	} {
		c := w.dialView(t, tc.token, "")
		m := readUntil(t, c, "live:snapshot")
		var snap map[string]any
		require.NoError(t, json.Unmarshal(m.Data, &snap))
		assert.JSONEq(t, tc.want, mustJSON(snap["myHand"]), tc.token)
		requireNoQuestionKey(t, handsOf(t, snap), "a student gets the other hands without text: "+tc.token)
		raw, _ := json.Marshal(snap["handRaises"])
		assert.NotContains(t, string(raw), "fork", "the text is only in his own myHand")
	}

	code, body := w.call(t, "teacher", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	hands = handsOf(t, body)
	require.Len(t, hands, 2)
	assert.Equal(t, "Como funciona o fork?", hands[0]["question"], "REST, for the teacher")
	assert.Equal(t, "", hands[1]["question"])
	code, body = w.call(t, "student", http.MethodGet, w.path("/active"), nil)
	require.Equal(t, http.StatusOK, code)
	requireNoQuestionKey(t, handsOf(t, body), "REST, for a student")
	assert.Len(t, handsOf(t, body), 2)
	raw, _ := json.Marshal(body)
	assert.NotContains(t, string(raw), "fork", "the text is not in the REST state of a student")
}

// Covers SPEC-058 CA-05 and CA-07: the hand that goes down, by the student or by the teacher, takes its question along: the queue of the
// panel loses it, and the student who comes back has no hand and no question in myHand.
func TestHandQuestion_GoesDownWithTheHand(t *testing.T) {
	w := setup(t)
	panel := w.dialView(t, "teacher", "panel")
	student := w.dial(t, "student")
	readUntil(t, panel, "live:snapshot")
	readUntil(t, student, "live:snapshot")
	id := w.student.UserID.String()

	sendMsg(t, student, "live:hand:raise", `{"question":"primeira"}`)
	assert.Equal(t, "primeira", queueItems(t, readUntil(t, panel, handQueue))[0]["question"])
	sendMsg(t, student, "live:hand:lower", `{}`)
	assert.Empty(t, queueItems(t, readUntil(t, panel, handQueue)), "the student lowered it")
	sendMsg(t, student, "live:hand:raise", `{}`)
	items := queueItems(t, readUntil(t, panel, handQueue))
	require.Len(t, items, 1)
	assert.Equal(t, "", items[0]["question"], "the new hand starts with no question")

	sendMsg(t, student, "live:hand:raise", `{"question":"segunda"}`)
	readUntil(t, panel, handQueue)
	sendMsg(t, panel, "live:hand:moderate", `{"studentId":"`+id+`"}`)
	assert.Empty(t, queueItems(t, readUntil(t, panel, handQueue)), "the teacher answered it")
	assert.JSONEq(t, `{"raised":false,"question":""}`, mustJSON(snapshotOf(t, w.dialView(t, "second", ""))["myHand"]))

	sendMsg(t, student, "live:hand:raise", `{"question":"terceira"}`)
	readUntil(t, panel, handQueue)
	sendMsg(t, panel, "live:hand:moderate", `{"all":true}`)
	assert.Empty(t, queueItems(t, readUntil(t, panel, handQueue)), "the teacher lowered every hand")
	assert.JSONEq(t, `{"raised":false,"question":""}`, mustJSON(snapshotOf(t, w.dialView(t, "second", ""))["myHand"]))
}

// Covers SPEC-058 CA-07: a student who is accepted after the lesson began gets his own hand (down) in myHand with his snapshot.
func TestHandQuestion_TheAcceptedStudentGetsMyHand(t *testing.T) {
	w := setup(t)
	w.waitingRoom()
	panel := w.dialView(t, "teacher", "panel")
	readUntil(t, panel, "live:snapshot")
	student := w.dial(t, "student")
	assert.Equal(t, "WAITING", statusOf(t, readMsg(t, student)))
	readUntil(t, panel, "live:admission:queue")

	sendMsg(t, panel, "live:admission:accept", `{"studentId":"`+w.student.UserID.String()+`"}`)
	assert.Equal(t, "ADMITTED", statusOf(t, nextMsg(t, student)))
	snap := nextMsg(t, student)
	require.Equal(t, "live:snapshot", snap.Type)
	var body map[string]any
	require.NoError(t, json.Unmarshal(snap.Data, &body))
	assert.JSONEq(t, `{"raised":false,"question":""}`, mustJSON(body["myHand"]))
}
