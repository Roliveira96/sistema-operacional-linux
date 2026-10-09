package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// memStore is an in-memory AuthorStore that keeps positions sequential like the repository.
type memStore struct {
	owner  uuid.UUID
	blocks []domain.ContentBlock
	clock  time.Time
}

func (m *memStore) ModuleTeacher(_ context.Context, id uuid.UUID) (uuid.UUID, error) {
	if id == uuid.Nil {
		return uuid.Nil, ErrNotFound
	}
	return m.owner, nil
}

func (m *memStore) FindBlock(_ context.Context, id uuid.UUID) (domain.ContentBlock, error) {
	for _, b := range m.blocks {
		if b.ID == id {
			return b, nil
		}
	}
	return domain.ContentBlock{}, ErrNotFound
}

func (m *memStore) sorted() []domain.ContentBlock {
	out := append([]domain.ContentBlock(nil), m.blocks...)
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out
}

func (m *memStore) ListBlocks(context.Context, uuid.UUID) ([]domain.ContentBlock, error) {
	return m.sorted(), nil
}

func (m *memStore) InsertBlock(_ context.Context, b *domain.ContentBlock, after *uuid.UUID) error {
	pos := len(m.blocks) + 1
	if after != nil {
		for _, x := range m.blocks {
			if x.ID == *after {
				pos = x.Position + 1
			}
		}
		for i := range m.blocks {
			if m.blocks[i].Position >= pos {
				m.blocks[i].Position++
			}
		}
	}
	b.Position = pos
	m.blocks = append(m.blocks, *b)
	return nil
}

func (m *memStore) UpdateBlock(_ context.Context, id uuid.UUID, payload json.RawMessage, expected *time.Time, now time.Time) (domain.ContentBlock, error) {
	for i := range m.blocks {
		if m.blocks[i].ID != id {
			continue
		}
		if expected != nil && !m.blocks[i].UpdatedAt.Equal(*expected) {
			return domain.ContentBlock{}, ErrBlockConflict
		}
		m.blocks[i].Payload, m.blocks[i].UpdatedAt, m.blocks[i].EditedByTeacherAt = payload, now, &now
		return m.blocks[i], nil
	}
	return domain.ContentBlock{}, ErrNotFound
}

func (m *memStore) DeleteBlock(_ context.Context, b domain.ContentBlock) error {
	kept := m.blocks[:0]
	for _, x := range m.blocks {
		if x.ID == b.ID {
			continue
		}
		if x.Position > b.Position {
			x.Position--
		}
		kept = append(kept, x)
	}
	m.blocks = kept
	return nil
}

func (m *memStore) ReorderBlocks(_ context.Context, _ uuid.UUID, ids []uuid.UUID, _ time.Time) error {
	for i, id := range ids {
		for j := range m.blocks {
			if m.blocks[j].ID == id {
				m.blocks[j].Position = i + 1
			}
		}
	}
	return nil
}

type authorFixture struct {
	a      *Author
	store  *memStore
	module uuid.UUID
	teach  Actor
	admin  Actor
}

func newAuthorFixture() authorFixture {
	teacher := uuid.New()
	store := &memStore{owner: teacher}
	author := NewAuthor(store, zap.NewNop())
	// A clock that always moves forward, so two changes never share an instant.
	tick := 0
	author.now = func() time.Time {
		tick++
		return time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC).Add(time.Duration(tick) * time.Second)
	}
	return authorFixture{
		a: author, store: store, module: uuid.New(),
		teach: Actor{UserID: teacher, Role: "TEACHER"}, admin: Actor{UserID: uuid.New(), Role: "ADMIN"},
	}
}

const tipJSON = `{"variant":"DEFAULT","html":"<p>dica</p>"}`

func (f authorFixture) add(t *testing.T, html string) domain.ContentBlock {
	t.Helper()
	b, err := f.a.Create(context.Background(), f.teach, f.module, domain.BlockText, json.RawMessage(`{"html":"<p>`+html+`</p>"}`), nil)
	require.NoError(t, err)
	return b
}

// Covers SPEC-019 CA-02, CA-06, CA-07 (RN-03, RN-04, RN-07).
func TestAuthor_Create(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()

	b, err := f.a.Create(ctx, f.teach, f.module, domain.BlockText,
		json.RawMessage(`{"html":"<p>use <code>ls</code><script>x()</script></p>"}`), nil)
	require.NoError(t, err)
	assert.Equal(t, 1, b.Position)
	assert.NotNil(t, b.EditedByTeacherAt, "RN-07")
	assert.Contains(t, string(b.Payload), "<code>ls</code>")
	assert.NotContains(t, string(b.Payload), "script")

	_, err = f.a.Create(ctx, f.teach, f.module, domain.BlockCommand, json.RawMessage(`{"steps":[]}`), nil)
	var pe *domain.PayloadError
	assert.True(t, errors.As(err, &pe), "CA-06")
}

func TestAuthor_CreateAfterShiftsTheNextOnes(t *testing.T) {
	f := newAuthorFixture()
	first := f.add(t, "um")
	second := f.add(t, "dois")

	mid, err := f.a.Create(context.Background(), f.teach, f.module, domain.BlockTip, json.RawMessage(tipJSON), &first.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, mid.Position)
	list, _ := f.a.List(context.Background(), f.teach, f.module)
	assert.Equal(t, []uuid.UUID{first.ID, mid.ID, second.ID}, []uuid.UUID{list[0].ID, list[1].ID, list[2].ID})

	_, err = f.a.Create(context.Background(), f.teach, f.module, domain.BlockTip, json.RawMessage(tipJSON), ptr(uuid.New()))
	assert.ErrorIs(t, err, ErrBlockNotFound)
}

// Covers SPEC-019 CA-08 (RN-01).
func TestAuthor_Permissions(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	other := Actor{UserID: uuid.New(), Role: "TEACHER"}
	student := Actor{UserID: uuid.New(), Role: "STUDENT"}

	_, err := f.a.List(ctx, other, f.module)
	assert.ErrorIs(t, err, ErrForbidden, "a teacher edits only their own modules")
	_, err = f.a.List(ctx, student, f.module)
	assert.ErrorIs(t, err, ErrForbidden)
	_, err = f.a.List(ctx, f.admin, f.module)
	assert.NoError(t, err, "an administrator edits any module")
	_, err = f.a.List(ctx, f.teach, uuid.Nil)
	assert.ErrorIs(t, err, ErrModuleNotFound)

	b := f.add(t, "x")
	assert.ErrorIs(t, f.a.Delete(ctx, other, b.ID), ErrForbidden)
	assert.ErrorIs(t, f.a.Delete(ctx, f.teach, uuid.New()), ErrBlockNotFound)
}

// Covers SPEC-019 CA-03 and CA-09 (RN-02, RN-08).
func TestAuthor_UpdateAndConflict(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	b := f.add(t, "antes")

	got, err := f.a.Update(ctx, f.teach, b.ID, json.RawMessage(`{"html":"<p>depois</p>"}`), b.UpdatedAt, false)
	require.NoError(t, err)
	assert.Contains(t, string(got.Payload), "depois")
	assert.Equal(t, domain.BlockText, got.BlockType, "RN-02: the type does not change")

	// The editor still holds the old instant.
	_, err = f.a.Update(ctx, f.teach, b.ID, json.RawMessage(`{"html":"<p>outro</p>"}`), b.UpdatedAt, false)
	assert.ErrorIs(t, err, ErrBlockConflict)

	// P-04: writing over it is a conscious choice.
	_, err = f.a.Update(ctx, f.teach, b.ID, json.RawMessage(`{"html":"<p>outro</p>"}`), b.UpdatedAt, true)
	assert.NoError(t, err)

	_, err = f.a.Update(ctx, f.teach, b.ID, json.RawMessage(`{"html":""}`), time.Now(), true)
	var pe *domain.PayloadError
	assert.True(t, errors.As(err, &pe))
}

// Covers SPEC-019 CA-04 and CA-05 (RN-06).
func TestAuthor_DeleteAndReorder(t *testing.T) {
	f := newAuthorFixture()
	ctx := context.Background()
	a, b, c := f.add(t, "a"), f.add(t, "b"), f.add(t, "c")

	require.NoError(t, f.a.Delete(ctx, f.teach, b.ID))
	list, _ := f.a.List(ctx, f.teach, f.module)
	require.Len(t, list, 2)
	assert.Equal(t, []int{1, 2}, []int{list[0].Position, list[1].Position}, "no gap after a removal")

	ordered, err := f.a.Reorder(ctx, f.teach, f.module, []uuid.UUID{c.ID, a.ID})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{c.ID, a.ID}, []uuid.UUID{ordered[0].ID, ordered[1].ID})

	for _, bad := range [][]uuid.UUID{{a.ID}, {a.ID, a.ID}, {a.ID, uuid.New()}, {}} {
		_, err = f.a.Reorder(ctx, f.teach, f.module, bad)
		assert.ErrorIs(t, err, ErrInvalidOrder)
	}
}
