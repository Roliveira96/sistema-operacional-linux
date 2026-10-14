package repository_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

type enrollEnv struct {
	ctx     context.Context
	db      *database.DB
	repo    *repository.Repository
	users   *userrepository.Repository
	teacher userdomain.User
	now     time.Time
}

func newEnrollEnv(t *testing.T) enrollEnv {
	t.Helper()
	db := dbtest.Open(t)
	env := enrollEnv{ctx: context.Background(), db: db, repo: repository.New(db), users: userrepository.New(db),
		now: time.Now().UTC().Truncate(time.Microsecond)}
	name := "Profa. Sediane"
	env.teacher = userdomain.User{Name: &name, Email: "prof@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, env.users.Create(env.ctx, &env.teacher))
	return env
}

func (e enrollEnv) student(t *testing.T, ra string) userdomain.User {
	t.Helper()
	u := userdomain.User{Email: ra + "@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, e.users.Create(e.ctx, &u))
	return u
}

func (e enrollEnv) class(t *testing.T, code string, initial ...uuid.UUID) domain.ClassGroup {
	t.Helper()
	c := domain.ClassGroup{TeacherID: e.teacher.ID, Name: "SO", CourseCode: code, Semester: "2026/2",
		StartDate: e.now, EndDate: e.now.Add(90 * 24 * time.Hour), Status: domain.ClassStatusActive}
	require.NoError(t, e.repo.CreateClass(e.ctx, &c, initial, e.now))
	return c
}

func (e enrollEnv) count(t *testing.T, classID, userID uuid.UUID) int64 {
	t.Helper()
	var n int64
	require.NoError(t, e.db.Conn(e.ctx).Table("class_enrollments").
		Where("class_id = ? AND user_id = ? AND deleted_at IS NULL", classID, userID).Count(&n).Error)
	return n
}

// Reproduces the defect of SPEC-041 RN-06 (D-08): a repeated initial student aborted the PostgreSQL transaction.
func TestRepository_CreateClassWithDuplicateInitialStudents(t *testing.T) {
	env := newEnrollEnv(t)
	s := env.student(t, "1000001")

	c := env.class(t, "SO34E", s.ID, s.ID)
	assert.Equal(t, int64(1), env.count(t, c.ID, s.ID))
}

// Covers SPEC-041 RN-06 and CA-07: the batch is atomic and a unique conflict does not abort it.
func TestRepository_EnrollStudentsIgnoresUniqueConflict(t *testing.T) {
	env := newEnrollEnv(t)
	already, fresh, pending := env.student(t, "1000001"), env.student(t, "1000002"), env.student(t, "1000003")
	c := env.class(t, "SO34E", already.ID)
	pendingEnrollment := domain.Enrollment{ClassID: c.ID, UserID: pending.ID, Status: domain.EnrollmentPendingModeration,
		Origin: domain.OriginInviteLink, RequestedAt: env.now}
	require.NoError(t, env.repo.CreateEnrollment(env.ctx, &pendingEnrollment))

	pendingEnrollment.Status = domain.EnrollmentActive
	pendingEnrollment.DecidedAt = &env.now
	created := []domain.Enrollment{
		{ClassID: c.ID, UserID: already.ID, Status: domain.EnrollmentActive, Origin: domain.OriginDirectByTeacher, RequestedAt: env.now, DecidedAt: &env.now},
		{ClassID: c.ID, UserID: fresh.ID, Status: domain.EnrollmentActive, Origin: domain.OriginDirectByTeacher, RequestedAt: env.now, DecidedAt: &env.now},
	}
	require.NoError(t, env.repo.SaveEnrollments(env.ctx, created, []domain.Enrollment{pendingEnrollment}))

	assert.Equal(t, int64(1), env.count(t, c.ID, already.ID))
	assert.Equal(t, int64(1), env.count(t, c.ID, fresh.ID))
	got, err := env.repo.FindEnrollment(env.ctx, c.ID, pending.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.EnrollmentActive, got.Status)
}

// Covers SPEC-041 section 3.2 (repository): roles, enrollments and names are read in batch.
func TestRepository_ReadsUsersAndEnrollmentsInBatch(t *testing.T) {
	env := newEnrollEnv(t)
	a, b := env.student(t, "1000001"), env.student(t, "1000002")
	c := env.class(t, "SO34E", a.ID)
	missing := uuid.New()

	roles, err := env.repo.FindUserRoles(env.ctx, []uuid.UUID{a.ID, b.ID, env.teacher.ID, missing})
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]string{a.ID: "STUDENT", b.ID: "STUDENT", env.teacher.ID: "TEACHER"}, roles)

	enrollments, err := env.repo.ListEnrollmentsByUsers(env.ctx, c.ID, []uuid.UUID{a.ID, b.ID})
	require.NoError(t, err)
	require.Len(t, enrollments, 1)
	assert.Equal(t, a.ID, enrollments[0].UserID)

	name, err := env.repo.FindUserName(env.ctx, env.teacher.ID)
	require.NoError(t, err)
	require.NotNil(t, name)
	assert.Equal(t, "Profa. Sediane", *name)
	name, err = env.repo.FindUserName(env.ctx, missing)
	require.NoError(t, err)
	assert.Nil(t, name)
}

// Covers SPEC-041 section 4: the summary is stored and read back.
func TestRepository_StoresSummary(t *testing.T) {
	env := newEnrollEnv(t)
	c := domain.ClassGroup{TeacherID: env.teacher.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2", Summary: "Linux na prática",
		StartDate: env.now, EndDate: env.now.Add(time.Hour), Status: domain.ClassStatusActive}
	require.NoError(t, env.repo.CreateClass(env.ctx, &c, nil, env.now))
	got, err := env.repo.FindClassByID(env.ctx, c.ID)
	require.NoError(t, err)
	assert.Equal(t, "Linux na prática", got.Summary)
}

// Covers SPEC-041 RN-07 and CA-12: plain text becomes paragraphs with escaped text; HTML and empty fields stay as they are.
func TestMigration00025_ConvertsPlainTextToParagraphs(t *testing.T) {
	env := newEnrollEnv(t)
	conn := env.db.Conn(env.ctx)
	plain, html, empty := uuid.New(), uuid.New(), uuid.New()
	insert := `INSERT INTO classes (id, teacher_id, name, course_code, semester, syllabus, institutional_guidelines, start_date, end_date, status, created_at, updated_at, created_by, updated_by)
        VALUES (?, ?, 'SO', ?, '2026/2', ?, ?, NOW(), NOW(), 'ACTIVE', NOW(), NOW(), ?, ?)`
	require.NoError(t, conn.Exec(insert, plain, env.teacher.ID, "A1", "Linha 1\nLinha 2\n\nBloco <2> & co", "Frequência 75%", env.teacher.ID, env.teacher.ID).Error)
	require.NoError(t, conn.Exec(insert, html, env.teacher.ID, "A2", "<p>Já é HTML</p>", "", env.teacher.ID, env.teacher.ID).Error)
	require.NoError(t, conn.Exec(insert, empty, env.teacher.ID, "A3", nil, nil, env.teacher.ID, env.teacher.ID).Error)

	require.NoError(t, conn.Exec(migration00025Conversion(t)).Error)

	read := func(id uuid.UUID) (string, string) {
		var row struct {
			Syllabus                *string
			InstitutionalGuidelines *string
		}
		require.NoError(t, conn.Raw("SELECT syllabus, institutional_guidelines FROM classes WHERE id = ?", id).Scan(&row).Error)
		deref := func(s *string) string {
			if s == nil {
				return ""
			}
			return *s
		}
		return deref(row.Syllabus), deref(row.InstitutionalGuidelines)
	}
	s, g := read(plain)
	assert.Equal(t, "<p>Linha 1<br>Linha 2</p><p>Bloco &lt;2&gt; &amp; co</p>", s)
	assert.Equal(t, "<p>Frequência 75%</p>", g)
	s, g = read(html)
	assert.Equal(t, "<p>Já é HTML</p>", s)
	assert.Equal(t, "", g)
	s, g = read(empty)
	assert.Equal(t, "", s)
	assert.Equal(t, "", g)
}

// migration00025Conversion is the conversion statement of migration 00025, run again over rows written as plain text.
func migration00025Conversion(t *testing.T) string {
	t.Helper()
	entries, err := migrations.FS.ReadDir(".")
	require.NoError(t, err)
	var text string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "00025_") {
			raw, err := migrations.FS.ReadFile(e.Name())
			require.NoError(t, err)
			text = string(raw)
		}
	}
	start := strings.Index(text, "UPDATE classes SET")
	end := strings.Index(text, "-- +goose Down")
	require.True(t, start > 0 && end > start, "migration 00025 has the conversion statement")
	return text[start:end]
}
