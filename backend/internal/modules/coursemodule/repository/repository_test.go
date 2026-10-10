package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	classrepo "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func TestCourseModuleRepository(t *testing.T) {
	db := dbtest.Open(t)
	repo := repository.New(db)
	userRepo := userrepository.New(db)
	classRepo := classrepo.New(db)
	ctx := context.Background()

	// Create teacher user
	teacherName := "Prof. Teste"
	teacher := userdomain.User{
		Name:   &teacherName,
		Email:  "prof@utfpr.edu.br",
		Role:   userdomain.RoleTeacher,
		Status: userdomain.StatusActive,
	}
	require.NoError(t, userRepo.Create(ctx, &teacher))

	// Create student user
	studentName := "Aluno Modulo"
	ra := "9876543"
	student := userdomain.User{
		Name:       &studentName,
		Email:      "alunomodulo@utfpr.edu.br",
		AcademicID: &ra,
		Role:       userdomain.RoleStudent,
		Status:     userdomain.StatusActive,
	}
	require.NoError(t, userRepo.Create(ctx, &student))

	// Create a class
	now := time.Now().Truncate(time.Microsecond)
	endDate := now.Add(60 * 24 * time.Hour)
	class := classdomain.ClassGroup{
		TeacherID:   teacher.ID,
		Name:        "Sistemas Operacionais 1",
		CourseCode:  "SO01",
		Semester:    "2026/2",
		StartDate:   now,
		EndDate:     endDate,
		Status:      classdomain.ClassStatusActive,
	}
	require.NoError(t, classRepo.CreateClass(ctx, &class, []uuid.UUID{student.ID}, now))

	// 1. Create Module with class assignment
	modID, err := uuid.NewV7()
	require.NoError(t, err)

	startWindow := now.Add(-1 * time.Hour)
	endWindow := now.Add(24 * time.Hour)

	mod := domain.CourseModule{
		TeacherID:       teacher.ID,
		Title:           "Modulo de Processos",
		Description:     "Estudo de fork e exec",
		Visibility:      domain.VisibilityPrivate,
		Status:          domain.ModuleStatusActive,
		ActivationStart: &startWindow,
		ActivationEnd:   &endWindow,
	}
	mod.ID = modID

	err = repo.CreateModule(ctx, &mod, []uuid.UUID{class.ID}, teacher.ID)
	require.NoError(t, err)

	// 2. Add exercises and materials. Items must reference real questions
	// (SPEC-011 RN-10), so two minimal questions are created first.
	newQuestion := func(title string) uuid.UUID {
		id, _ := uuid.NewV7()
		require.NoError(t, db.Conn(ctx).Create(&contentdomain.Question{
			ID: id, ModuleID: mod.ID, Kind: contentdomain.KindDiscursive, Usage: contentdomain.UsageExercise,
			Difficulty: "EASY", Status: contentdomain.StatusPublished, Title: title, Statement: title,
		}).Error)
		return id
	}
	ex1 := newQuestion("Exercise 1")
	ex2 := newQuestion("Exercise 2")
	item1ID, _ := uuid.NewV7()
	item2ID, _ := uuid.NewV7()

	require.NoError(t, repo.AddExerciseItem(ctx, &domain.ModuleExerciseItem{
		ID:            item1ID,
		ModuleID:      mod.ID,
		ExerciseID:    ex1,
		SequenceOrder: 1,
		IsMandatory:   true,
		CreatedAt:     now,
		UpdatedAt:     now,
	}))

	require.NoError(t, repo.AddExerciseItem(ctx, &domain.ModuleExerciseItem{
		ID:            item2ID,
		ModuleID:      mod.ID,
		ExerciseID:    ex2,
		SequenceOrder: 2,
		IsMandatory:   true,
		CreatedAt:     now,
		UpdatedAt:     now,
	}))

	matID, _ := uuid.NewV7()
	matDesc := "Slides de apoio"
	mat := domain.ModuleMaterial{
		ModuleID:    mod.ID,
		Title:       "Slides Aula 1",
		Description: &matDesc,
		URL:         "https://material.utfpr.edu.br/aula1.pdf",
	}
	mat.ID = matID
	require.NoError(t, repo.AddMaterial(ctx, &mat))

	// 3. FindModuleWithDetails
	details, err := repo.FindModuleWithDetails(ctx, mod.ID)
	require.NoError(t, err)
	assert.Equal(t, mod.ID, details.Module.ID)
	assert.Len(t, details.AssignedClassIDs, 1)
	assert.Equal(t, class.ID, details.AssignedClassIDs[0])
	assert.Len(t, details.ExerciseItems, 2)
	assert.Len(t, details.Materials, 1)
	assert.Equal(t, int64(2), details.TotalExercises)
	assert.Equal(t, int64(1), details.TotalMaterials)

	// 4. ValidateTeacherClasses
	valid, err := repo.ValidateTeacherClasses(ctx, teacher.ID, []uuid.UUID{class.ID})
	require.NoError(t, err)
	assert.True(t, valid)

	invalidClassID := uuid.New()
	valid, err = repo.ValidateTeacherClasses(ctx, teacher.ID, []uuid.UUID{invalidClassID})
	require.NoError(t, err)
	assert.False(t, valid)

	// 5. IsStudentEnrolledInAnyClass
	enrolled, err := repo.IsStudentEnrolledInAnyClass(ctx, student.ID, []uuid.UUID{class.ID})
	require.NoError(t, err)
	assert.True(t, enrolled)

	otherStudent := uuid.New()
	enrolled, err = repo.IsStudentEnrolledInAnyClass(ctx, otherStudent, []uuid.UUID{class.ID})
	require.NoError(t, err)
	assert.False(t, enrolled)

	// 6. ListTeacherModules
	teacherList, err := repo.ListTeacherModules(ctx, teacher.ID, repository.ListFilter{Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), teacherList.TotalCount)
	assert.Equal(t, int64(2), teacherList.Items[0].TotalExercises)
	assert.Equal(t, int64(1), teacherList.Items[0].TotalMaterials)

	// 6b. ListAllModules: an administrator lists the modules of every teacher, a teacher only their own.
	otherName := "Outra Docente"
	otherTeacher := userdomain.User{Name: &otherName, Email: "outra@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userRepo.Create(ctx, &otherTeacher))
	otherModule := domain.CourseModule{TeacherID: otherTeacher.ID, Title: "Módulo de outra docente", Visibility: domain.VisibilityPrivate, Status: domain.ModuleStatusActive}
	require.NoError(t, repo.CreateModule(ctx, &otherModule, nil, otherTeacher.ID))
	all, err := repo.ListAllModules(ctx, repository.ListFilter{Page: 1, Limit: 50})
	require.NoError(t, err)
	assert.Equal(t, teacherList.TotalCount+1, all.TotalCount, "the other teacher's module is included")
	own, err := repo.ListTeacherModules(ctx, teacher.ID, repository.ListFilter{Page: 1, Limit: 50})
	require.NoError(t, err)
	assert.Equal(t, teacherList.TotalCount, own.TotalCount, "a teacher still sees only their own")
	allFiltered, err := repo.ListAllModules(ctx, repository.ListFilter{Page: 1, Limit: 50, Search: "outra docente"})
	require.NoError(t, err)
	assert.Equal(t, int64(1), allFiltered.TotalCount, "filters apply to the administrative listing too")

	// 6c. SlugTaken and the unique index: a slug belongs to one module that was not deleted.
	slug := "slug-do-modulo"
	otherModule.Slug = &slug
	require.NoError(t, repo.UpdateModule(ctx, &otherModule, nil, otherTeacher.ID))
	taken, err := repo.SlugTaken(ctx, slug, uuid.New())
	require.NoError(t, err)
	assert.True(t, taken, "another module uses it")
	taken, err = repo.SlugTaken(ctx, slug, otherModule.ID)
	require.NoError(t, err)
	assert.False(t, taken, "a module does not conflict with itself")
	taken, err = repo.SlugTaken(ctx, "livre", uuid.New())
	require.NoError(t, err)
	assert.False(t, taken)
	duplicate := domain.CourseModule{TeacherID: teacher.ID, Title: "Duplicado", Description: "d", Visibility: domain.VisibilityPublic, Status: domain.ModuleStatusActive, Slug: &slug}
	assert.Error(t, repo.CreateModule(ctx, &duplicate, nil, teacher.ID), "the database refuses a repeated slug")

	// 7. ListStudentModules (student is enrolled in class, so should see the private module)
	studentList, err := repo.ListStudentModules(ctx, student.ID, now, repository.ListFilter{Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), studentList.TotalCount)

	// 8. ListPublicModules (should be 0 since this module is private)
	pubList, err := repo.ListPublicModules(ctx, now, repository.ListFilter{Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(0), pubList.TotalCount)

	// 9. UpdateModule (change to PUBLIC)
	mod.Visibility = domain.VisibilityPublic
	mod.Title = "Modulo Publico de Processos"
	require.NoError(t, repo.UpdateModule(ctx, &mod, []uuid.UUID{}, teacher.ID))

	// Now check public list again
	pubList, err = repo.ListPublicModules(ctx, now, repository.ListFilter{Page: 1, Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), pubList.TotalCount)
	assert.Equal(t, "Modulo Publico de Processos", pubList.Items[0].Title)

	// 10. Reorder exercises: change order to [ex2, ex1]
	require.NoError(t, repo.UpdateExerciseOrder(ctx, mod.ID, []uuid.UUID{ex2, ex1}))
	updatedDetails, err := repo.FindModuleWithDetails(ctx, mod.ID)
	require.NoError(t, err)
	assert.Equal(t, ex2, updatedDetails.ExerciseItems[0].ExerciseID)
	assert.Equal(t, 1, updatedDetails.ExerciseItems[0].SequenceOrder)
	assert.Equal(t, ex1, updatedDetails.ExerciseItems[1].ExerciseID)
	assert.Equal(t, 2, updatedDetails.ExerciseItems[1].SequenceOrder)

	// 11. Test error cases and query filters
	// Find non-existent
	_, err = repo.FindModuleByID(ctx, uuid.New())
	assert.Equal(t, domain.ErrModuleNotFound, err)

	_, err = repo.FindModuleWithDetails(ctx, uuid.New())
	assert.Equal(t, domain.ErrModuleNotFound, err)

	// Reorder with non-matching exercise
	err = repo.UpdateExerciseOrder(ctx, mod.ID, []uuid.UUID{uuid.New()})
	assert.Equal(t, domain.ErrInvalidExerciseSequence, err)

	// Search filters
	teacherListFiltered, err := repo.ListTeacherModules(ctx, teacher.ID, repository.ListFilter{
		Search:     "Processos",
		Status:     string(domain.ModuleStatusActive),
		Visibility: string(domain.VisibilityPublic),
		Page:       1,
		Limit:      5,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), teacherListFiltered.TotalCount)

	pubListFiltered, err := repo.ListPublicModules(ctx, now, repository.ListFilter{
		Search: "Modulo",
		Page:   1,
		Limit:  5,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), pubListFiltered.TotalCount)

	studentListFiltered, err := repo.ListStudentModules(ctx, student.ID, now, repository.ListFilter{
		Search: "Modulo",
		Page:   1,
		Limit:  5,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(1), studentListFiltered.TotalCount)
}
