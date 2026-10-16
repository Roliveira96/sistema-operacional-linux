package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// ---- SPEC-074: the materials of a lesson ----

// What the fake service heard of the materials.
type materialCalls struct {
	materials  []service.MaterialView
	one        service.MaterialView
	file       service.FileMaterialInput
	fileBytes  []byte
	link       service.LinkMaterialInput
	change     service.MaterialChange
	materialID uuid.UUID
	download   service.Download
	deleted    bool
	released   bool
}

func (f *fakeService) m() *materialCalls { return &f.mat }

func (f *fakeService) Materials(_ context.Context, a service.Actor, classID, sessionID uuid.UUID) ([]service.MaterialView, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	return f.m().materials, f.err
}

func (f *fakeService) AddFileMaterial(_ context.Context, a service.Actor, classID, sessionID uuid.UUID, in service.FileMaterialInput) (service.MaterialView, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	if in.File != nil {
		f.m().fileBytes, _ = io.ReadAll(in.File)
		in.File = nil
	}
	f.m().file = in
	return f.m().one, f.err
}

func (f *fakeService) AddLinkMaterial(_ context.Context, a service.Actor, classID, sessionID uuid.UUID, in service.LinkMaterialInput) (service.MaterialView, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	f.m().link = in
	return f.m().one, f.err
}

func (f *fakeService) UpdateMaterial(_ context.Context, a service.Actor, classID, sessionID, materialID uuid.UUID, change service.MaterialChange) (service.MaterialView, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	f.m().materialID, f.m().change = materialID, change
	return f.m().one, f.err
}

func (f *fakeService) ReleaseMaterial(_ context.Context, a service.Actor, classID, sessionID, materialID uuid.UUID) (service.MaterialView, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	f.m().materialID, f.m().released = materialID, true
	return f.m().one, f.err
}

func (f *fakeService) DeleteMaterial(_ context.Context, a service.Actor, classID, sessionID, materialID uuid.UUID) error {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	f.m().materialID, f.m().deleted = materialID, true
	return f.err
}

func (f *fakeService) MaterialDownload(_ context.Context, a service.Actor, classID, sessionID, materialID uuid.UUID) (service.Download, error) {
	f.actor, f.classID, f.sessionID = a, classID, sessionID
	f.m().materialID = materialID
	return f.m().download, f.err
}

func materialsPath(classID, sessionID uuid.UUID, tail string) string {
	return "/api/v1/classes/" + classID.String() + "/sessions/" + sessionID.String() + "/materials" + tail
}

func aFile(title string, visibility domain.MaterialVisibility) service.MaterialView {
	key, kind, name, size, pages := "classes/c/sessions/s/materials/u.pdf", "application/pdf", "lista.pdf", int64(2048), 12
	return service.MaterialView{ClassSessionMaterial: domain.ClassSessionMaterial{Model: database.Model{ID: uuid.New()}, Position: 0, Title: title,
		Kind: domain.MaterialExercises, Visibility: visibility, ObjectKey: &key, ContentType: &kind, FileName: &name, SizeBytes: &size, PageCount: &pages}}
}

func aLink(title string) service.MaterialView {
	address := "https://example.com/doc"
	return service.MaterialView{ClassSessionMaterial: domain.ClassSessionMaterial{Model: database.Model{ID: uuid.New()}, Position: 1, Title: title,
		Kind: domain.MaterialReference, Visibility: domain.VisibilityAlways, URL: &address}, VisibleNow: true}
}

// upload sends a multipart form like the browser does.
func upload(t *testing.T, srv *httptest.Server, path string, fields map[string]string, filename string, file []byte) (int, map[string]any) {
	t.Helper()
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	for k, v := range fields {
		require.NoError(t, w.WriteField(k, v))
	}
	if file != nil {
		part, err := w.CreateFormFile("file", filename)
		require.NoError(t, err)
		_, err = part.Write(file)
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	req, err := http.NewRequest(http.MethodPost, srv.URL+path, body)
	require.NoError(t, err)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "session"})
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	_ = json.Unmarshal(data, &out)
	return res.StatusCode, out
}

// Covers SPEC-074 CA-04, CA-06 and section 5: the list gives each material with its source; the teacher gets whether it is visible and, if not,
// until when; the student gets none of that, because what he gets is visible.
func TestMaterialRoutes_List(t *testing.T) {
	classID, sessionID := uuid.New(), uuid.New()
	release := time.Date(2026, 10, 19, 11, 0, 0, 0, domain.Location())

	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	hiddenFile := aFile("Resolução", domain.VisibilityAfterClass)
	hiddenFile.HiddenUntil = &domain.HiddenUntil{Reason: domain.HiddenUntilClassEnd}
	scheduled := aFile("Lista", domain.VisibilityDuringClass)
	scheduled.ReleaseAt = &release
	scheduled.HiddenUntil = &domain.HiddenUntil{Reason: domain.HiddenUntilRelease, At: &release}
	svc.m().materials = []service.MaterialView{hiddenFile, scheduled, aLink("Referência")}

	status, body := call(t, srv, http.MethodGet, materialsPath(classID, sessionID, ""), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, sessionID, svc.sessionID)
	list := body["materials"].([]any)
	require.Len(t, list, 3)

	file := list[0].(map[string]any)
	assert.Equal(t, hiddenFile.ID.String(), file["id"])
	assert.Equal(t, "Resolução", file["title"])
	assert.Equal(t, "EXERCISES", file["kind"])
	assert.Equal(t, "AFTER_CLASS", file["visibility"])
	assert.Equal(t, "FILE", file["source"])
	assert.Equal(t, "lista.pdf", file["fileName"])
	assert.Equal(t, "application/pdf", file["contentType"])
	assert.EqualValues(t, 2048, file["sizeBytes"])
	assert.EqualValues(t, 12, file["pageCount"])
	assert.Equal(t, false, file["visibleNow"])
	assert.Equal(t, "CLASS_END", file["hiddenUntil"])
	assert.NotContains(t, file, "objectKey", "the key of the bucket is never sent")
	assert.NotContains(t, file, "url")
	assert.Nil(t, file["releaseAt"])

	assert.Equal(t, "2026-10-19T11:00:00-03:00", list[1].(map[string]any)["releaseAt"])
	assert.Equal(t, "2026-10-19T11:00:00-03:00", list[1].(map[string]any)["hiddenUntil"], "a release: the instant")

	link := list[2].(map[string]any)
	assert.Equal(t, "LINK", link["source"])
	assert.Equal(t, "https://example.com/doc", link["url"])
	assert.Equal(t, true, link["visibleNow"])
	assert.NotContains(t, link, "hiddenUntil")
	assert.NotContains(t, link, "fileName")

	// a student
	srv2, svc2, _ := setup(authn.RoleStudent)
	defer srv2.Close()
	svc2.m().materials = []service.MaterialView{aLink("Referência")}
	status, body = call(t, srv2, http.MethodGet, materialsPath(classID, sessionID, ""), nil)
	require.Equal(t, http.StatusOK, status, body)
	item := body["materials"].([]any)[0].(map[string]any)
	assert.Equal(t, "Referência", item["title"])
	assert.NotContains(t, item, "visibleNow")
	assert.NotContains(t, item, "hiddenUntil")

	svc2.m().materials = nil
	status, body = call(t, srv2, http.MethodGet, materialsPath(classID, sessionID, ""), nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, []any{}, body["materials"], "none is an empty list")
}

// Covers SPEC-074 CA-01 and section 5: the multipart brings the file with the title, the kind, the phase, the release and the pages, and the
// service gets the name to show, the size and the whole file.
func TestMaterialRoutes_SendAFile(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID := uuid.New(), uuid.New()
	svc.m().one = aFile("Lista 1", domain.VisibilityDuringAndAfter)
	pdf := []byte("%PDF-1.7 the file")

	status, body := upload(t, srv, materialsPath(classID, sessionID, "/files"), map[string]string{
		"title": "Lista 1", "kind": "EXERCISES", "visibility": "DURING_AND_AFTER", "releaseAt": "2026-10-19T11:00:00-03:00", "pageCount": "12",
	}, "lista 1.pdf", pdf)
	require.Equal(t, http.StatusCreated, status, body)
	assert.Equal(t, svc.m().one.ID.String(), body["id"])
	assert.Equal(t, "FILE", body["source"])

	in := svc.m().file
	assert.Equal(t, "Lista 1", in.Title)
	assert.Equal(t, domain.MaterialExercises, in.Kind)
	assert.Equal(t, domain.VisibilityDuringAndAfter, in.Visibility)
	require.NotNil(t, in.ReleaseAt)
	assert.True(t, time.Date(2026, 10, 19, 14, 0, 0, 0, time.UTC).Equal(*in.ReleaseAt))
	assert.Equal(t, 12, in.PageCount)
	assert.Equal(t, "lista 1.pdf", in.FileName)
	assert.EqualValues(t, len(pdf), in.Size)
	assert.Equal(t, pdf, svc.m().fileBytes)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, sessionID, svc.sessionID)

	// an image has no page count to send, and the release is optional
	status, _ = upload(t, srv, materialsPath(classID, sessionID, "/files"), map[string]string{"title": "Quadro", "kind": "REFERENCE", "visibility": "ALWAYS"}, "quadro.png", []byte("\x89PNG"))
	require.Equal(t, http.StatusCreated, status)
	assert.Equal(t, 0, svc.m().file.PageCount)
	assert.Nil(t, svc.m().file.ReleaseAt)
}

// Covers SPEC-074 CA-01 and section 5: what is wrong with the request is told before the service is called, with the field.
func TestMaterialRoutes_SendAFileChecksTheRequest(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := materialsPath(uuid.New(), uuid.New(), "/files")
	ok := map[string]string{"title": "x", "kind": "SLIDES", "visibility": "ALWAYS"}

	status, out := upload(t, srv, path, ok, "", nil)
	assert.Equal(t, http.StatusBadRequest, status, "no file")
	assert.Equal(t, "invalid-file", out["type"])
	assert.Equal(t, "file", out["field"])

	status, out = upload(t, srv, path, map[string]string{"title": "x", "kind": "SLIDES", "visibility": "ALWAYS", "pageCount": "abc"}, "a.pdf", []byte("%PDF-"))
	assert.Equal(t, http.StatusBadRequest, status, "a page count that is not a number")
	assert.Equal(t, "invalid-file", out["type"])
	assert.Equal(t, "pageCount", out["field"])

	status, out = upload(t, srv, path, map[string]string{"title": "x", "kind": "SLIDES", "visibility": "ALWAYS", "releaseAt": "tomorrow"}, "a.pdf", []byte("%PDF-"))
	assert.Equal(t, http.StatusBadRequest, status, "a release that is not an instant")
	assert.Equal(t, "invalid-material", out["type"])
	assert.Equal(t, "releaseAt", out["field"])

	status, out = call(t, srv, http.MethodPost, path, "{not multipart")
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "malformed-request", out["type"])

	// a file over the limit of the biggest format is told without reaching the service
	big := bytes.Repeat([]byte("a"), 27<<20)
	status, out = upload(t, srv, path, ok, "grande.pdf", big)
	assert.Equal(t, http.StatusRequestEntityTooLarge, status)
	assert.Equal(t, "file-too-large", out["type"])
	assert.Empty(t, svc.m().file.Title, "the service was not called")
}

// Covers SPEC-074 CA-02 and section 5: a link takes the title, the kind, the phase, the release and the address.
func TestMaterialRoutes_AddALink(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID := uuid.New(), uuid.New()
	svc.m().one = aLink("Doc")

	status, body := call(t, srv, http.MethodPost, materialsPath(classID, sessionID, "/links"), map[string]any{
		"url": "https://example.com/doc", "title": "Doc", "kind": "REFERENCE", "visibility": "DURING_CLASS", "releaseAt": "2026-10-19T09:00:00-03:00",
	})
	require.Equal(t, http.StatusCreated, status, body)
	assert.Equal(t, "LINK", body["source"])
	in := svc.m().link
	assert.Equal(t, "https://example.com/doc", in.URL)
	assert.Equal(t, "Doc", in.Title)
	assert.Equal(t, domain.MaterialReference, in.Kind)
	assert.Equal(t, domain.VisibilityDuringClass, in.Visibility)
	require.NotNil(t, in.ReleaseAt)

	status, out := call(t, srv, http.MethodPost, materialsPath(classID, sessionID, "/links"), "{not json")
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "malformed-request", out["type"])
	status, out = call(t, srv, http.MethodPost, materialsPath(classID, sessionID, "/links"), map[string]any{"url": "https://a.com", "releaseAt": "tomorrow"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "releaseAt", out["field"])
}

// Covers SPEC-074 CA-03 and section 5: the edit takes only what was sent; a null release clears it, an absent one leaves it.
func TestMaterialRoutes_Update(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID, materialID := uuid.New(), uuid.New(), uuid.New()
	path := materialsPath(classID, sessionID, "/"+materialID.String())
	svc.m().one = aLink("Novo")

	status, body := call(t, srv, http.MethodPatch, path, map[string]any{"title": "Novo", "kind": "SLIDES", "visibility": "AFTER_CLASS", "position": 0, "releaseAt": nil})
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, materialID, svc.m().materialID)
	change := svc.m().change
	require.NotNil(t, change.Title)
	assert.Equal(t, "Novo", *change.Title)
	assert.Equal(t, domain.MaterialSlides, *change.Kind)
	assert.Equal(t, domain.VisibilityAfterClass, *change.Visibility)
	assert.Equal(t, 0, *change.Position)
	assert.True(t, change.SetReleaseAt, "a null clears the release")
	assert.Nil(t, change.ReleaseAt)

	status, _ = call(t, srv, http.MethodPatch, path, map[string]any{"title": "Só o título"})
	require.Equal(t, http.StatusOK, status)
	change = svc.m().change
	assert.Equal(t, "Só o título", *change.Title)
	assert.Nil(t, change.Kind)
	assert.Nil(t, change.Position)
	assert.False(t, change.SetReleaseAt, "an absent release stays as it is")

	status, _ = call(t, srv, http.MethodPatch, path, map[string]any{"releaseAt": "2026-10-19T11:00:00-03:00"})
	require.Equal(t, http.StatusOK, status)
	assert.True(t, svc.m().change.SetReleaseAt)
	require.NotNil(t, svc.m().change.ReleaseAt)

	status, out := call(t, srv, http.MethodPatch, path, map[string]any{"releaseAt": "tomorrow"})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-material", out["type"])
	assert.Equal(t, "releaseAt", out["field"])
	status, out = call(t, srv, http.MethodPatch, path, "{not json")
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "malformed-request", out["type"])
	status, out = call(t, srv, http.MethodPatch, materialsPath(classID, sessionID, "/not-a-uuid"), map[string]any{})
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
}

// Covers SPEC-074 CA-03, CA-05, CA-07 and section 5: release now, remove and the address to download.
func TestMaterialRoutes_ReleaseDeleteAndDownload(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID, materialID := uuid.New(), uuid.New(), uuid.New()
	one := "/" + materialID.String()
	released := aFile("Resolução", domain.VisibilityAfterClass)
	released.VisibleNow = true
	svc.m().one = released

	status, body := call(t, srv, http.MethodPost, materialsPath(classID, sessionID, one+"/release"), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.True(t, svc.m().released)
	assert.Equal(t, materialID, svc.m().materialID)
	assert.Equal(t, true, body["visibleNow"])

	status, _ = call(t, srv, http.MethodDelete, materialsPath(classID, sessionID, one), nil)
	assert.Equal(t, http.StatusNoContent, status)
	assert.True(t, svc.m().deleted)

	expires := time.Date(2026, 10, 19, 9, 15, 0, 0, domain.Location())
	svc.m().download = service.Download{URL: "https://files.example/k?ttl=15m", ExpiresAt: expires}
	status, body = call(t, srv, http.MethodGet, materialsPath(classID, sessionID, one+"/download"), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.Equal(t, "https://files.example/k?ttl=15m", body["downloadUrl"])
	assert.Equal(t, "2026-10-19T09:15:00-03:00", body["expiresAt"])
}

// Covers SPEC-074 CA-01, CA-02, CA-05, CA-08 and section 5: each error of the service has its status and its type.
func TestMaterialRoutes_Errors(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, sessionID, materialID := uuid.New(), uuid.New(), uuid.New()
	one := "/" + materialID.String()
	cases := []struct {
		err    error
		status int
		typ    string
		field  string
	}{
		{&domain.FieldError{Field: "title", Err: domain.ErrInvalidMaterial}, http.StatusBadRequest, "invalid-material", "title"},
		{&domain.FieldError{Field: "file", Err: domain.ErrInvalidMaterialFile}, http.StatusBadRequest, "invalid-file", "file"},
		{domain.ErrMaterialFileTooLarge, http.StatusRequestEntityTooLarge, "file-too-large", ""},
		{domain.ErrMaterialLimitExceeded, http.StatusConflict, "material-limit-exceeded", ""},
		{domain.ErrAlreadyVisible, http.StatusConflict, "already-visible", ""},
		{domain.ErrNotAFile, http.StatusBadRequest, "not-a-file", ""},
		{domain.ErrMaterialNotFound, http.StatusNotFound, "material-not-found", ""},
		{domain.ErrSessionNotFound, http.StatusNotFound, "session-not-found", ""},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found", ""},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden", ""},
	}
	routes := []struct {
		method, tail string
		body         any
	}{
		{http.MethodGet, "", nil},
		{http.MethodPost, "/links", map[string]any{"url": "https://a.com"}},
		{http.MethodPatch, one, map[string]any{"title": "x"}},
		{http.MethodPost, one + "/release", nil},
		{http.MethodDelete, one, nil},
		{http.MethodGet, one + "/download", nil},
	}
	for _, tc := range cases {
		svc.err = tc.err
		for _, r := range routes {
			status, out := call(t, srv, r.method, materialsPath(classID, sessionID, r.tail), r.body)
			assert.Equal(t, tc.status, status, "%s %s: %s", r.method, r.tail, tc.typ)
			assert.Equal(t, tc.typ, out["type"], "%s %s", r.method, r.tail)
			if tc.field != "" {
				assert.Equal(t, tc.field, out["field"])
			}
		}
		status, out := upload(t, srv, materialsPath(classID, sessionID, "/files"), map[string]string{"title": "x"}, "a.pdf", []byte("%PDF-"))
		assert.Equal(t, tc.status, status, "upload: %s", tc.typ)
		assert.Equal(t, tc.typ, out["type"])
	}
	svc.err = nil
	status, out := call(t, srv, http.MethodGet, "/api/v1/classes/not-a-uuid/sessions/"+sessionID.String()+"/materials", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
	status, out = call(t, srv, http.MethodGet, materialsPath(classID, sessionID, "/not-a-uuid/download"), nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", out["type"])
}

// Covers SPEC-074 CA-09 and section 5: the timeline counts the materials of each lesson, and the diary brings the list of the reader and the
// count, the student's with no mark of the hidden ones.
func TestTimelineAndDiary_CarryMaterials(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	classID := uuid.New()
	lesson := aLesson(classID, day(2026, 10, 19))
	svc.timeline = service.Timeline{Now: time.Date(2026, 10, 19, 9, 0, 0, 0, domain.Location()),
		Current: &service.TimelineEntry{Session: lesson, MaterialCount: 3}, Past: []service.TimelineEntry{}, Upcoming: []service.TimelineEntry{{Session: aLesson(classID, day(2026, 10, 21))}}}

	status, body := call(t, srv, http.MethodGet, timelinePath(classID), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.EqualValues(t, 3, body["current"].(map[string]any)["materialCount"])
	assert.EqualValues(t, 0, body["upcoming"].([]any)[0].(map[string]any)["materialCount"])

	svc.diary = service.Diary{Entry: service.TimelineEntry{Session: lesson, MaterialCount: 1}, Content: service.SessionContent{Links: []domain.SessionLink{}},
		LiveSessions: []service.LiveSummary{}, Materials: []service.MaterialView{aLink("Roteiro")}}
	status, body = call(t, srv, http.MethodGet, diaryPath(classID, lesson.ID), nil)
	require.Equal(t, http.StatusOK, status, body)
	assert.EqualValues(t, 1, body["session"].(map[string]any)["materialCount"])
	list := body["materials"].([]any)
	require.Len(t, list, 1)
	assert.Equal(t, "Roteiro", list[0].(map[string]any)["title"])
	assert.NotContains(t, list[0], "visibleNow")

	svc.diary.Materials = nil
	_, body = call(t, srv, http.MethodGet, diaryPath(classID, lesson.ID), nil)
	assert.Equal(t, []any{}, body["materials"], "none is an empty list")
}
