package handler_test

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

func contentPath(classID, sessionID uuid.UUID) string {
	return "/api/v1/classes/" + classID.String() + "/sessions/" + sessionID.String() + "/content"
}

// Covers SPEC-053 section 5 and CA-01: the content is saved and read back.
func TestContentRoutes(t *testing.T) {
	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID, moduleID := uuid.New(), uuid.New(), uuid.New()
	path := contentPath(classID, sessionID)
	svc.content = service.SessionContent{
		Topic:       "Permissões",
		Description: "<p>chmod</p>",
		Module:      &service.Module{ID: moduleID, Title: "Módulo de permissões"},
		Links:       []domain.SessionLink{{Position: 0, Name: "Meet", URL: "https://meet.google.com/abc"}, {Position: 1, Name: "Vídeo", URL: "https://example.com/v"}},
	}

	status, body := call(t, srv, http.MethodPut, path, map[string]any{
		"topic": "Permissões", "description": "<p>chmod</p>", "moduleId": moduleID.String(),
		"links": []map[string]any{{"name": "Meet", "url": "https://meet.google.com/abc"}, {"name": "Vídeo", "url": "https://example.com/v"}},
	})
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, sessionID, svc.sessionID)
	assert.Equal(t, "Permissões", svc.savedContent.Topic)
	assert.Equal(t, "<p>chmod</p>", svc.savedContent.Description)
	assert.Equal(t, &moduleID, svc.savedContent.ModuleID)
	assert.Equal(t, []domain.LinkInput{{Name: "Meet", URL: "https://meet.google.com/abc"}, {Name: "Vídeo", URL: "https://example.com/v"}}, svc.savedContent.Links)
	assert.Equal(t, "Permissões", body["topic"])
	assert.Equal(t, "<p>chmod</p>", body["description"])
	assert.Equal(t, moduleID.String(), body["module"].(map[string]any)["id"])
	assert.Equal(t, "Módulo de permissões", body["module"].(map[string]any)["title"])
	assert.NotContains(t, body, "deck", "the presentation is not part of the content any more (SPEC-074 CA-15)")
	links := body["links"].([]any)
	require.Len(t, links, 2)
	assert.Equal(t, "Meet", links[0].(map[string]any)["name"])
	assert.EqualValues(t, 1, links[1].(map[string]any)["position"])

	status, body = call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, "Permissões", body["topic"])
	assert.Len(t, body["links"], 2)
}

// Covers SPEC-053 CA-07: a lesson without content reads as empty, with an empty list of links.
func TestContentRouteEmpty(t *testing.T) {
	srv, _, _ := setup(authn.RoleStudent)
	defer srv.Close()
	status, body := call(t, srv, http.MethodGet, contentPath(uuid.New(), uuid.New()), nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "", body["topic"])
	assert.Equal(t, "", body["description"])
	assert.Nil(t, body["module"])
	assert.NotContains(t, body, "deck")
	assert.Equal(t, []any{}, body["links"])
}

// Covers SPEC-053 section 5, CA-03 to CA-05: the problems of the service and of the request.
func TestContentRouteErrors(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := contentPath(uuid.New(), uuid.New())
	body := map[string]any{"topic": "x"}

	svc.err = &domain.FieldError{Field: "links[2].url", Err: domain.ErrInvalidSessionContent}
	status, out := call(t, srv, http.MethodPut, path, body)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-session-content", out["type"])
	assert.Equal(t, "links[2].url", out["field"])

	svc.err = &domain.FieldError{Field: "description", Err: domain.ErrContentTooLong}
	status, out = call(t, srv, http.MethodPut, path, body)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "content-too-long", out["type"])
	assert.Equal(t, "description", out["field"])

	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrSessionNotFound, http.StatusNotFound, "session-not-found"},
		{domain.ErrModuleNotFound, http.StatusNotFound, "module-not-found"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
	}
	for _, tc := range cases {
		svc.err = tc.err
		status, out = call(t, srv, http.MethodPut, path, body)
		assert.Equal(t, tc.status, status, tc.typ)
		assert.Equal(t, tc.typ, out["type"])
		status, _ = call(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, tc.status, status, "the reading maps the same errors")
	}
}

// Covers SPEC-053 section 5: the ids and the body are checked before the service is called.
func TestContentRouteChecksTheRequest(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := contentPath(uuid.New(), uuid.New())

	status, out := call(t, srv, http.MethodPut, "/api/v1/classes/not-a-uuid/sessions/"+uuid.NewString()+"/content", map[string]any{})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
	status, out = call(t, srv, http.MethodGet, "/api/v1/classes/"+uuid.NewString()+"/sessions/not-a-uuid/content", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])

	status, out = call(t, srv, http.MethodPut, path, "{not json")
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "malformed-request", out["type"])

	for _, field := range []string{"moduleId"} {
		status, out = call(t, srv, http.MethodPut, path, map[string]any{field: "not-a-uuid"})
		assert.Equal(t, http.StatusBadRequest, status, field)
		assert.Equal(t, "invalid-session-content", out["type"])
		assert.Equal(t, field, out["field"])
	}

	// A deckId is not a field of the content any more: it is not even read (SPEC-074 CA-15).
	status, _ = call(t, srv, http.MethodPut, path, map[string]any{"deckId": "not-a-uuid"})
	assert.Equal(t, http.StatusOK, status)

	// An empty body clears the content: nothing set, no links.
	status, _ = call(t, srv, http.MethodPut, path, map[string]any{})
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, service.ContentInput{}, svc.savedContent)
}

// Covers SPEC-053 CA-07: the calendar brings the topic and whether a lesson has content, and nothing else of the content.
func TestCalendarBringsTheTopicAndTheFlag(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	classID := uuid.New()
	svc.calendar = service.Calendar{
		Classes: []service.ClassInfo{{ID: classID, Name: "SO", CourseCode: "SO34E", Color: "blue", StartDate: day(2026, 10, 1), EndDate: day(2026, 10, 31)}},
		Sessions: []domain.ClassSession{
			{Model: database.Model{ID: uuid.New()}, ClassID: classID, Date: day(2026, 10, 19), StartTime: clk("08:20"), EndTime: clk("10:00"),
				LessonCount: 2, Mode: domain.ModeInPerson, Status: domain.SessionScheduled, Origin: domain.OriginWeekly,
				Topic: str("Permissões"), Description: str("<p>longo</p>"), HasContent: true},
			{Model: database.Model{ID: uuid.New()}, ClassID: classID, Date: day(2026, 10, 21), StartTime: clk("13:50"), EndTime: clk("15:30"),
				LessonCount: 2, Mode: domain.ModeInPerson, Status: domain.SessionScheduled, Origin: domain.OriginWeekly},
		},
	}
	status, body := call(t, srv, http.MethodGet, "/api/v1/classes/"+classID.String()+"/calendar?from=2026-10-01&to=2026-10-31", nil)
	require.Equal(t, http.StatusOK, status, body)
	sessions := body["sessions"].([]any)
	with, without := sessions[0].(map[string]any), sessions[1].(map[string]any)
	assert.Equal(t, "Permissões", with["topic"])
	assert.Equal(t, true, with["hasContent"])
	assert.NotContains(t, with, "description", "the full content comes from its own reading")
	assert.NotContains(t, without, "topic")
	assert.Equal(t, false, without["hasContent"])
}
