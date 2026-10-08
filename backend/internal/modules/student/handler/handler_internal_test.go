package handler

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	authdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/student/domain"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
)

func TestToProblem(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantType   string
	}{
		{"policy error", &authdomain.PolicyError{}, http.StatusBadRequest, "weak-password"},
		{"invalid academic id", domain.ErrInvalidAcademicID, http.StatusBadRequest, "validation-error"},
		{"invalid email", domain.ErrInvalidEmail, http.StatusBadRequest, "validation-error"},
		{"email taken", userdomain.ErrEmailTaken, http.StatusConflict, "email-already-registered"},
		{"academic id taken", domain.ErrAcademicIDAlreadyRegistered, http.StatusConflict, "academic-id-already-registered"},
		{"academic id taken userdomain", userdomain.ErrAcademicIDTaken, http.StatusConflict, "academic-id-already-registered"},
		{"class not found", domain.ErrClassNotFound, http.StatusNotFound, "class-group-not-found"},
		{"invite not found", domain.ErrInviteNotFound, http.StatusNotFound, "invite-not-found"},
		{"invite expired", domain.ErrInviteExpired, http.StatusNotFound, "invite-not-found"},
		{"student not found", domain.ErrStudentNotFound, http.StatusNotFound, "student-not-found"},
		{"not a student", domain.ErrNotAStudent, http.StatusForbidden, "forbidden"},
		{"invalid csv", domain.ErrInvalidCSV, http.StatusBadRequest, "csv-invalid"},
		{"csv too large", domain.ErrCSVFileTooLarge, http.StatusRequestEntityTooLarge, "file-too-large"},
		{"unsupported image", domain.ErrUnsupportedImageFormat, http.StatusBadRequest, "unsupported-image"},
		{"image dimensions", domain.ErrImageDimensions, http.StatusBadRequest, "unsupported-image"},
		{"image too large", domain.ErrImageTooLarge, http.StatusRequestEntityTooLarge, "file-too-large"},
		{"generic error", errors.New("unexpected error"), http.StatusInternalServerError, "internal-error"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := toProblem(tc.err)
			assert.Equal(t, tc.wantStatus, p.Status)
			assert.Equal(t, tc.wantType, p.Type)
		})
	}
}
