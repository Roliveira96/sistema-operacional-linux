package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

// liveRooms answers the open rooms of a student with what the test put in it (SPEC-067).
type liveRooms struct {
	*fakeService
	rooms []service.StudentRoom
	err   error
	actor service.Actor
}

func (l *liveRooms) ListMyLive(_ context.Context, a service.Actor) ([]service.StudentRoom, error) {
	l.actor = a
	return l.rooms, l.err
}

// ListMyLive keeps the fake service whole for the tests that have no use for the rooms of a student; liveRooms answers for the tests that do.
func (f *fakeService) ListMyLive(context.Context, service.Actor) ([]service.StudentRoom, error) {
	return nil, nil
}

const myLivePath = "/api/v1/me/live"

func setupMyLive(t *testing.T) (*world, *liveRooms) {
	t.Helper()
	svc := &liveRooms{fakeService: &fakeService{}}
	student := authn.Principal{UserID: uuid.New(), Role: authn.RoleStudent}
	val := validator{people: map[string]authn.Principal{
		"student": student,
		"teacher": {UserID: uuid.New(), Role: authn.RoleTeacher},
		"admin":   {UserID: uuid.New(), Role: authn.RoleAdmin},
	}}
	h := handler.New(svc, val, zap.NewNop(), handler.Options{})
	srv := httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h))
	t.Cleanup(srv.Close)
	return &world{srv: srv, student: student, people: val.people}, svc
}

// Covers SPEC-067 CA-01, CA-05, CA-15: the student gets the list with the fields of the contract and no more, in the order of the service.
func TestMyLiveRoute_ListsTheRooms(t *testing.T) {
	w, svc := setupMyLive(t)
	newer := service.StudentRoom{ClassID: uuid.New(), ClassName: "Turma B", SessionID: uuid.New(), Title: "Agora", StartedAt: time.Date(2026, 10, 15, 19, 0, 0, 0, time.UTC)}
	older := service.StudentRoom{ClassID: uuid.New(), ClassName: "Turma A", SessionID: uuid.New(), Title: "Dúvidas", StartedAt: time.Date(2026, 10, 14, 19, 0, 0, 0, time.UTC)}
	svc.rooms = []service.StudentRoom{newer, older}

	code, body := w.call(t, "student", http.MethodGet, myLivePath, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []string{"items"}, keysOf(body), "nothing but the list")
	items := body["items"].([]any)
	require.Len(t, items, 2)
	for i, want := range []service.StudentRoom{newer, older} {
		item := items[i].(map[string]any)
		assert.Equal(t, []string{"classId", "className", "sessionId", "startedAt", "title"}, keysOf(item), "only the fields of the contract: nothing of the state of the room")
		assert.Equal(t, want.ClassID.String(), item["classId"])
		assert.Equal(t, want.ClassName, item["className"])
		assert.Equal(t, want.SessionID.String(), item["sessionId"])
		assert.Equal(t, want.Title, item["title"])
		started, err := time.Parse(time.RFC3339, item["startedAt"].(string))
		require.NoError(t, err)
		assert.True(t, want.StartedAt.Equal(started))
	}
	assert.Equal(t, service.Actor{UserID: w.student.UserID, Role: authn.RoleStudent}, svc.actor, "the rooms of who is signed in")
}

// Covers SPEC-067 CA-02: no room is 200 with an empty list, not null.
func TestMyLiveRoute_NoRoomIsAnEmptyList(t *testing.T) {
	w, _ := setupMyLive(t)
	code, body := w.call(t, "student", http.MethodGet, myLivePath, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, []any{}, body["items"])
}

// Covers SPEC-067 CA-04: no session is 401, the refusal of the service is 403, and a failure is 500, all as problems.
func TestMyLiveRoute_Problems(t *testing.T) {
	w, svc := setupMyLive(t)

	code, body := w.call(t, "", http.MethodGet, myLivePath, nil)
	assert.Equal(t, http.StatusUnauthorized, code)
	assert.Equal(t, "not-authenticated", body["type"])

	svc.err = domain.ErrForbidden
	for _, token := range []string{"teacher", "admin"} {
		code, body = w.call(t, token, http.MethodGet, myLivePath, nil)
		assert.Equal(t, http.StatusForbidden, code, token)
		assert.Equal(t, "forbidden", body["type"], token)
	}
	assert.Equal(t, authn.RoleAdmin, svc.actor.Role, "the role goes to the service, which is who refuses")

	svc.err = errors.New("boom")
	code, body = w.call(t, "student", http.MethodGet, myLivePath, nil)
	assert.Equal(t, http.StatusInternalServerError, code)
	assert.Equal(t, "internal-error", body["type"])
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
