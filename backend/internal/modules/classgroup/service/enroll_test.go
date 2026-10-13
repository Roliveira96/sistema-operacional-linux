package service_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

func (f *fakeClassRepo) FindUserRoles(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := make(map[uuid.UUID]string)
	for _, id := range ids {
		if role, ok := f.userRoles[id]; ok {
			out[id] = role
		}
	}
	return out, nil
}

func (f *fakeClassRepo) ListEnrollmentsByUsers(ctx context.Context, classID uuid.UUID, userIDs []uuid.UUID) ([]domain.Enrollment, error) {
	var out []domain.Enrollment
	for _, e := range f.enrollments {
		for _, id := range userIDs {
			if e.ClassID == classID && e.UserID == id {
				out = append(out, e)
			}
		}
	}
	return out, nil
}

func (f *fakeClassRepo) SaveEnrollments(ctx context.Context, created, updated []domain.Enrollment) error {
	f.saveCalls++
	for _, e := range created {
		if e.ID == uuid.Nil {
			e.ID = uuid.New()
		}
		f.enrollments[e.ID] = e
	}
	for _, e := range updated {
		f.enrollments[e.ID] = e
	}
	return nil
}

func (f *fakeClassRepo) FindUserName(ctx context.Context, id uuid.UUID) (*string, error) {
	return f.userNames[id], nil
}

type enrollFixture struct {
	repo    *fakeClassRepo
	svc     *service.Service
	teacher uuid.UUID
	class   domain.ClassGroup
	now     time.Time
}

func newEnrollFixture(status domain.ClassStatus) enrollFixture {
	repo := newFakeRepo()
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	teacher := uuid.New()
	class := domain.ClassGroup{
		Model:     database.Model{ID: uuid.New()},
		TeacherID: teacher,
		Name:      "Sistemas Operacionais",
		Status:    status,
	}
	repo.classes[class.ID] = class
	return enrollFixture{repo: repo, svc: service.New(repo).WithNow(func() time.Time { return now }), teacher: teacher, class: class, now: now}
}

func (f enrollFixture) student() uuid.UUID {
	id := uuid.New()
	f.repo.userRoles[id] = authn.RoleStudent
	return id
}

func (f enrollFixture) enrollment(userID uuid.UUID, status domain.EnrollmentStatus) {
	id := uuid.New()
	f.repo.enrollments[id] = domain.Enrollment{
		Model: database.Model{ID: id}, ClassID: f.class.ID, UserID: userID,
		Status: status, Origin: domain.OriginInviteLink, RequestedAt: f.now.Add(-time.Hour),
	}
}

func (f enrollFixture) statusOf(userID uuid.UUID) (domain.Enrollment, bool) {
	for _, e := range f.repo.enrollments {
		if e.ClassID == f.class.ID && e.UserID == userID {
			return e, true
		}
	}
	return domain.Enrollment{}, false
}

// Covers SPEC-041 RN-05 and CA-03: a student without enrollment becomes ACTIVE, DIRECT_BY_TEACHER, decided now.
func TestEnrollStudents_CreatesActiveDirectByTeacher(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	s := f.student()

	res, err := f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, f.class.ID, []uuid.UUID{s})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{s}, res.Enrolled)
	assert.Empty(t, res.AlreadyEnrolled)
	assert.Empty(t, res.Rejected)

	e, ok := f.statusOf(s)
	require.True(t, ok)
	assert.Equal(t, domain.EnrollmentActive, e.Status)
	assert.Equal(t, domain.OriginDirectByTeacher, e.Origin)
	require.NotNil(t, e.DecidedAt)
	assert.Equal(t, f.now, *e.DecidedAt)
	assert.Equal(t, 1, f.repo.saveCalls, "the batch is written once (RN-06)")
}

// Covers SPEC-041 RN-05, D-10 and CA-03: pending, rejected and unenrolled students become ACTIVE.
func TestEnrollStudents_PromotesPendingAndReactivatesRejectedOrUnenrolled(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	pending, rejected, unenrolled := f.student(), f.student(), f.student()
	f.enrollment(pending, domain.EnrollmentPendingModeration)
	f.enrollment(rejected, domain.EnrollmentRejected)
	f.enrollment(unenrolled, domain.EnrollmentUnenrolled)

	res, err := f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, f.class.ID, []uuid.UUID{pending, rejected, unenrolled})
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{pending, rejected, unenrolled}, res.Enrolled)
	for _, id := range []uuid.UUID{pending, rejected, unenrolled} {
		e, _ := f.statusOf(id)
		assert.Equal(t, domain.EnrollmentActive, e.Status)
		assert.Equal(t, domain.OriginDirectByTeacher, e.Origin)
		assert.Nil(t, e.RejectionReason)
		require.NotNil(t, e.DecidedAt)
	}
}

// Covers SPEC-041 RN-05 and CA-03: active students are reported as already enrolled; transferred students and
// users that are not students are rejected with their reason, and nothing changes for them.
func TestEnrollStudents_ReportsAlreadyEnrolledAndRejectedReasons(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	active, transferred := f.student(), f.student()
	f.enrollment(active, domain.EnrollmentActive)
	f.enrollment(transferred, domain.EnrollmentTransferred)
	teacherUser := uuid.New()
	f.repo.userRoles[teacherUser] = authn.RoleTeacher
	missing := uuid.New()

	res, err := f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, f.class.ID,
		[]uuid.UUID{active, transferred, teacherUser, missing})
	require.NoError(t, err)
	assert.Empty(t, res.Enrolled)
	assert.Equal(t, []uuid.UUID{active}, res.AlreadyEnrolled)
	assert.ElementsMatch(t, []service.RejectedStudent{
		{StudentID: transferred, Reason: domain.RejectReasonTransferred},
		{StudentID: teacherUser, Reason: domain.RejectReasonNotAStudent},
		{StudentID: missing, Reason: domain.RejectReasonNotAStudent},
	}, res.Rejected)
	e, _ := f.statusOf(transferred)
	assert.Equal(t, domain.EnrollmentTransferred, e.Status)
	_, created := f.statusOf(teacherUser)
	assert.False(t, created)
}

// Covers SPEC-041 RN-05 and CA-07: repeated ids count once.
func TestEnrollStudents_DeduplicatesIds(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	s := f.student()

	res, err := f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, f.class.ID, []uuid.UUID{s, s, s})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{s}, res.Enrolled)
	count := 0
	for _, e := range f.repo.enrollments {
		if e.UserID == s {
			count++
		}
	}
	assert.Equal(t, 1, count)
}

// Covers SPEC-041 RN-03 and CA-05: only the owner teacher or an admin enrolls.
func TestEnrollStudents_RefusesNonOwner(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	s := f.student()

	_, err := f.svc.EnrollStudents(context.Background(), uuid.New(), authn.RoleTeacher, f.class.ID, []uuid.UUID{s})
	require.ErrorIs(t, err, domain.ErrForbidden)
	_, created := f.statusOf(s)
	assert.False(t, created)

	res, err := f.svc.EnrollStudents(context.Background(), uuid.New(), authn.RoleAdmin, f.class.ID, []uuid.UUID{s})
	require.NoError(t, err)
	assert.Equal(t, []uuid.UUID{s}, res.Enrolled)
}

// Covers SPEC-041 RN-04, D-06 and CA-06: an archived class refuses, a draft class accepts.
func TestEnrollStudents_RefusesArchivedClass(t *testing.T) {
	archived := newEnrollFixture(domain.ClassStatusArchived)
	_, err := archived.svc.EnrollStudents(context.Background(), archived.teacher, authn.RoleTeacher, archived.class.ID, []uuid.UUID{archived.student()})
	require.ErrorIs(t, err, domain.ErrClassArchived)

	draft := newEnrollFixture(domain.ClassStatusDraft)
	res, err := draft.svc.EnrollStudents(context.Background(), draft.teacher, authn.RoleTeacher, draft.class.ID, []uuid.UUID{draft.student()})
	require.NoError(t, err)
	assert.Len(t, res.Enrolled, 1)
}

// Covers SPEC-041 section 5.1: the batch has from 1 to 200 ids, and an unknown class is not found.
func TestEnrollStudents_ValidatesBatchSizeAndClass(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	_, err := f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, f.class.ID, nil)
	require.ErrorIs(t, err, domain.ErrInvalidEnrollmentBatch)

	tooMany := make([]uuid.UUID, domain.MaxEnrollmentBatch+1)
	for i := range tooMany {
		tooMany[i] = uuid.New()
	}
	_, err = f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, f.class.ID, tooMany)
	require.ErrorIs(t, err, domain.ErrInvalidEnrollmentBatch)

	_, err = f.svc.EnrollStudents(context.Background(), f.teacher, authn.RoleTeacher, uuid.New(), []uuid.UUID{f.student()})
	require.ErrorIs(t, err, domain.ErrClassNotFound)
}

func validCreateInput() service.CreateClassInput {
	start := time.Date(2026, 8, 1, 3, 0, 0, 0, time.UTC)
	return service.CreateClassInput{
		Name: "Sistemas Operacionais", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: start, EndDate: start.Add(120 * 24 * time.Hour),
	}
}

// Covers SPEC-041 RN-01 and CA-10: the summary is trimmed on create and limited to 300 characters.
func TestCreateClass_ValidatesSummaryLength(t *testing.T) {
	svc := service.New(newFakeRepo())
	in := validCreateInput()
	in.Summary = "  Linux na prática.  "
	class, err := svc.CreateClass(context.Background(), uuid.New(), in)
	require.NoError(t, err)
	assert.Equal(t, "Linux na prática.", class.Summary)

	in = validCreateInput()
	in.Summary = strings.Repeat("a", domain.SummaryMaxLength+1)
	_, err = svc.CreateClass(context.Background(), uuid.New(), in)
	require.ErrorIs(t, err, domain.ErrSummaryTooLong)
}

// Covers SPEC-041 RN-01 and CA-10: the summary can be changed and is limited on update too.
func TestUpdateClass_ValidatesSummaryLength(t *testing.T) {
	repo := newFakeRepo()
	svc := service.New(repo)
	teacher := uuid.New()
	class, err := svc.CreateClass(context.Background(), teacher, validCreateInput())
	require.NoError(t, err)

	summary := " Novo resumo "
	updated, err := svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{Summary: &summary})
	require.NoError(t, err)
	assert.Equal(t, "Novo resumo", updated.Summary)

	tooLong := strings.Repeat("a", domain.SummaryMaxLength+1)
	_, err = svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{Summary: &tooLong})
	require.ErrorIs(t, err, domain.ErrSummaryTooLong)
}

// Covers SPEC-041 RN-02 and CA-11: the syllabus and the guidelines are filtered on create and update, without scripts,
// event attributes or images, and are limited to 20,000 characters after the filter.
func TestCreateClass_SanitizesSyllabusAndGuidelines(t *testing.T) {
	repo := newFakeRepo()
	svc := service.New(repo)
	teacher := uuid.New()
	in := validCreateInput()
	in.Syllabus = `<p onclick="x()">Processos</p><script>alert(1)</script><img src="https://x.com/a.png">`
	in.InstitutionalGuidelines = `<p>Frequência <strong>75%</strong></p><iframe src="https://www.youtube.com/embed/a"></iframe>`
	class, err := svc.CreateClass(context.Background(), teacher, in)
	require.NoError(t, err)
	assert.Equal(t, `<p>Processos</p>`, class.Syllabus)
	assert.Equal(t, `<p>Frequência <strong>75%</strong></p>`, class.InstitutionalGuidelines)

	dirty := `<p>Threads</p><script>x</script>`
	updated, err := svc.UpdateClass(context.Background(), teacher, class.ID, service.UpdateClassInput{Syllabus: &dirty, InstitutionalGuidelines: &dirty})
	require.NoError(t, err)
	assert.Equal(t, `<p>Threads</p>`, updated.Syllabus)
	assert.Equal(t, `<p>Threads</p>`, updated.InstitutionalGuidelines)

	in = validCreateInput()
	in.CourseCode = "SO35E"
	in.Syllabus = "<p>" + strings.Repeat("a", domain.RichTextMaxLength) + "</p>"
	_, err = svc.CreateClass(context.Background(), teacher, in)
	require.ErrorIs(t, err, domain.ErrContentTooLong)
}

// Covers SPEC-041 RN-08, CA-13 and CA-14: only a student with an ACTIVE enrollment reads the class, archived included.
func TestGetMyClass_ActiveEnrollmentOnly(t *testing.T) {
	f := newEnrollFixture(domain.ClassStatusActive)
	active, pending := f.student(), f.student()
	f.enrollment(active, domain.EnrollmentActive)
	f.enrollment(pending, domain.EnrollmentPendingModeration)
	name := "Profa. Sediane"
	f.repo.userNames[f.teacher] = &name

	view, err := f.svc.GetMyClass(context.Background(), active, f.class.ID)
	require.NoError(t, err)
	assert.Equal(t, f.class.ID, view.Class.ID)
	require.NotNil(t, view.TeacherName)
	assert.Equal(t, name, *view.TeacherName)

	_, err = f.svc.GetMyClass(context.Background(), pending, f.class.ID)
	require.ErrorIs(t, err, domain.ErrClassNotFound)
	_, err = f.svc.GetMyClass(context.Background(), f.student(), f.class.ID)
	require.ErrorIs(t, err, domain.ErrClassNotFound)
	_, err = f.svc.GetMyClass(context.Background(), active, uuid.New())
	require.ErrorIs(t, err, domain.ErrClassNotFound)

	archived := f.repo.classes[f.class.ID]
	archived.Status = domain.ClassStatusArchived
	f.repo.classes[f.class.ID] = archived
	_, err = f.svc.GetMyClass(context.Background(), active, f.class.ID)
	require.NoError(t, err)
}
