package repository_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
)

// Covers SPEC-050 CA-01, CA-04, CA-05 and RN-03: the class is soft deleted with who did it, and what hangs from it stays.
func TestRepository_DeleteClass(t *testing.T) {
	env := newEnrollEnv(t)
	student := env.student(t, "1000001")
	class := env.class(t, "SO34E", student.ID)
	other := env.class(t, "SO99X")
	archivedAt := env.now.Add(-40 * 24 * time.Hour)
	class.Status = domain.ClassStatusArchived
	class.ArchivedAt = &archivedAt
	class.ArchivedBy = &env.teacher.ID
	require.NoError(t, env.repo.UpdateClass(env.ctx, &class))

	require.NoError(t, env.repo.DeleteClass(env.ctx, &class, env.teacher.ID))

	_, err := env.repo.FindClassByID(env.ctx, class.ID)
	assert.ErrorIs(t, err, domain.ErrClassNotFound)
	list, err := env.repo.ListClassesByTeacher(env.ctx, env.teacher.ID, repository.ListFilter{Limit: 20})
	require.NoError(t, err)
	require.Len(t, list.Items, 1, "the deleted class is not listed")
	assert.Equal(t, other.ID, list.Items[0].Class.ID)

	var row struct {
		DeletedBy *string
		DeletedAt *time.Time
	}
	require.NoError(t, env.db.Conn(env.ctx).Raw("SELECT deleted_by::text AS deleted_by, deleted_at FROM classes WHERE id = ?", class.ID).Scan(&row).Error)
	require.NotNil(t, row.DeletedBy)
	assert.Equal(t, env.teacher.ID.String(), *row.DeletedBy)
	assert.NotNil(t, row.DeletedAt)

	var enrollments int64
	require.NoError(t, env.db.Conn(env.ctx).Table("class_enrollments").Where("class_id = ?", class.ID).Count(&enrollments).Error)
	assert.EqualValues(t, 1, enrollments, "the enrollments are kept")
}

// Covers SPEC-050 CA-04: a deleted class does not take part in the menus.
func TestRepository_DeletedClassIsGoneFromTheMenus(t *testing.T) {
	env := newEnrollEnv(t)
	student := env.student(t, "1000002")
	class := env.class(t, "SO34E", student.ID)
	class.Status = domain.ClassStatusArchived
	at := env.now.Add(-31 * 24 * time.Hour)
	class.ArchivedAt = &at
	require.NoError(t, env.repo.UpdateClass(env.ctx, &class))
	require.NoError(t, env.repo.DeleteClass(env.ctx, &class, env.teacher.ID))

	menu, err := env.repo.ListStudentClassesForMenu(env.ctx, student.ID, 20)
	require.NoError(t, err)
	assert.Empty(t, menu.Items)
	teacherMenu, err := env.repo.ListTeacherClassesForMenu(env.ctx, env.teacher.ID, 20)
	require.NoError(t, err)
	assert.Empty(t, teacherMenu.Items)
}
