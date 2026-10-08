package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
)

// fakeRepo is an in-memory Repository.
type fakeRepo struct {
	users map[uuid.UUID]domain.User
}

func newFakeRepo() *fakeRepo { return &fakeRepo{users: map[uuid.UUID]domain.User{}} }

func (f *fakeRepo) find(match func(domain.User) bool) (domain.User, error) {
	for _, u := range f.users {
		if match(u) {
			return u, nil
		}
	}
	return domain.User{}, domain.ErrNotFound
}

func (f *fakeRepo) FindByID(_ context.Context, id uuid.UUID) (domain.User, error) {
	return f.find(func(u domain.User) bool { return u.ID == id })
}

func (f *fakeRepo) FindByEmail(_ context.Context, email string) (domain.User, error) {
	return f.find(func(u domain.User) bool { return u.Email == email })
}

func (f *fakeRepo) FindByAcademicID(_ context.Context, ra string) (domain.User, error) {
	return f.find(func(u domain.User) bool { return u.AcademicID != nil && *u.AcademicID == ra })
}

func (f *fakeRepo) Create(_ context.Context, u *domain.User) error {
	if _, err := f.FindByEmail(context.Background(), u.Email); err == nil {
		return domain.ErrEmailTaken
	}
	u.ID = uuid.New()
	f.users[u.ID] = *u
	return nil
}

func (f *fakeRepo) UpdatePassword(_ context.Context, id uuid.UUID, hash string, mustChange bool) error {
	u, ok := f.users[id]
	if !ok {
		return domain.ErrNotFound
	}
	u.PasswordHash = &hash
	u.MustChangePassword = mustChange
	f.users[id] = u
	return nil
}

func TestCreateNormalizesAndDefaultsStatus(t *testing.T) {
	repo := newFakeRepo()
	svc := New(repo)
	ra := "a1234567"
	u := domain.User{Email: " Student@Example.com ", AcademicID: &ra, Role: domain.RoleStudent}
	require.NoError(t, svc.Create(context.Background(), &u))

	assert.Equal(t, "student@example.com", u.Email)
	assert.Equal(t, "1234567", *u.AcademicID)
	assert.Equal(t, domain.StatusActive, u.Status)
	assert.ErrorIs(t, svc.Create(context.Background(), &domain.User{Email: "student@example.com"}), domain.ErrEmailTaken)
}

func TestCreateRejectsInvalidIdentifiers(t *testing.T) {
	svc := New(newFakeRepo())
	assert.ErrorIs(t, svc.Create(context.Background(), &domain.User{Email: "bad"}), domain.ErrInvalidEmail)
	bad := "12"
	assert.ErrorIs(t, svc.Create(context.Background(), &domain.User{Email: "a@b.co", AcademicID: &bad}), domain.ErrInvalidAcademicID)
}

func TestFindByIdentifierAndEmail(t *testing.T) {
	repo := newFakeRepo()
	svc := New(repo)
	ra := "7654321"
	u := domain.User{Email: "s@example.com", AcademicID: &ra}
	require.NoError(t, svc.Create(context.Background(), &u))

	byEmail, err := svc.FindByIdentifier(context.Background(), domain.Identifier{Email: "s@example.com"})
	require.NoError(t, err)
	assert.Equal(t, u.ID, byEmail.ID)

	byRA, err := svc.FindByIdentifier(context.Background(), domain.Identifier{AcademicID: "7654321"})
	require.NoError(t, err)
	assert.Equal(t, u.ID, byRA.ID)

	found, err := svc.FindByEmail(context.Background(), " S@EXAMPLE.COM")
	require.NoError(t, err)
	assert.Equal(t, u.ID, found.ID)
	_, err = svc.FindByEmail(context.Background(), "invalid")
	assert.ErrorIs(t, err, domain.ErrInvalidEmail)

	byID, err := svc.FindByID(context.Background(), u.ID)
	require.NoError(t, err)
	assert.Equal(t, u.Email, byID.Email)
}

func TestSetPassword(t *testing.T) {
	repo := newFakeRepo()
	svc := New(repo)
	u := domain.User{Email: "s@example.com"}
	require.NoError(t, svc.Create(context.Background(), &u))
	require.NoError(t, svc.SetPassword(context.Background(), u.ID, "hash", true))
	assert.Equal(t, "hash", *repo.users[u.ID].PasswordHash)
	assert.True(t, repo.users[u.ID].MustChangePassword)
	assert.ErrorIs(t, svc.SetPassword(context.Background(), uuid.New(), "x", false), domain.ErrNotFound)
}
