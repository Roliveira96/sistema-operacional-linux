package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/ratelimit"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

type fakeImages struct {
	err   error
	got   []byte
	calls int
}

func (f *fakeImages) Upload(_ context.Context, raw []byte) (service.UploadedImage, error) {
	f.calls++
	f.got = raw
	if f.err != nil {
		return service.UploadedImage{}, f.err
	}
	return service.UploadedImage{URL: "http://bucket/conteudo/abc.avif", Width: 1220, Height: 686, Bytes: 4821}, nil
}

func upload(t *testing.T, f *fakeImages, v validator, limit int, field string, content []byte) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := server.NewEngine(zap.NewNop(), nil, NewImages(f, v, ratelimit.New(limit, time.Minute)))
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if field != "" {
		part, err := w.CreateFormFile(field, "foto.png")
		require.NoError(t, err)
		_, err = part.Write(content)
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/teacher/content/images", &body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// Covers SPEC-025 CA-01, CA-07: the file goes to the use case and the teacher gets the address, the size and the weight.
func TestImageHandler_Upload(t *testing.T) {
	f := &fakeImages{}
	code, body := upload(t, f, teacher, 30, "file", []byte("conteudo da imagem"))
	require.Equal(t, http.StatusCreated, code)
	assert.Equal(t, "http://bucket/conteudo/abc.avif", body["url"])
	assert.EqualValues(t, 1220, body["width"])
	assert.EqualValues(t, 686, body["height"])
	assert.EqualValues(t, 4821, body["bytes"])
	assert.Equal(t, []byte("conteudo da imagem"), f.got)
}

// An admin may send too.
func TestImageHandler_AdminMaySend(t *testing.T) {
	admin := validator{p: authn.Principal{UserID: uuid.New(), Role: "ADMIN"}}
	code, _ := upload(t, &fakeImages{}, admin, 30, "file", []byte("x"))
	assert.Equal(t, http.StatusCreated, code)
}

// Covers SPEC-025 CA-09: whoever is not a teacher or an admin is refused, and nothing is processed.
func TestImageHandler_RefusesOthers(t *testing.T) {
	student := validator{p: authn.Principal{UserID: uuid.New(), Role: "STUDENT"}}
	f := &fakeImages{}
	code, _ := upload(t, f, student, 30, "file", []byte("x"))
	assert.Equal(t, http.StatusForbidden, code)
	assert.Zero(t, f.calls)
}

// Covers SPEC-025 CA-04: the mistakes of the teacher come back as a reason, and the bucket being down as unavailable.
func TestImageHandler_Problems(t *testing.T) {
	cases := map[string]struct {
		err  error
		code int
	}{
		"not an image": {domain.ErrImageNotImage, http.StatusBadRequest},
		"pixels":       {domain.ErrImageDimension, http.StatusBadRequest},
		"too large":    {domain.ErrImageTooLarge, http.StatusRequestEntityTooLarge},
		"bucket down":  {service.ErrImageStorage, http.StatusServiceUnavailable},
	}
	for name, tc := range cases {
		code, _ := upload(t, &fakeImages{err: tc.err}, teacher, 30, "file", []byte("x"))
		assert.Equal(t, tc.code, code, name)
	}
}

func TestImageHandler_UnexpectedErrorIsAServerError(t *testing.T) {
	code, _ := upload(t, &fakeImages{err: context.DeadlineExceeded}, teacher, 30, "file", []byte("x"))
	assert.Equal(t, http.StatusInternalServerError, code)
}

// No file in the form is a validation error, not a crash.
func TestImageHandler_RequiresTheFile(t *testing.T) {
	f := &fakeImages{}
	code, body := upload(t, f, teacher, 30, "outro", []byte("x"))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.NotNil(t, body["invalidParams"])
	assert.Zero(t, f.calls)
}

// Covers SPEC-025 RN-01: more than the allowed uploads in a minute is refused.
func TestImageHandler_LimitsTheRate(t *testing.T) {
	f := &fakeImages{}
	assert.Equal(t, http.StatusCreated, func() int { c, _ := upload(t, f, teacher, 1, "file", []byte("x")); return c }())
	// A new engine has a new limiter, so the same one is reused for the second call.
	gin.SetMode(gin.TestMode)
	lim := ratelimit.New(1, time.Minute)
	e := server.NewEngine(zap.NewNop(), nil, NewImages(f, teacher, lim))
	send := func() int {
		var body bytes.Buffer
		w := multipart.NewWriter(&body)
		part, _ := w.CreateFormFile("file", "a.png")
		_, _ = part.Write([]byte("x"))
		_ = w.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/teacher/content/images", &body)
		req.Header.Set("Content-Type", w.FormDataContentType())
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "t"})
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		return rec.Code
	}
	assert.Equal(t, http.StatusCreated, send())
	assert.Equal(t, http.StatusTooManyRequests, send())
}

// Covers SPEC-025 CA-04: a body above the limit is refused before it is read in full.
func TestImageHandler_RefusesABodyAboveTheLimit(t *testing.T) {
	f := &fakeImages{}
	code, _ := upload(t, f, teacher, 30, "file", make([]byte, domain.MaxImageBytes+multipartSlack+1024))
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)
	assert.Zero(t, f.calls)
}
