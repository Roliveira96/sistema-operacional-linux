package repository_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-077 CA-02, CA-05 (section 4): the database keeps the instructions at 20,000 characters, whatever the service does. The first case is
// the control: exactly the limit is stored, so the refusal is the constraint.
func TestRepository_DescriptionAcceptsUpTo20000AndRefusesMore(t *testing.T) {
	e := newEnv(t)
	limit := e.assessment(func(a *domain.Assessment) { a.Description = strings.Repeat("a", 20000) })
	require.NoError(t, e.repo.Create(e.ctx, &limit, e.items(3), nil, nil, e.created(e.now)), "control: the limit itself is accepted")

	over := e.assessment(func(a *domain.Assessment) { a.Description = strings.Repeat("a", 20001) })
	assert.Error(t, e.repo.Create(e.ctx, &over, e.items(3), nil, nil, e.created(e.now)))
}

// insertPlain stores an assessment the way the SPEC-075 stored it: the instructions as plain text, whatever was typed.
func insertPlain(t *testing.T, e env, title, description string) {
	t.Helper()
	require.NoError(t, e.db.Conn(e.ctx).Exec(`INSERT INTO assessments (id, class_id, module_id, title, description, type, status, max_score, starts_at, ends_at,
		composition, audience, modality, created_by, updated_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'EXAM', 'SCHEDULED', 10, '2026-10-21 12:00+00', '2026-10-21 14:00+00', 'MANUAL', 'ALL_CLASS', 'IN_PERSON', ?, ?, now(), now())`,
		uuid.New(), e.class.ID, e.module.ID, title, description, e.teacher.ID, e.teacher.ID).Error)
}

// Covers SPEC-077 CA-05 (RN-03): migration 00043 turns the instructions already stored, which are plain text and were never filtered, into paragraphs
// of escaped text: a line is a paragraph, blank lines go away, and a text with a script becomes text, never an element.
func TestMigration00043_ConvertsPlainDescriptionToEscapedParagraphs(t *testing.T) {
	e := newEnv(t) // every migration was applied by the helper
	up, down := migrationParts(t, "00043_")
	runMigration(t, e, down) // back to the world where the instructions are plain text

	cases := []struct{ title, plain, want string }{
		{"lines", "Leia tudo.\nUse <b>ls</b> & veja\r\n\r\nFim", "<p>Leia tudo.</p><p>Use &lt;b&gt;ls&lt;/b&gt; &amp; veja</p><p>Fim</p>"},
		{"script", "<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"},
		{"indented", "  recuo  ", "<p>recuo</p>"},
		{"empty", "", ""},
		{"blank lines only", "  \n\n \t ", ""},
	}
	for _, c := range cases {
		insertPlain(t, e, c.title, c.plain)
	}

	runMigration(t, e, up)
	for _, c := range cases {
		var got string
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT description FROM assessments WHERE title = ?`, c.title).Scan(&got).Error)
		assert.Equal(t, c.want, got, c.title)
	}
}

// Covers SPEC-077 CA-05 (section 4): going down gives the limit of 5,000 characters back and leaves the rest of the schema, and going up again brings
// the 20,000 back ready to use; going down with an instruction already beyond 5,000 is refused by the database, so nothing is cut.
func TestMigration00043_UpAndDown(t *testing.T) {
	e := newEnv(t)
	up, down := migrationParts(t, "00043_")
	stored := e.create(t)

	runMigration(t, e, down)
	var count int64
	require.NoError(t, e.db.Conn(e.ctx).Table("assessments").Where("id = ?", stored.ID).Count(&count).Error, "the rest of the schema stays")
	assert.Equal(t, int64(1), count)
	limit5000 := e.assessment(func(a *domain.Assessment) { a.Description = strings.Repeat("a", 5000) })
	assert.NoError(t, e.repo.Create(e.ctx, &limit5000, e.items(3), nil, nil, e.created(e.now)))
	over5000 := e.assessment(func(a *domain.Assessment) { a.Description = strings.Repeat("a", 5001) })
	assert.Error(t, e.repo.Create(e.ctx, &over5000, e.items(3), nil, nil, e.created(e.now)), "the old limit is back")

	runMigration(t, e, up)
	again := e.assessment(func(a *domain.Assessment) { a.Description = strings.Repeat("a", 20000) })
	assert.NoError(t, e.repo.Create(e.ctx, &again, e.items(3), nil, nil, e.created(e.now)), "and the new one is ready to use")

	// an instruction beyond 5,000 stops the Down: the constraint cannot be given back without cutting the text
	refused := false
	for _, statement := range splitStatements(down) {
		if err := e.db.Conn(e.ctx).Exec(statement).Error; err != nil {
			refused = true
			break
		}
	}
	assert.True(t, refused, "the Down refuses to run over instructions beyond 5,000 characters")
}
