package service_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

func create(t *testing.T, description string) (domain.CourseModule, error) {
	t.Helper()
	return service.New(newMockRepository()).CreateModule(context.Background(), service.CreateModuleInput{
		TeacherID: uuid.New(), Title: "M", Description: description, Visibility: domain.VisibilityPublic,
	})
}

// Covers SPEC-010 RN-12 and SPEC-019 CA-16: the description is formatted text, filtered on the server.
func TestService_DescriptionIsFilteredHTML(t *testing.T) {
	m, err := create(t, `<p>Use <code>ls</code> e <strong>cd</strong></p><script>alert(1)</script><b onclick="x()">ok</b>`)
	require.NoError(t, err)
	assert.Contains(t, m.Description, "<code>ls</code>")
	assert.Contains(t, m.Description, "<strong>cd</strong>")
	assert.NotContains(t, m.Description, "script")
	assert.NotContains(t, m.Description, "onclick")
}

func TestService_DescriptionInPlainTextStaysAsItIs(t *testing.T) {
	m, err := create(t, "  ls · cd · mkdir — Navegar pelas pastas  ")
	require.NoError(t, err)
	assert.Equal(t, "ls · cd · mkdir — Navegar pelas pastas", m.Description)
}

// Covers SPEC-019 CA-18: nothing visible left after the filter is an empty description.
func TestService_DescriptionNeedsVisibleText(t *testing.T) {
	for _, empty := range []string{"", "   ", "<p></p>", "<p> </p><br>", "<script>x()</script>", "<p><b> </b></p>"} {
		_, err := create(t, empty)
		assert.ErrorIs(t, err, service.ErrDescriptionRequired, empty)
	}
}

func TestService_DescriptionHasALimit(t *testing.T) {
	_, err := create(t, "<p>"+strings.Repeat("a", service.MaxDescriptionLength)+"</p>")
	assert.ErrorIs(t, err, service.ErrDescriptionTooLong)
	_, err = create(t, strings.Repeat("a", service.MaxDescriptionLength))
	assert.NoError(t, err, "exactly at the limit is fine")
}

func TestService_UpdateFiltersAndChecksTheDescription(t *testing.T) {
	teacher, id := uuid.New(), uuid.New()
	repo := newMockRepository()
	repo.modules[id] = domain.CourseModule{Model: database.Model{ID: id}, TeacherID: teacher, Title: "M", Description: "antiga", Visibility: domain.VisibilityPublic, Status: domain.ModuleStatusActive}
	svc := service.New(repo)
	ctx := context.Background()

	html := `<h3>Ementa</h3><p>Texto <em>novo</em></p><img src="http://x.com/a.png" onerror="x()">`
	m, err := svc.UpdateModule(ctx, service.UpdateModuleInput{ModuleID: id, CallerID: teacher, Description: &html})
	require.NoError(t, err)
	assert.Contains(t, m.Description, "<h3>Ementa</h3>")
	assert.NotContains(t, m.Description, "onerror")

	empty := "<p> </p>"
	_, err = svc.UpdateModule(ctx, service.UpdateModuleInput{ModuleID: id, CallerID: teacher, Description: &empty})
	assert.ErrorIs(t, err, service.ErrDescriptionRequired)

	long := strings.Repeat("a", service.MaxDescriptionLength+1)
	_, err = svc.UpdateModule(ctx, service.UpdateModuleInput{ModuleID: id, CallerID: teacher, Description: &long})
	assert.ErrorIs(t, err, service.ErrDescriptionTooLong)
}
