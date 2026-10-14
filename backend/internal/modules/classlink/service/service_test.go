package service_test

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

type fakeRepo struct {
	classes  map[uuid.UUID]service.ClassInfo
	students map[uuid.UUID]map[uuid.UUID]bool // class -> active students
	links    map[uuid.UUID][]domain.ClassLink
	replaced int
	failList error
}

func newFake() *fakeRepo {
	return &fakeRepo{classes: map[uuid.UUID]service.ClassInfo{}, students: map[uuid.UUID]map[uuid.UUID]bool{}, links: map[uuid.UUID][]domain.ClassLink{}}
}

func (f *fakeRepo) FindClass(_ context.Context, id uuid.UUID) (service.ClassInfo, error) {
	c, ok := f.classes[id]
	if !ok {
		return service.ClassInfo{}, domain.ErrClassNotFound
	}
	return c, nil
}

func (f *fakeRepo) IsActiveStudent(_ context.Context, classID, userID uuid.UUID) (bool, error) {
	return f.students[classID][userID], nil
}

func (f *fakeRepo) List(_ context.Context, classID uuid.UUID) ([]domain.ClassLink, error) {
	if f.failList != nil {
		return nil, f.failList
	}
	out := append([]domain.ClassLink{}, f.links[classID]...)
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (f *fakeRepo) Replace(_ context.Context, classID uuid.UUID, links []domain.ClassLink) error {
	f.replaced++
	f.links[classID] = append([]domain.ClassLink{}, links...)
	return nil
}

type world struct {
	svc                *service.Service
	repo               *fakeRepo
	class              uuid.UUID
	teacher, other     service.Actor
	admin, student     service.Actor
	outsider, archived service.Actor
	archivedClass      uuid.UUID
}

func setup() world {
	repo := newFake()
	w := world{repo: repo, svc: service.New(repo), class: uuid.New(), archivedClass: uuid.New()}
	w.teacher = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	w.other = service.Actor{UserID: uuid.New(), Role: authn.RoleTeacher}
	w.admin = service.Actor{UserID: uuid.New(), Role: authn.RoleAdmin}
	w.student = service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	w.outsider = service.Actor{UserID: uuid.New(), Role: authn.RoleStudent}
	repo.classes[w.class] = service.ClassInfo{ID: w.class, TeacherID: w.teacher.UserID}
	repo.classes[w.archivedClass] = service.ClassInfo{ID: w.archivedClass, TeacherID: w.teacher.UserID, Archived: true}
	repo.students[w.class] = map[uuid.UUID]bool{w.student.UserID: true}
	repo.students[w.archivedClass] = map[uuid.UUID]bool{w.student.UserID: true}
	return w
}

func two() []domain.Input {
	return []domain.Input{{Name: "Link do Meet", URL: "https://meet.google.com/abc"}, {Name: "Conteúdo", URL: "https://example.com/c"}}
}

// Covers SPEC-048 CA-01: the owner teacher saves the list in the order sent and reads it back.
func TestReplaceAndList(t *testing.T) {
	w := setup()
	ctx := context.Background()
	saved, err := w.svc.Replace(ctx, w.teacher, w.class, two())
	require.NoError(t, err)
	require.Len(t, saved, 2)
	assert.Equal(t, "Link do Meet", saved[0].Name)
	assert.Equal(t, 1, saved[1].Position)

	got, err := w.svc.List(ctx, w.teacher, w.class)
	require.NoError(t, err)
	assert.Equal(t, []string{"Link do Meet", "Conteúdo"}, []string{got[0].Name, got[1].Name})

	// A new list replaces the old one.
	_, err = w.svc.Replace(ctx, w.teacher, w.class, []domain.Input{{Name: "Só este", URL: "https://a.com"}})
	require.NoError(t, err)
	got, _ = w.svc.List(ctx, w.teacher, w.class)
	require.Len(t, got, 1)
	assert.Equal(t, "Só este", got[0].Name)
}

// Covers SPEC-048 CA-02: an empty list removes every link.
func TestReplaceWithEmptyListRemovesAll(t *testing.T) {
	w := setup()
	ctx := context.Background()
	_, err := w.svc.Replace(ctx, w.teacher, w.class, two())
	require.NoError(t, err)
	saved, err := w.svc.Replace(ctx, w.teacher, w.class, nil)
	require.NoError(t, err)
	assert.Empty(t, saved)
	got, _ := w.svc.List(ctx, w.teacher, w.class)
	assert.Empty(t, got)
}

// Covers SPEC-048 CA-03 and CA-04: a bad list saves nothing.
func TestReplaceRejectsBadLists(t *testing.T) {
	w := setup()
	ctx := context.Background()
	_, err := w.svc.Replace(ctx, w.teacher, w.class, two())
	require.NoError(t, err)
	before := w.repo.replaced

	_, err = w.svc.Replace(ctx, w.teacher, w.class, []domain.Input{{Name: "x", URL: "http://a.com"}})
	assert.ErrorIs(t, err, domain.ErrInvalidLink)
	many := make([]domain.Input, 21)
	for i := range many {
		many[i] = domain.Input{Name: "x", URL: "https://a.com"}
	}
	_, err = w.svc.Replace(ctx, w.teacher, w.class, many)
	assert.ErrorIs(t, err, domain.ErrTooManyLinks)

	assert.Equal(t, before, w.repo.replaced, "nothing was written")
	got, _ := w.svc.List(ctx, w.teacher, w.class)
	assert.Len(t, got, 2, "the old list stays")
}

// Covers SPEC-048 CA-05 and RN-05: an archived class refuses the write and allows the read.
func TestArchivedClass(t *testing.T) {
	w := setup()
	ctx := context.Background()
	_, err := w.svc.Replace(ctx, w.teacher, w.archivedClass, two())
	assert.ErrorIs(t, err, domain.ErrClassArchived)
	_, err = w.svc.List(ctx, w.teacher, w.archivedClass)
	assert.NoError(t, err)
	_, err = w.svc.List(ctx, w.student, w.archivedClass)
	assert.NoError(t, err)
}

// Covers SPEC-048 CA-06 and RN-04: who may write.
func TestWriteAuthorization(t *testing.T) {
	w := setup()
	ctx := context.Background()
	_, err := w.svc.Replace(ctx, w.admin, w.class, two())
	assert.NoError(t, err, "an administrator writes in any class")
	_, err = w.svc.Replace(ctx, w.other, w.class, two())
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.Replace(ctx, w.student, w.class, two())
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.Replace(ctx, w.teacher, uuid.New(), two())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}

// Covers SPEC-048 CA-07 and RN-04: who may read.
func TestReadAuthorization(t *testing.T) {
	w := setup()
	ctx := context.Background()
	_, err := w.svc.Replace(ctx, w.teacher, w.class, two())
	require.NoError(t, err)

	got, err := w.svc.List(ctx, w.student, w.class)
	require.NoError(t, err)
	assert.Len(t, got, 2, "an active student reads the list")
	_, err = w.svc.List(ctx, w.outsider, w.class)
	assert.ErrorIs(t, err, domain.ErrClassNotFound, "a student without an active enrollment sees no class")
	_, err = w.svc.List(ctx, w.other, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a teacher of another class is refused")
	_, err = w.svc.List(ctx, w.admin, w.class)
	assert.NoError(t, err)
	_, err = w.svc.List(ctx, service.Actor{UserID: uuid.New(), Role: "GUEST"}, w.class)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = w.svc.List(ctx, w.teacher, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
}

func TestListPropagatesTheRepositoryError(t *testing.T) {
	w := setup()
	w.repo.failList = errors.New("boom")
	_, err := w.svc.List(context.Background(), w.teacher, w.class)
	assert.EqualError(t, err, "boom")
}
