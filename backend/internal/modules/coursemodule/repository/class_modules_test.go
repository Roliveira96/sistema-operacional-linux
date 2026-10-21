package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classrepo "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

type classModulesEnv struct {
	ctx     context.Context
	repo    *repository.Repository
	teacher userdomain.User
	class   classdomain.ClassGroup
	other   classdomain.ClassGroup
}

func newClassModulesEnv(t *testing.T) classModulesEnv {
	t.Helper()
	db := dbtest.Open(t)
	e := classModulesEnv{ctx: context.Background(), repo: repository.New(db)}
	name := "Profa. Turma"
	e.teacher = userdomain.User{Name: &name, Email: "turma@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(e.ctx, &e.teacher))
	now := time.Now().Truncate(time.Microsecond)
	newClass := func(code string) classdomain.ClassGroup {
		c := classdomain.ClassGroup{TeacherID: e.teacher.ID, Name: code, CourseCode: code, Semester: "2026/2", StartDate: now, EndDate: now.Add(60 * 24 * time.Hour), Status: classdomain.ClassStatusActive}
		require.NoError(t, classrepo.New(db).CreateClass(e.ctx, &c, nil, now))
		return c
	}
	e.class, e.other = newClass("SO01"), newClass("SO02")
	return e
}

func (e classModulesEnv) module(t *testing.T, title string, classIDs ...uuid.UUID) uuid.UUID {
	t.Helper()
	m := domain.CourseModule{TeacherID: e.teacher.ID, Title: title, Description: "d", Visibility: domain.VisibilityAuthenticated, Status: domain.ModuleStatusActive}
	m.ID, _ = uuid.NewV7()
	require.NoError(t, e.repo.CreateModule(e.ctx, &m, classIDs, e.teacher.ID))
	return m.ID
}

// Covers SPEC-078 CA-13 (RN-03, RN-04): the teacher of a class is read, a class that does not exist is not found, and the modules assigned to the
// class are listed without the ones of other classes.
func TestRepository_ClassTeacherAndClassModuleIDs(t *testing.T) {
	e := newClassModulesEnv(t)
	inClass := e.module(t, "Na turma", e.class.ID)
	e.module(t, "Na outra", e.other.ID)
	e.module(t, "Em nenhuma")

	teacher, err := e.repo.ClassTeacher(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Equal(t, e.teacher.ID, teacher)
	_, err = e.repo.ClassTeacher(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	ids, err := e.repo.ClassModuleIDs(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{inClass}, ids)
}

// Covers SPEC-078 CA-12, CA-13 (RN-03): the set of a class is written in one transaction: what was asked is assigned and removed together, and a
// failure in the middle leaves the class as it was.
func TestRepository_ReplaceClassModulesIsAtomic(t *testing.T) {
	e := newClassModulesEnv(t)
	kept := e.module(t, "Fica", e.class.ID)
	leaves := e.module(t, "Sai", e.class.ID)
	arrives := e.module(t, "Entra")
	elsewhere := e.module(t, "Em outra", e.other.ID)

	require.NoError(t, e.repo.ReplaceClassModules(e.ctx, e.class.ID, []uuid.UUID{arrives}, []uuid.UUID{leaves}, e.teacher.ID))
	ids, err := e.repo.ClassModuleIDs(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{kept, arrives}, ids)
	other, err := e.repo.ClassModuleIDs(e.ctx, e.other.ID)
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{elsewhere}, other, "the other class did not change")

	// the second module to add does not exist: the removal and the first addition are undone
	err = e.repo.ReplaceClassModules(e.ctx, e.class.ID, []uuid.UUID{elsewhere, uuid.New()}, []uuid.UUID{kept}, e.teacher.ID)
	require.Error(t, err)
	ids, err = e.repo.ClassModuleIDs(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{kept, arrives}, ids, "the class is as it was before the failure")
}
