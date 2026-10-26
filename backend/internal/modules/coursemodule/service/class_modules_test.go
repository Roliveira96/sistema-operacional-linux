package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// modulesFixture is a teacher with a class, another teacher with another class, an administrator and the modules each of them made.
type modulesFixture struct {
	repo                  *mockRepository
	svc                   *service.Service
	teacher, other, admin uuid.UUID
	class, otherClass     uuid.UUID
}

func newModulesFixture() *modulesFixture {
	f := &modulesFixture{repo: newMockRepository(), teacher: uuid.New(), other: uuid.New(), admin: uuid.New(), class: uuid.New(), otherClass: uuid.New()}
	f.repo.classTeachers[f.class] = f.teacher
	f.repo.classTeachers[f.otherClass] = f.other
	f.svc = service.New(f.repo)
	return f
}

// module stores a module of owner, with the visibility and the classes it is assigned to.
func (f *modulesFixture) module(owner uuid.UUID, visibility domain.Visibility, classes ...uuid.UUID) uuid.UUID {
	id := uuid.New()
	m := domain.CourseModule{Model: database.Model{ID: id}, TeacherID: owner, Title: "Módulo", Description: "d", Visibility: visibility, Status: domain.ModuleStatusActive}
	f.repo.modules[id] = m
	f.repo.details[id] = repository.ModuleDetails{Module: m, AssignedClassIDs: classes}
	return id
}

func (f *modulesFixture) assignedTo(class uuid.UUID) []uuid.UUID {
	ids, _ := f.repo.ClassModuleIDs(context.Background(), class)
	return ids
}

func (f *modulesFixture) set(caller uuid.UUID, admin bool, class uuid.UUID, ids ...uuid.UUID) ([]uuid.UUID, error) {
	return f.svc.SetClassModules(context.Background(), caller, admin, class, ids)
}

// Covers SPEC-078 CA-12 (RN-03): the set of the class is written whole: what comes is assigned, what was there and did not come is not, and the
// assignments of the other classes do not change.
func TestSetClassModules_ReplacesTheSetOfThatClassOnly(t *testing.T) {
	f := newModulesFixture()
	m1 := f.module(f.teacher, domain.VisibilityPublic, f.class)
	m2 := f.module(f.teacher, domain.VisibilityPublic, f.class, f.otherClass)
	m3 := f.module(f.teacher, domain.VisibilityPublic)

	got, err := f.set(f.teacher, false, f.class, m2, m3)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{m2, m3}, got)
	assert.ElementsMatch(t, []uuid.UUID{m2, m3}, f.assignedTo(f.class))
	assert.ElementsMatch(t, []uuid.UUID{m2}, f.assignedTo(f.otherClass), "the other class keeps what it had")
	assert.Empty(t, f.repo.details[m1].AssignedClassIDs)

	got, err = f.set(f.teacher, false, f.class)
	require.NoError(t, err)
	assert.Empty(t, got, "an empty list takes every module away")
	assert.Empty(t, f.assignedTo(f.class))
}

// Covers SPEC-078 CA-13 (RN-03): a repeated or unknown module refuses the whole list, and nothing is written.
func TestSetClassModules_RejectsRepeatedAndUnknownModules(t *testing.T) {
	f := newModulesFixture()
	m1 := f.module(f.teacher, domain.VisibilityPublic)

	_, err := f.set(f.teacher, false, f.class, m1, m1)
	assert.ErrorIs(t, err, domain.ErrInvalidModules)
	_, err = f.set(f.teacher, false, f.class, m1, uuid.New())
	assert.ErrorIs(t, err, domain.ErrInvalidModules)
	assert.Zero(t, f.repo.replaced, "nothing was written")
}

// Covers SPEC-078 CA-13 (RN-04): a teacher assigns only the modules she made; an administrator assigns any. What was assigned by someone else stays
// as it is when a teacher writes the set.
func TestSetClassModules_TeacherOnlyAssignsOwnModulesAdminAnyModule(t *testing.T) {
	f := newModulesFixture()
	own := f.module(f.teacher, domain.VisibilityPublic)
	foreign := f.module(f.other, domain.VisibilityPublic)

	_, err := f.set(f.teacher, false, f.class, own, foreign)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	assert.Zero(t, f.repo.replaced, "nothing was written")

	got, err := f.set(f.admin, true, f.class, own, foreign)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{own, foreign}, got, "the administrator assigns the module of anyone")

	// the module of the other teacher is already there; the teacher writes her set without it and it stays
	got, err = f.set(f.teacher, false, f.class)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{foreign}, got, "only her own modules were taken away")
	assert.ElementsMatch(t, []uuid.UUID{foreign}, f.assignedTo(f.class))
}

// Covers SPEC-078 CA-13 (RN-04): only the teacher of the class and an administrator write; an unknown class is not found.
func TestSetClassModules_OnlyOwnerTeacherAndAdminWrite(t *testing.T) {
	f := newModulesFixture()
	m := f.module(f.teacher, domain.VisibilityPublic)

	_, err := f.set(f.other, false, f.class, m)
	assert.ErrorIs(t, err, domain.ErrForbidden, "a teacher who does not own the class")
	_, err = f.set(f.teacher, false, uuid.New(), m)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	_, err = f.set(f.admin, true, uuid.New(), m)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	_, err = f.set(f.admin, true, f.class, m)
	assert.NoError(t, err, "an administrator writes in any class")
	assert.Equal(t, 1, f.repo.replaced)
}

// Covers SPEC-078 CA-14 (RN-05): a public or authenticated module is assigned to a class without changing who sees it.
func TestSetClassModules_AcceptsPublicAndAuthenticatedModules(t *testing.T) {
	f := newModulesFixture()
	public := f.module(f.teacher, domain.VisibilityPublic)
	authenticated := f.module(f.teacher, domain.VisibilityAuthenticated)

	got, err := f.set(f.teacher, false, f.class, public, authenticated)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{public, authenticated}, got)
	assert.Equal(t, domain.VisibilityPublic, f.repo.details[public].Module.Visibility)
	assert.Equal(t, domain.VisibilityAuthenticated, f.repo.details[authenticated].Module.Visibility)
}

// Covers SPEC-078 CA-15 (RN-06): taking a private module from its only class would leave it with none, so it is refused and nothing is written;
// with another class it goes.
func TestSetClassModules_RefusesToLeaveAPrivateModuleWithoutAClass(t *testing.T) {
	f := newModulesFixture()
	alone := f.module(f.teacher, domain.VisibilityPrivate, f.class)

	_, err := f.set(f.teacher, false, f.class)
	var needs *domain.ModuleNeedsClassError
	require.ErrorAs(t, err, &needs)
	assert.Equal(t, alone, needs.ModuleID)
	assert.ErrorIs(t, err, domain.ErrModuleNeedsClass)
	assert.Zero(t, f.repo.replaced, "nothing was written")
	assert.ElementsMatch(t, []uuid.UUID{alone}, f.assignedTo(f.class))

	shared := f.module(f.teacher, domain.VisibilityPrivate, f.class, f.otherClass)
	_, err = f.set(f.teacher, false, f.class, alone)
	assert.NoError(t, err, "a private module that has another class can leave this one")
	assert.False(t, errors.As(err, &needs))
	assert.ElementsMatch(t, []uuid.UUID{alone}, f.assignedTo(f.class))
	assert.ElementsMatch(t, []uuid.UUID{shared}, f.assignedTo(f.otherClass))
}

// Covers SPEC-078 CA-14 (RN-05): saving a module that is not private, with the empty list of classes that its form sends, does not take away the
// classes that were assigned to it.
func TestUpdateModule_NonPrivateModuleKeepsItsClassAssignmentsWhenTheListIsEmpty(t *testing.T) {
	f := newModulesFixture()
	public := f.module(f.teacher, domain.VisibilityPublic, f.class)
	title := "Novo título"

	_, err := f.svc.UpdateModule(context.Background(), service.UpdateModuleInput{ModuleID: public, CallerID: f.teacher, Title: &title, ClassIDs: []uuid.UUID{}})
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{f.class}, f.repo.details[public].AssignedClassIDs)
	assert.Equal(t, "Novo título", f.repo.modules[public].Title)

	// a private module still takes the list it is given
	private := f.module(f.teacher, domain.VisibilityPrivate, f.class)
	f.repo.teacherClasses[f.teacher] = []uuid.UUID{f.class, f.otherClass}
	_, err = f.svc.UpdateModule(context.Background(), service.UpdateModuleInput{ModuleID: private, CallerID: f.teacher, ClassIDs: []uuid.UUID{f.class, f.otherClass}})
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{f.class, f.otherClass}, f.repo.details[private].AssignedClassIDs)
}
