package service_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// dirty is what a teacher may paste into the editor of the instructions: formatting that has to stay, and what the filter has to take out.
const dirty = `<p onclick="steal()">Leia <strong>tudo</strong> antes.</p><script>alert(1)</script>` +
	`<img src="https://example.test/a.png" alt="x"><iframe src="https://www.youtube.com/embed/abc"></iframe>` +
	`<ol><li>Um</li></ol><p>Use <code>ls -l</code> e veja <a href="https://utfpr.edu.br">o site</a>.</p>`

func assertFiltered(t *testing.T, html string) {
	t.Helper()
	for _, gone := range []string{"<script", "alert(1)", "onclick", "<img", "<iframe"} {
		assert.NotContains(t, html, gone)
	}
	for _, kept := range []string{"<strong>tudo</strong>", "<ol>", "<li>Um</li>", "<code>ls -l</code>", `href="https://utfpr.edu.br"`} {
		assert.Contains(t, html, kept)
	}
}

// paragraph is one paragraph of exactly n characters of HTML, tags included.
func paragraph(n int) string { return "<p>" + strings.Repeat("a", n-len("<p></p>")) + "</p>" }

// Covers SPEC-077 CA-01 (RN-01): the instructions are formatted text, filtered like the syllabus of a class (no images, no videos, no script, no
// event attributes), and the teacher and the student read back what was stored (CA-04, RN-02).
func TestDescription_IsFilteredAsRichTextWithoutImages(t *testing.T) {
	f := newFixture(t)
	got := f.create(t, func(in *service.CreateInput) { in.Description = dirty })
	assertFiltered(t, got.Description)

	public, err := f.svc.Public(ctx, f.as(f.ana), f.class.ID, got.ID)
	require.NoError(t, err)
	assert.Equal(t, got.Description, public.Description, "the student reads the same filtered html")
}

// Covers SPEC-077 CA-02 (RN-01): the limit is 20,000 characters of HTML after the filter; one more is refused and nothing is written.
func TestDescription_TooLongAfterTheFilterIsInvalid(t *testing.T) {
	f := newFixture(t)
	got := f.create(t, func(in *service.CreateInput) { in.Description = paragraph(20000) })
	assert.Len(t, got.Description, 20000, "exactly the limit is accepted")

	writes := f.repo.writes
	in := f.input()
	in.Description = paragraph(20001)
	_, err := f.svc.Create(ctx, f.teacher, f.class.ID, in)
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment)

	_, err = f.svc.Update(ctx, f.teacher, f.class.ID, got.ID, service.UpdateInput{Description: ptr(paragraph(20001))})
	assert.ErrorIs(t, err, domain.ErrInvalidAssessment)
	assert.Equal(t, writes, f.repo.writes, "nothing was written")
}

// Covers SPEC-077 CA-03 (RN-01): instructions with no visible text are stored empty.
func TestDescription_WithoutVisibleTextIsStoredEmpty(t *testing.T) {
	f := newFixture(t)
	for _, empty := range []string{"<p></p>", "<p>  </p>", "<p><br></p>", " \n\t "} {
		got := f.create(t, func(in *service.CreateInput) { in.Description = empty })
		assert.Empty(t, got.Description, "%q", empty)
	}
}

// Covers SPEC-077 CA-01 (RN-01, RN-06): an edit is filtered too, before the start and from the start on, when the instructions are still editable.
func TestUpdate_DescriptionIsFilteredAlsoWhenFrozen(t *testing.T) {
	f := newFixture(t)
	a := f.create(t)

	got, err := f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Description: ptr(dirty)})
	require.NoError(t, err)
	assertFiltered(t, got.Description)

	f.now = at(21, 9, 30) // frozen
	got, err = f.svc.Update(ctx, f.teacher, f.class.ID, a.ID, service.UpdateInput{Description: ptr("<p>Nova <script>x()</script>versão</p>")})
	require.NoError(t, err)
	assert.Equal(t, "<p>Nova versão</p>", got.Description)
	assert.ElementsMatch(t, []string{"description"}, f.repo.events[a.ID][len(f.repo.events[a.ID])-1].ChangedFields)
}
