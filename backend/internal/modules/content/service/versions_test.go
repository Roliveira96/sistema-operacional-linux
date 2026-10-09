package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

type fakeVersionStore struct {
	owner    uuid.UUID
	missing  bool
	versions []VersionSummary
	changed  bool
	pubErr   error
	note     string
	by       uuid.UUID
	restored int
	restErr  error
}

func (f *fakeVersionStore) ModuleTeacher(context.Context, uuid.UUID) (uuid.UUID, error) {
	if f.missing {
		return uuid.Nil, ErrNotFound
	}
	return f.owner, nil
}

func (f *fakeVersionStore) ListVersions(context.Context, uuid.UUID) ([]VersionSummary, bool, error) {
	return f.versions, f.changed, nil
}

func (f *fakeVersionStore) PublishVersion(_ context.Context, _, by uuid.UUID, note string) (domain.ModuleVersion, error) {
	f.by, f.note = by, note
	return domain.ModuleVersion{Number: 2, Note: note}, f.pubErr
}

func (f *fakeVersionStore) RestoreVersion(_ context.Context, _ uuid.UUID, number int, _ time.Time) error {
	f.restored = number
	return f.restErr
}

func (f *fakeVersionStore) ListBlocks(context.Context, uuid.UUID) ([]domain.ContentBlock, error) {
	return []domain.ContentBlock{{Position: 1}}, nil
}

func (f *fakeVersionStore) ModuleSetup(context.Context, uuid.UUID) (json.RawMessage, error) {
	return json.RawMessage(`{"steps":[]}`), nil
}

func versionFixture() (*Versions, *fakeVersionStore, Actor, Actor) {
	owner := Actor{UserID: uuid.New(), Role: "TEACHER"}
	store := &fakeVersionStore{owner: owner.UserID}
	return NewVersions(store, zap.NewNop()), store, owner, Actor{UserID: uuid.New(), Role: "ADMIN"}
}

// Covers SPEC-021 CA-06, CA-11: only the owner and admins publish, the note is bounded.
func TestVersions_Publish(t *testing.T) {
	s, store, owner, admin := versionFixture()
	ctx := context.Background()
	m := uuid.New()

	v, err := s.Publish(ctx, owner, m, "  primeira  ")
	require.NoError(t, err)
	assert.Equal(t, 2, v.Number)
	assert.Equal(t, "primeira", store.note)
	assert.Equal(t, owner.UserID, store.by)

	_, err = s.Publish(ctx, admin, m, "")
	require.NoError(t, err)

	_, err = s.Publish(ctx, owner, m, strings.Repeat("a", domain.MaxVersionNote+1))
	assert.ErrorIs(t, err, ErrNoteTooLong)

	store.pubErr = ErrNoChanges
	_, err = s.Publish(ctx, owner, m, "")
	assert.ErrorIs(t, err, ErrNoChanges)
	store.pubErr = nil

	other := Actor{UserID: uuid.New(), Role: "TEACHER"}
	_, err = s.Publish(ctx, other, m, "")
	assert.ErrorIs(t, err, ErrForbidden)
	store.missing = true
	_, err = s.Publish(ctx, owner, m, "")
	assert.ErrorIs(t, err, ErrModuleNotFound)
}

func TestVersions_ListMarksTheCurrentOne(t *testing.T) {
	s, store, owner, _ := versionFixture()
	store.versions = []VersionSummary{{Number: 3}, {Number: 2}, {Number: 1}}
	store.changed = true
	list, changed, err := s.List(context.Background(), owner, uuid.New())
	require.NoError(t, err)
	assert.True(t, changed)
	assert.Equal(t, []bool{true, false, false}, []bool{list[0].Current, list[1].Current, list[2].Current})

	_, _, err = s.List(context.Background(), Actor{UserID: uuid.New(), Role: "TEACHER"}, uuid.New())
	assert.ErrorIs(t, err, ErrForbidden)
}

// Covers SPEC-021 CA-08.
func TestVersions_Restore(t *testing.T) {
	s, store, owner, _ := versionFixture()
	blocks, setup, err := s.Restore(context.Background(), owner, uuid.New(), 4)
	require.NoError(t, err)
	assert.Equal(t, 4, store.restored)
	assert.Len(t, blocks, 1)
	assert.JSONEq(t, `{"steps":[]}`, string(setup))

	store.restErr = ErrNotFound
	_, _, err = s.Restore(context.Background(), owner, uuid.New(), 9)
	assert.ErrorIs(t, err, ErrVersionNotFound)
}

func versionOf(t *testing.T, blocks ...domain.VersionBlock) *domain.ModuleVersion {
	t.Helper()
	raw, err := json.Marshal(domain.VersionContent{Blocks: blocks, Setup: json.RawMessage(`{"steps":[{"command":"mkdir /x"}]}`)})
	require.NoError(t, err)
	return &domain.ModuleVersion{Number: 2, Content: raw}
}

// Covers SPEC-021 RN-06, CA-07: students read the published version, not the draft.
func TestReader_ContentIsTheLatestVersion(t *testing.T) {
	published := uuid.New()
	store := &fakeReadStore{
		version: versionOf(t,
			domain.VersionBlock{ID: published, Type: domain.BlockText, Position: 1, Payload: json.RawMessage(`{"html":"publicado"}`), Active: true},
			domain.VersionBlock{ID: uuid.New(), Type: domain.BlockText, Position: 2, Payload: json.RawMessage(`{"html":"inativo"}`), Active: false}),
		// The draft has other blocks and no snapshot: it must not reach the student.
		blocks: []domain.ContentBlock{{ID: uuid.New(), Position: 1, BlockType: domain.BlockTip}},
	}
	got, err := NewReader(&fakeAccess{}, store).Content(context.Background(), uuid.New(), Viewer{})
	require.NoError(t, err)
	require.Len(t, got.Blocks, 1)
	assert.Equal(t, published, got.Blocks[0].ID)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /x"}]}`, string(got.Setup))
}

// Covers SPEC-021 RN-06: only an admin or the owner reads the draft.
func TestReader_DraftIsForTheOwnerAndAdmins(t *testing.T) {
	owner := uuid.New()
	store := &fakeReadStore{version: versionOf(t)}
	r := NewReader(&fakeAccess{owner: owner}, store)

	_, err := r.Draft(context.Background(), uuid.New(), Viewer{UserID: &owner, Role: "TEACHER"})
	assert.NoError(t, err)
	_, err = r.Draft(context.Background(), uuid.New(), Viewer{UserID: ptr(uuid.New()), Role: "ADMIN"})
	assert.NoError(t, err)
	_, err = r.Draft(context.Background(), uuid.New(), Viewer{UserID: ptr(uuid.New()), Role: "TEACHER"})
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = r.Draft(context.Background(), uuid.New(), Viewer{UserID: ptr(uuid.New()), Role: "STUDENT"})
	assert.ErrorIs(t, err, ErrForbidden)
}

// Covers SPEC-021 CA-10 and RN-08.
func TestSeedPublishesTheChangesButNotOfAFrozenModule(t *testing.T) {
	h := newHarness(true)
	_, err := h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)
	assert.Len(t, h.store.published, 2, "the load publishes each module it changed")

	h = newHarness(true)
	h.store.noChanges = true
	_, err = h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err, "no changes is not an error of the load")

	h = newHarness(true)
	_, err = h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)
	edited := time.Now()
	b := h.store.blocks["diretorios/demo"]
	b.EditedByTeacherAt = &edited
	h.store.blocks["diretorios/demo"] = b
	frozen := b.ModuleID
	h.store.published = nil
	_, err = h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)
	assert.Len(t, h.store.published, 1)
	assert.NotContains(t, h.store.published, frozen, "a module the authors touched is left as it is")
}
