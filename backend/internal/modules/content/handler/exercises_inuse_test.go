package handler

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
)

// Covers SPEC-075 CA-20 (RN-18, section 5.2): a question that holds a scheduled assessment answers 409 with the type question-in-use, when it is
// deleted or when its links or its status change.
func TestExerciseHandler_QuestionInUse(t *testing.T) {
	id := uuid.NewString()
	routes := []struct {
		name, method, path, body string
	}{
		{"delete", http.MethodDelete, exercisesPath("/" + id), ""},
		{"links", http.MethodPut, exercisesPath("/" + id + "/links"), `{"practice":false,"assessment":false,"exclusive":false,"status":"PUBLISHED"}`},
	}
	for _, r := range routes {
		t.Run(r.name, func(t *testing.T) {
			f := newFakeBank()
			f.err = service.ErrQuestionInUse
			code, body := bankCall(t, f, teacher, 100, r.method, r.path, r.body)
			assert.Equal(t, http.StatusConflict, code)
			assert.Contains(t, body["type"], "question-in-use")
		})
	}
}
