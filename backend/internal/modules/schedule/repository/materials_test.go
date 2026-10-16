package repository_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// ---- SPEC-074: the materials of a lesson ----

func (e env) link(t *testing.T, session uuid.UUID, title string, position int, visibility domain.MaterialVisibility) domain.ClassSessionMaterial {
	t.Helper()
	m, err := domain.NewLinkMaterial(session, e.teacher.ID, domain.MaterialInput{Title: title, Kind: domain.MaterialReference, Visibility: visibility}, "https://example.com/"+title)
	require.NoError(t, err)
	m.Position = position
	require.NoError(t, e.repo.CreateMaterial(e.ctx, &m))
	return m
}

func (e env) file(t *testing.T, session uuid.UUID, title string, position int) domain.ClassSessionMaterial {
	t.Helper()
	m, err := domain.NewFileMaterial(session, e.teacher.ID, domain.MaterialInput{Title: title, Kind: domain.MaterialExercises, Visibility: domain.VisibilityAfterClass},
		domain.MaterialFile{ObjectKey: "classes/c/sessions/s/materials/" + uuid.NewString() + ".pdf", ContentType: "application/pdf", FileName: title + ".pdf", Size: 2048, PageCount: 12})
	require.NoError(t, err)
	m.Position = position
	require.NoError(t, e.repo.CreateMaterial(e.ctx, &m))
	return m
}

func (e env) titlesOf(t *testing.T, session uuid.UUID) []string {
	t.Helper()
	got, err := e.repo.ListMaterials(e.ctx, []uuid.UUID{session})
	require.NoError(t, err)
	out := []string{}
	for _, m := range got[session] {
		out = append(out, m.Title)
	}
	return out
}

// Covers SPEC-074 CA-01, CA-02 and section 4: a link and a file are saved with all their fields, and come back the same.
func TestMaterials_SaveAndRead(t *testing.T) {
	e := newEnv(t)
	session := twoSessions(t, e)[0]
	release := time.Date(2026, 10, 19, 11, 0, 0, 0, domain.Location())

	link := e.link(t, session.ID, "doc", 0, domain.VisibilityAlways)
	file := e.file(t, session.ID, "lista", 1)
	file.ReleaseAt = &release
	require.NoError(t, e.repo.SaveMaterials(e.ctx, []domain.ClassSessionMaterial{file}))

	got, err := e.repo.FindMaterial(e.ctx, link.ID)
	require.NoError(t, err)
	assert.Equal(t, "doc", got.Title)
	assert.Equal(t, domain.MaterialReference, got.Kind)
	assert.Equal(t, domain.VisibilityAlways, got.Visibility)
	assert.Equal(t, "https://example.com/doc", *got.URL)
	assert.Nil(t, got.ObjectKey)
	assert.Nil(t, got.ReleaseAt)
	assert.Equal(t, e.teacher.ID, got.CreatedBy)
	assert.Equal(t, session.ID, got.SessionID)

	got, err = e.repo.FindMaterial(e.ctx, file.ID)
	require.NoError(t, err)
	assert.Equal(t, *file.ObjectKey, *got.ObjectKey)
	assert.Nil(t, got.URL)
	assert.Equal(t, "application/pdf", *got.ContentType)
	assert.EqualValues(t, 2048, *got.SizeBytes)
	assert.Equal(t, "lista.pdf", *got.FileName)
	assert.Equal(t, 12, *got.PageCount)
	require.NotNil(t, got.ReleaseAt)
	assert.True(t, release.Equal(*got.ReleaseAt))

	_, err = e.repo.FindMaterial(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound)
}

// Covers SPEC-074 CA-01, CA-02 and section 4: the data base itself refuses a material with both sources, with none, a kind or a phase that does
// not exist, a bad title or a position out of 0 to 49.
func TestMaterials_OneSourceConstraint(t *testing.T) {
	e := newEnv(t)
	session := twoSessions(t, e)[0]
	insert := func(columns, values string) error {
		return e.db.Conn(e.ctx).Exec(`INSERT INTO class_session_materials (id, session_id, position, title, kind, visibility, created_by, created_at, updated_at`+columns+`)
			VALUES (?, ?, 0, 'x', 'SLIDES', 'ALWAYS', ?, NOW(), NOW()`+values+`)`, uuid.New(), session.ID, e.teacher.ID).Error
	}
	require.NoError(t, insert(", url", ", 'https://a.com'"), "a link")
	require.NoError(t, insert(", object_key", ", 'k.pdf'"), "a file")
	assert.Error(t, insert("", ""), "neither")
	assert.Error(t, insert(", url, object_key", ", 'https://a.com', 'k.pdf'"), "both")

	bad := func(column, value string) error {
		q := `INSERT INTO class_session_materials (id, session_id, position, title, kind, visibility, url, created_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 'https://a.com', ?, NOW(), NOW())`
		args := map[string]any{"position": 0, "title": "x", "kind": "SLIDES", "visibility": "ALWAYS"}
		args[column] = value
		if column == "position" {
			args[column] = 50
		}
		return e.db.Conn(e.ctx).Exec(q, uuid.New(), session.ID, args["position"], args["title"], args["kind"], args["visibility"], e.teacher.ID).Error
	}
	assert.Error(t, bad("kind", "ANSWER_KEY"), "a kind that does not exist")
	assert.Error(t, bad("visibility", "PRE_CLASS"), "a phase that does not exist")
	assert.Error(t, bad("title", ""), "an empty title")
	assert.Error(t, bad("position", ""), "position 50")
	assert.NoError(t, bad("title", "ok"))
}

// Covers SPEC-074 CA-03 and RN-01: the materials come in the order of their position, a list of lessons comes in one reading, and saving a
// list changes the positions and the fields of those materials only.
func TestMaterials_PositionReorder(t *testing.T) {
	e := newEnv(t)
	sessions := twoSessions(t, e)
	first, second := sessions[0], sessions[1]
	a := e.link(t, first.ID, "a", 0, domain.VisibilityAlways)
	b := e.link(t, first.ID, "b", 1, domain.VisibilityDuringClass)
	c := e.link(t, first.ID, "c", 2, domain.VisibilityAfterClass)
	other := e.link(t, second.ID, "other", 0, domain.VisibilityAlways)
	assert.Equal(t, []string{"a", "b", "c"}, e.titlesOf(t, first.ID))

	c.Position, a.Position, b.Position = 0, 1, 2
	c.Title, c.Visibility = "c2", domain.VisibilityDuringAndAfter
	release := time.Date(2026, 10, 19, 9, 0, 0, 0, domain.Location())
	c.ReleaseAt = &release
	require.NoError(t, e.repo.SaveMaterials(e.ctx, []domain.ClassSessionMaterial{c, a, b}))
	assert.Equal(t, []string{"c2", "a", "b"}, e.titlesOf(t, first.ID))
	got, err := e.repo.FindMaterial(e.ctx, c.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.VisibilityDuringAndAfter, got.Visibility)
	require.NotNil(t, got.ReleaseAt)
	assert.True(t, release.Equal(*got.ReleaseAt))
	assert.Equal(t, "https://example.com/c", *got.URL, "the source is the same")

	c.ReleaseAt = nil
	require.NoError(t, e.repo.SaveMaterials(e.ctx, []domain.ClassSessionMaterial{c}))
	got, err = e.repo.FindMaterial(e.ctx, c.ID)
	require.NoError(t, err)
	assert.Nil(t, got.ReleaseAt, "a release can be cleared")

	both, err := e.repo.ListMaterials(e.ctx, []uuid.UUID{first.ID, second.ID})
	require.NoError(t, err)
	assert.Len(t, both[first.ID], 3)
	require.Len(t, both[second.ID], 1)
	assert.Equal(t, other.ID, both[second.ID][0].ID)
	none, err := e.repo.ListMaterials(e.ctx, nil)
	require.NoError(t, err)
	assert.Empty(t, none)
}

// Covers SPEC-074 CA-03, CA-06 and RN-06: the exclusion is logical, for a material and for the lesson that goes with them.
func TestMaterials_SoftDeleteWithSession(t *testing.T) {
	e := newEnv(t)
	sessions := twoSessions(t, e)
	first, second := sessions[0], sessions[1]
	a := e.file(t, first.ID, "a", 0)
	e.link(t, first.ID, "b", 1, domain.VisibilityAlways)
	e.link(t, second.ID, "c", 0, domain.VisibilityAlways)

	require.NoError(t, e.repo.DeleteMaterial(e.ctx, a.ID))
	assert.Equal(t, []string{"b"}, e.titlesOf(t, first.ID))
	_, err := e.repo.FindMaterial(e.ctx, a.ID)
	assert.ErrorIs(t, err, domain.ErrMaterialNotFound)
	var deleted bool
	require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT deleted_at IS NOT NULL FROM class_session_materials WHERE id = ?`, a.ID).Scan(&deleted).Error)
	assert.True(t, deleted, "the row stays, deleted")

	require.NoError(t, e.repo.DeleteSession(e.ctx, first.ID))
	assert.Empty(t, e.titlesOf(t, first.ID), "the lesson took its materials")
	assert.Equal(t, []string{"c"}, e.titlesOf(t, second.ID), "the other lesson is untouched")
	var live int
	require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT COUNT(*) FROM class_session_materials WHERE session_id = ? AND deleted_at IS NULL`, first.ID).Scan(&live).Error)
	assert.Zero(t, live)
}

// Covers SPEC-074 CA-09 and RN-07: the flag of content of a lesson is set alone, without touching its other fields.
func TestMaterials_SetHasContent(t *testing.T) {
	e := newEnv(t)
	session := twoSessions(t, e)[0]
	topic := "Permissões"
	session.Topic = &topic
	require.NoError(t, e.repo.SaveSession(e.ctx, &session))

	require.NoError(t, e.repo.SetHasContent(e.ctx, session.ID, true))
	got, err := e.repo.FindSession(e.ctx, session.ID)
	require.NoError(t, err)
	assert.True(t, got.HasContent)
	require.NotNil(t, got.Topic)
	assert.Equal(t, "Permissões", *got.Topic, "the rest of the lesson is as it was")

	require.NoError(t, e.repo.SetHasContent(e.ctx, session.ID, false))
	got, err = e.repo.FindSession(e.ctx, session.ID)
	require.NoError(t, err)
	assert.False(t, got.HasContent)
}
