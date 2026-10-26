package repository_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

// migration00044 gives the Up and the Down of migration 00044: the conversion of the summaries and what going down does.
func migration00044(t *testing.T) (up, down string) {
	t.Helper()
	entries, err := migrations.FS.ReadDir(".")
	require.NoError(t, err)
	var text string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "00044_") {
			raw, err := migrations.FS.ReadFile(e.Name())
			require.NoError(t, err)
			text = strings.ReplaceAll(string(raw), "\r\n", "\n")
		}
	}
	require.NotEmpty(t, text, "migration 00044 exists")
	upAt, downAt := strings.Index(text, "-- +goose Up"), strings.Index(text, "-- +goose Down")
	require.True(t, upAt >= 0 && downAt > upAt, "migration 00044 has its Up and its Down")
	return text[upAt+len("-- +goose Up") : downAt], text[downAt+len("-- +goose Down"):]
}

// statements splits a part of a migration into its statements, without the comments.
func statements(part string) []string {
	var out []string
	for _, s := range strings.Split(strings.TrimSpace(part), ";\n") {
		if s = strings.TrimSpace(s); s != "" && !strings.HasPrefix(s, "--") {
			out = append(out, s)
		}
	}
	return out
}

// Covers SPEC-078 CA-10 (RN-02): migration 00044 turns the summaries already stored, which are plain text and were never filtered, into paragraphs
// of escaped text: a line is a paragraph, blank lines go away, and a text with a script becomes text, never an element. It goes up and down.
func TestMigration00044_ConvertsPlainSummaryToEscapedParagraphs(t *testing.T) {
	env := newEnrollEnv(t) // every migration was applied by the helper
	up, down := migration00044(t)
	conn := env.db.Conn(env.ctx)

	cases := []struct{ code, plain, want string }{
		{"A1", "Linha 1\nLinha 2 <b>&</b>\r\n\r\nFim", "<p>Linha 1</p><p>Linha 2 &lt;b&gt;&amp;&lt;/b&gt;</p><p>Fim</p>"},
		{"A2", "<script>alert(1)</script>", "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"},
		{"A3", "  recuo  ", "<p>recuo</p>"},
		{"A4", "", ""},
		{"A5", "  \n\n \t ", ""},
	}
	for _, c := range cases {
		require.NoError(t, conn.Exec(`INSERT INTO classes (id, teacher_id, name, course_code, semester, summary, start_date, end_date, status, created_at, updated_at, created_by, updated_by)
			VALUES (?, ?, 'SO', ?, '2026/2', ?, NOW(), NOW(), 'ACTIVE', NOW(), NOW(), ?, ?)`, uuid.New(), env.teacher.ID, c.code, c.plain, env.teacher.ID, env.teacher.ID).Error)
	}

	for _, statement := range statements(up) {
		require.NoError(t, conn.Exec(statement).Error, statement)
	}
	for _, c := range cases {
		var got string
		require.NoError(t, conn.Raw(`SELECT summary FROM classes WHERE course_code = ?`, c.code).Scan(&got).Error)
		assert.Equal(t, c.want, got, c.code)
	}

	// going down keeps the escaped text, and the rest of the schema stays
	for _, statement := range statements(down) {
		require.NoError(t, conn.Exec(statement).Error, statement)
	}
	var count int64
	require.NoError(t, conn.Table("classes").Count(&count).Error)
	assert.Equal(t, int64(len(cases)), count)
}
