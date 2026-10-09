package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

// Covers SPEC-021 RN-12: the routes that carry a snapshot take bodies with large files, and still have a limit.
func TestAuthorHandler_SnapshotBodies(t *testing.T) {
	setupPath := "/teacher/modules/" + uuid.NewString() + "/setup"
	cardsPath := "/teacher/modules/" + uuid.NewString() + "/cards"
	body := func(megabytes int) string {
		return `{"files":[{"path":"/var/log/app.log","content":"` + strings.Repeat("a", megabytes<<20) + `"}]}`
	}
	cardBody := func(megabytes int) string {
		return `{"replaceIds":[],"blocks":[{"type":"TEXT","payload":{"title":"C","html":"","setup":` + body(megabytes) + `}}]}`
	}

	f := &fakeAuthoring{}
	code, _ := authorCall(t, f, teacher, 100, http.MethodPut, setupPath, body(3))
	assert.Equal(t, http.StatusOK, code, "3 MB of file in a snapshot is taken")
	code, resp := authorCall(t, f, teacher, 100, http.MethodPut, setupPath, body(7))
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)
	assert.Contains(t, resp["type"], "file-too-large")

	code, _ = authorCall(t, f, teacher, 100, http.MethodPut, cardsPath, cardBody(3))
	assert.Equal(t, http.StatusOK, code, "the same for a card, whose header carries its snapshot")
	code, _ = authorCall(t, f, teacher, 100, http.MethodPut, cardsPath, cardBody(7))
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)

	// A block is still limited to 1 MB.
	code, _ = authorCall(t, f, teacher, 100, http.MethodPost, "/teacher/modules/"+uuid.NewString()+"/blocks", `{"type":"TEXT","payload":{"html":"`+strings.Repeat("a", 2<<20)+`"}}`)
	assert.Equal(t, http.StatusRequestEntityTooLarge, code)
}
