package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

type env struct {
	ctx     context.Context
	db      *database.DB
	repo    *repository.Repository
	teacher userdomain.User
	student userdomain.User
	class   classdomain.ClassGroup
}

func newEnv(t *testing.T) env {
	t.Helper()
	db := dbtest.Open(t)
	e := env{ctx: context.Background(), db: db, repo: repository.New(db)}
	users := userrepository.New(db)
	name := "Profa. Sediane"
	e.teacher = userdomain.User{Name: &name, Email: "prof@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(e.ctx, &e.teacher))
	ra, sname := "1000001", "Ana"
	e.student = userdomain.User{Name: &sname, Email: "ana@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(e.ctx, &e.student))
	day := func(m time.Month, d int) time.Time { return time.Date(2026, m, d, 0, 0, 0, 0, time.UTC) }
	e.class = classdomain.ClassGroup{TeacherID: e.teacher.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: day(10, 1), EndDate: day(10, 31), Status: classdomain.ClassStatusActive}
	require.NoError(t, classrepository.New(db).CreateClass(e.ctx, &e.class, []uuid.UUID{e.student.ID}, time.Now()))
	return e
}

func links(t *testing.T, classID uuid.UUID, names ...string) []domain.ClassLink {
	t.Helper()
	in := make([]domain.Input, len(names))
	for i, n := range names {
		in[i] = domain.Input{Name: n, URL: "https://example.com/" + n}
	}
	out, err := domain.BuildLinks(classID, in)
	require.NoError(t, err)
	return out
}

// Covers SPEC-048 CA-08: the list is replaced as a whole, in order, and the old links are soft deleted.
func TestRepository_ReplaceAndList(t *testing.T) {
	e := newEnv(t)
	require.NoError(t, e.repo.Replace(e.ctx, e.class.ID, links(t, e.class.ID, "meet", "conteudo", "repo")))

	got, err := e.repo.List(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, got, 3)
	assert.Equal(t, []string{"meet", "conteudo", "repo"}, []string{got[0].Name, got[1].Name, got[2].Name})
	assert.Equal(t, []int{0, 1, 2}, []int{got[0].Position, got[1].Position, got[2].Position})
	assert.Equal(t, "https://example.com/meet", got[0].URL)

	require.NoError(t, e.repo.Replace(e.ctx, e.class.ID, links(t, e.class.ID, "novo")))
	got, err = e.repo.List(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "novo", got[0].Name)

	var total, alive int64
	require.NoError(t, e.db.Conn(e.ctx).Table("class_links").Where("class_id = ?", e.class.ID).Count(&total).Error)
	require.NoError(t, e.db.Conn(e.ctx).Table("class_links").Where("class_id = ? AND deleted_at IS NULL", e.class.ID).Count(&alive).Error)
	assert.EqualValues(t, 4, total, "the replaced links stay in the history")
	assert.EqualValues(t, 1, alive)

	require.NoError(t, e.repo.Replace(e.ctx, e.class.ID, nil))
	got, err = e.repo.List(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Empty(t, got)
}

// Covers SPEC-048 CA-08: a list is saved all or nothing.
func TestRepository_ReplaceIsAtomic(t *testing.T) {
	e := newEnv(t)
	require.NoError(t, e.repo.Replace(e.ctx, e.class.ID, links(t, e.class.ID, "antigo")))

	broken := links(t, e.class.ID, "a", "b")
	broken[1].ID = broken[0].ID // the same primary key: the second insert fails
	require.Error(t, e.repo.Replace(e.ctx, e.class.ID, broken))

	got, err := e.repo.List(e.ctx, e.class.ID)
	require.NoError(t, err)
	require.Len(t, got, 1, "the old list is still there")
	assert.Equal(t, "antigo", got[0].Name)
}

// Covers SPEC-048 RN-03: the links of one class do not touch the links of another.
func TestRepository_ClassesAreIndependent(t *testing.T) {
	e := newEnv(t)
	other := e.class
	other.ID = uuid.Nil
	other.CourseCode = "SO99X"
	require.NoError(t, classrepository.New(e.db).CreateClass(e.ctx, &other, nil, time.Now()))
	require.NoError(t, e.repo.Replace(e.ctx, e.class.ID, links(t, e.class.ID, "a")))
	require.NoError(t, e.repo.Replace(e.ctx, other.ID, links(t, other.ID, "b")))
	require.NoError(t, e.repo.Replace(e.ctx, e.class.ID, nil))

	got, err := e.repo.List(e.ctx, other.ID)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "b", got[0].Name)
}

// Covers SPEC-048 RN-04: the class and the enrollment the service decides on.
func TestRepository_ClassAndStudent(t *testing.T) {
	e := newEnv(t)
	info, err := e.repo.FindClass(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Equal(t, e.teacher.ID, info.TeacherID)
	assert.False(t, info.Archived)

	_, err = e.repo.FindClass(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	active, err := e.repo.IsActiveStudent(e.ctx, e.class.ID, e.student.ID)
	require.NoError(t, err)
	assert.True(t, active)
	active, err = e.repo.IsActiveStudent(e.ctx, e.class.ID, uuid.New())
	require.NoError(t, err)
	assert.False(t, active)

	archived := e.class
	archived.Status = classdomain.ClassStatusArchived
	require.NoError(t, classrepository.New(e.db).UpdateClass(e.ctx, &archived))
	info, err = e.repo.FindClass(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.True(t, info.Archived)
}
