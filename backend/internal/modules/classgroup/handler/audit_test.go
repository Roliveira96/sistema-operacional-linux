package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeNamer struct{ names map[uuid.UUID]string }

func (f fakeNamer) UserNames(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	for _, id := range ids {
		if n, ok := f.names[id]; ok {
			out[id] = n
		}
	}
	return out, nil
}

func decode(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	out := map[string]any{}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
	return out
}

func auditServer(t *testing.T, namer handler.UserNamer) (*httptest.Server, *fakeService, uuid.UUID) {
	t.Helper()
	teacher := uuid.New()
	svc := newFakeService()
	h := handler.New(svc, &fakeValidator{principal: authn.Principal{UserID: teacher, Role: authn.RoleTeacher}})
	if namer != nil {
		h = h.WithUserNames(namer)
	}
	srv := httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h))
	t.Cleanup(srv.Close)
	return srv, svc, teacher
}

func auditClass(teacher, creator, updater, archiver uuid.UUID, archived bool) domain.ClassGroup {
	created := time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC)
	c := domain.ClassGroup{
		Model:     database.Model{ID: uuid.New(), CreatedAt: created, UpdatedAt: created.Add(24 * time.Hour)},
		TeacherID: teacher, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: created, EndDate: created.Add(90 * 24 * time.Hour), Status: domain.ClassStatusActive,
		CreatedBy: creator, UpdatedBy: updater,
	}
	if archived {
		at := created.Add(48 * time.Hour)
		c.Status = domain.ClassStatusArchived
		c.ArchivedAt = &at
		c.ArchivedBy = &archiver
	}
	return c
}

// Covers SPEC-049 CA-05 and RN-04: the detail brings the ids and the names.
func TestGetClassBringsWhoAndWhen(t *testing.T) {
	ana, bruno, carla := uuid.New(), uuid.New(), uuid.New()
	srv, svc, teacher := auditServer(t, fakeNamer{names: map[uuid.UUID]string{ana: "Ana", bruno: "Bruno", carla: "Carla"}})
	class := auditClass(teacher, ana, bruno, carla, true)
	svc.classes[class.ID] = class

	body := decode(t, doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+class.ID.String(), nil, true))
	assert.Equal(t, ana.String(), body["createdBy"])
	assert.Equal(t, bruno.String(), body["updatedBy"])
	assert.Equal(t, carla.String(), body["archivedBy"])
	assert.Equal(t, "Ana", body["createdByName"])
	assert.Equal(t, "Bruno", body["updatedByName"])
	assert.Equal(t, "Carla", body["archivedByName"])
	assert.Equal(t, "2026-10-03T10:00:00Z", body["archivedAt"])
	assert.Equal(t, "2026-10-01T10:00:00Z", body["createdAt"])
	assert.Equal(t, "2026-10-02T10:00:00Z", body["updatedAt"])
}

// Covers SPEC-049 CA-04: a class that is not archived has no archive fields.
func TestGetClassNotArchivedHasNoArchiveFields(t *testing.T) {
	ana := uuid.New()
	srv, svc, teacher := auditServer(t, fakeNamer{names: map[uuid.UUID]string{ana: "Ana"}})
	class := auditClass(teacher, ana, ana, uuid.Nil, false)
	svc.classes[class.ID] = class

	body := decode(t, doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+class.ID.String(), nil, true))
	assert.Equal(t, "Ana", body["createdByName"])
	for _, key := range []string{"archivedAt", "archivedBy", "archivedByName"} {
		assert.NotContains(t, body, key)
	}
}

// Covers SPEC-049 RN-04: without a user that can be read, the name is left out.
func TestGetClassOmitsUnknownNames(t *testing.T) {
	ghost := uuid.New()
	srv, svc, teacher := auditServer(t, fakeNamer{names: map[uuid.UUID]string{}})
	class := auditClass(teacher, ghost, ghost, uuid.Nil, false)
	svc.classes[class.ID] = class
	body := decode(t, doRequest(t, srv, http.MethodGet, "/api/v1/classes/"+class.ID.String(), nil, true))
	assert.Equal(t, ghost.String(), body["createdBy"])
	assert.NotContains(t, body, "createdByName")

	srv2, svc2, teacher2 := auditServer(t, nil)
	class2 := auditClass(teacher2, ghost, ghost, uuid.Nil, false)
	svc2.classes[class2.ID] = class2
	body = decode(t, doRequest(t, srv2, http.MethodGet, "/api/v1/classes/"+class2.ID.String(), nil, true))
	assert.NotContains(t, body, "createdByName", "without a namer there are no names")
}

// Covers SPEC-049 CA-05: the list brings the ids and not the names.
func TestListBringsIdsOnly(t *testing.T) {
	ana := uuid.New()
	srv, svc, teacher := auditServer(t, fakeNamer{names: map[uuid.UUID]string{ana: "Ana"}})
	class := auditClass(teacher, ana, ana, uuid.Nil, false)
	svc.classes[class.ID] = class

	body := decode(t, doRequest(t, srv, http.MethodGet, "/api/v1/classes", nil, true))
	items := body["items"].([]any)
	require.Len(t, items, 1)
	item := items[0].(map[string]any)
	assert.Equal(t, ana.String(), item["createdBy"])
	assert.Equal(t, ana.String(), item["updatedBy"])
	assert.NotContains(t, item, "createdByName")
}
