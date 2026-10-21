package service_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
)

// dirtySummary is what a teacher may paste into the editor of the summary: formatting that has to stay and what the filter has to take out.
const dirtySummary = `<p onclick="steal()">Disciplina <strong>prática</strong> de <code>Linux</code>.</p><script>alert(1)</script>` +
	`<img src="https://example.test/a.png" alt="x"><ul><li>Terminal</li></ul>`

func assertSummaryFiltered(t *testing.T, html string) {
	t.Helper()
	for _, gone := range []string{"<script", "alert(1)", "onclick", "<img"} {
		assert.NotContains(t, html, gone)
	}
	for _, kept := range []string{"<strong>prática</strong>", "<code>Linux</code>", "<li>Terminal</li>"} {
		assert.Contains(t, html, kept)
	}
}

// Covers SPEC-078 CA-08 (RN-01): the summary is filtered like the syllabus, on create and on update: no scripts, event attributes or images.
func TestCreateClass_SummaryIsFilteredAsRichText(t *testing.T) {
	svc := service.New(newFakeRepo())
	in := validCreateInput()
	in.Summary = dirtySummary
	class, err := svc.CreateClass(context.Background(), uuid.New(), in)
	require.NoError(t, err)
	assertSummaryFiltered(t, class.Summary)

	teacher := uuid.New()
	other, err := svc.CreateClass(context.Background(), teacher, validCreateInput())
	require.NoError(t, err)
	summary := dirtySummary
	updated, err := svc.UpdateClass(context.Background(), teacher, other.ID, service.UpdateClassInput{Summary: &summary})
	require.NoError(t, err)
	assertSummaryFiltered(t, updated.Summary)
}

// Covers SPEC-078 CA-09 (RN-01): 300 visible characters pass whatever the marks around them, 301 do not; the html has its own limit of 5,000.
func TestCreateClass_SummaryLimitsAreOnTheVisibleTextAndTheHtml(t *testing.T) {
	svc := service.New(newFakeRepo())
	create := func(summary string) error {
		in := validCreateInput()
		in.Summary = summary
		_, err := svc.CreateClass(context.Background(), uuid.New(), in)
		return err
	}

	assert.NoError(t, create("<p><strong>"+strings.Repeat("a", 300)+"</strong></p>"), "300 visible characters")
	assert.ErrorIs(t, create("<p>"+strings.Repeat("a", 301)+"</p>"), domain.ErrSummaryTooLong, "301 visible characters")
	assert.ErrorIs(t, create(strings.Repeat("<strong>a</strong>", 278)), domain.ErrSummaryTooLong, "5,004 characters of html, few of text")

	teacher := uuid.New()
	class, err := svc.CreateClass(context.Background(), teacher, validCreateInput())
	require.NoError(t, err)
	tooLong := "<p>" + strings.Repeat("a", 301) + "</p>"
	_, err = svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{Summary: &tooLong})
	assert.ErrorIs(t, err, domain.ErrSummaryTooLong, "update has the same limits")
}

// Covers SPEC-078 CA-09 (RN-01): a summary with nothing visible is stored empty.
func TestCreateClass_SummaryWithoutVisibleTextIsStoredEmpty(t *testing.T) {
	svc := service.New(newFakeRepo())
	for _, empty := range []string{"<p></p>", "<p>  </p>", "<p><br></p>"} {
		in := validCreateInput()
		in.Summary = empty
		class, err := svc.CreateClass(context.Background(), uuid.New(), in)
		require.NoError(t, err)
		assert.Empty(t, class.Summary, "%q", empty)
	}
}
