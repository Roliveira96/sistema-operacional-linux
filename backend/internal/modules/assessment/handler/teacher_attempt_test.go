package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// fakeTeacherAttempt is what the fake gives for the attempt the teacher reads in the room.
var fakeTeacherAttempt service.TeacherAttempt

func (f *fakeService) AttemptForTeacher(_ context.Context, a service.Actor, classID, id, attemptID uuid.UUID) (service.TeacherAttempt, error) {
	f.saw("AttemptForTeacher", a)
	return fakeTeacherAttempt, f.err
}

// Covers SPEC-095 CA-01, CA-02 (section 5): the route gives the attempt of one student with exactly its keys, the key only in the objective ones and
// never the points; the student and another teacher get 403, an attempt of another assessment 404.
func TestAttemptForTeacherRoute(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	solved := true
	submitted := at(21, 10, 0)
	fakeTeacherAttempt = service.TeacherAttempt{
		ID: uuid.New(), StudentID: uuid.New(), StudentName: "Ana", Status: domain.AttemptSubmitted, StartedAt: at(21, 9, 10), SubmittedAt: &submitted,
		Items: []service.TeacherAttemptItem{
			{AttemptItemView: service.AttemptItemView{Position: 1, Kind: "THEORETICAL_SINGLE", Weight: domain.Points(2), StudentView: json.RawMessage(`{"title":"Permissões"}`),
				Answer: json.RawMessage(`{"choice":"a"}`)}, Title: "Permissões", AnswerKey: json.RawMessage(`{"correct":"b"}`)},
			{AttemptItemView: service.AttemptItemView{Position: 2, Kind: "PRACTICAL", Weight: domain.Points(1), StudentView: json.RawMessage(`{"title":"Criar"}`),
				CheckedSolved: &solved}, Title: "Criar"},
		},
	}
	path := assessmentPath(uuid.New(), uuid.New()) + "/attempts/" + fakeTeacherAttempt.ID.String()
	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.ElementsMatch(t, []string{"attemptId", "studentId", "studentName", "status", "startedAt", "submittedAt", "serverNow", "items"}, keysOf(body))
	assert.Equal(t, "Ana", body["studentName"])
	items := array(t, body["items"])
	require.Len(t, items, 2)
	single := object(t, items[0])
	assert.ElementsMatch(t, []string{"position", "kind", "weight", "title", "studentView", "answer", "answerKey"}, keysOf(single))
	assert.Equal(t, "Permissões", single["title"])
	assert.Equal(t, map[string]any{"correct": "b"}, single["answerKey"])
	practical := object(t, items[1])
	assert.ElementsMatch(t, []string{"position", "kind", "weight", "title", "studentView", "checkedSolved"}, keysOf(practical))
	assert.Equal(t, true, practical["checkedSolved"])

	for err, want := range map[error]int{domain.ErrForbidden: http.StatusForbidden, domain.ErrAttemptNotFound: http.StatusNotFound} {
		svc.err = err
		status, _ = call(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, want, status, err.Error())
	}
}
