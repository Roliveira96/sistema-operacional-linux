package service_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/mcptest"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/service"
)

func studentsSetup(t *testing.T, limited bool) (*env, *mcptest.Students, *mcptest.Enrollments) {
	t.Helper()
	e := setup(t, limited)
	st, en := mcptest.NewStudents(), mcptest.NewEnrollments()
	e.svc.WithStudents(st, en)
	return e, st, en
}

func ten() []service.StudentInput {
	out := make([]service.StudentInput, 10)
	for i := range out {
		out[i] = service.StudentInput{AcademicID: fmt.Sprintf("a20260%02d", i+1), Email: fmt.Sprintf("aluno%02d@teste.local", i+1), Name: fmt.Sprintf("Aluno Teste %02d", i+1)}
	}
	return out
}

// Covers SPEC-045 CA-02: the agent creates a batch of students.
func TestCreateStudents(t *testing.T) {
	e, st, _ := studentsSetup(t, false)
	res, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{Students: ten()})
	require.Nil(t, terr)
	assert.Len(t, res.Created, 10)
	assert.Empty(t, res.Rejected)
	assert.Nil(t, res.Enrollment, "no class, no enrollment")
	assert.Len(t, st.Registered, 10)
	assert.Equal(t, "2026001", res.Created[0].AcademicID, "the academic id comes normalized by the service")
	assert.Equal(t, "aluno01@teste.local", res.Created[0].Email)
	assert.NotEqual(t, uuid.Nil, res.Created[0].StudentID)
}

// Covers SPEC-045 CA-03: with a class, the created students are enrolled.
func TestCreateStudentsEnrollsInTheClass(t *testing.T) {
	e, _, en := studentsSetup(t, false)
	class := en.AddClass(e.teacher.UserID)
	res, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{ClassID: class.String(), Students: ten()})
	require.Nil(t, terr)
	require.NotNil(t, res.Enrollment)
	assert.Equal(t, class, res.Enrollment.ClassID)
	assert.Equal(t, 10, res.Enrollment.Enrolled)
	assert.Equal(t, 0, res.Enrollment.AlreadyEnrolled)
	assert.Nil(t, res.Enrollment.Error)
	assert.Len(t, en.Enrolled[class], 10)

	// ADMIN enrolls in a class of any teacher.
	res, terr = e.svc.CreateStudents(context.Background(), e.admin, service.CreateStudentsInput{ClassID: class.String(), Students: []service.StudentInput{{AcademicID: "2026999", Email: "extra@teste.local"}}})
	require.Nil(t, terr)
	assert.Equal(t, 1, res.Enrollment.Enrolled)
}

// Covers SPEC-045 CA-04 and RN-03: a refused item does not stop the others.
func TestCreateStudentsRejectsItemsOnTheirOwn(t *testing.T) {
	e, _, _ := studentsSetup(t, false)
	_, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{Students: []service.StudentInput{{AcademicID: "2026001", Email: "taken@teste.local"}}})
	require.Nil(t, terr)

	res, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{Students: []service.StudentInput{
		{AcademicID: "2026002", Email: "ok@teste.local"},
		{AcademicID: "123", Email: "short@teste.local"},
		{AcademicID: "2026003", Email: "not-an-email"},
		{AcademicID: "2026004", Email: "taken@teste.local"},
		{AcademicID: "a2026001", Email: "other@teste.local"},
	}})
	require.Nil(t, terr)
	require.Len(t, res.Created, 1)
	assert.Equal(t, "ok@teste.local", res.Created[0].Email)
	require.Len(t, res.Rejected, 4)
	got := map[int]string{}
	for _, r := range res.Rejected {
		got[r.Index] = r.Type
		assert.NotEmpty(t, r.Detail)
	}
	assert.Equal(t, map[int]string{1: "invalid-academic-id", 2: "invalid-email", 3: "email-already-registered", 4: "academic-id-already-registered"}, got)
	assert.Equal(t, "123", res.Rejected[0].AcademicID, "the value received is shown")
}

// Covers SPEC-045 CA-05 and RN-01: a bad batch or class id creates nobody.
func TestCreateStudentsValidatesTheRequest(t *testing.T) {
	e, st, en := studentsSetup(t, false)
	ctx := context.Background()
	_, terr := e.svc.CreateStudents(ctx, e.teacher, service.CreateStudentsInput{})
	assert.Equal(t, "students", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)

	many := make([]service.StudentInput, 51)
	for i := range many {
		many[i] = service.StudentInput{AcademicID: fmt.Sprintf("%07d", i), Email: fmt.Sprintf("m%d@teste.local", i)}
	}
	_, terr = e.svc.CreateStudents(ctx, e.teacher, service.CreateStudentsInput{Students: many})
	assert.Equal(t, "students", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)

	_, terr = e.svc.CreateStudents(ctx, e.teacher, service.CreateStudentsInput{ClassID: "not-a-uuid", Students: ten()})
	assert.Equal(t, "classId", requireErr(t, terr, domain.TypeValidation).Fields[0].Field)

	assert.Empty(t, st.Registered, "nobody was created")
	assert.Empty(t, en.Enrolled)
}

// Covers SPEC-045 CA-06 and RN-04: a refused enrollment keeps the students and says why.
func TestCreateStudentsKeepsThemWhenTheEnrollmentIsRefused(t *testing.T) {
	e, st, en := studentsSetup(t, false)
	ctx := context.Background()
	foreign := en.AddClass(e.other.UserID)
	archived := en.AddClass(e.teacher.UserID)
	en.Classes[archived] = mcptest.Class{TeacherID: e.teacher.UserID, Archived: true}

	cases := map[string]string{foreign.String(): "forbidden", archived.String(): "class-archived", uuid.NewString(): "class-not-found"}
	i := 0
	for class, want := range cases {
		i++
		res, terr := e.svc.CreateStudents(ctx, e.teacher, service.CreateStudentsInput{ClassID: class, Students: []service.StudentInput{
			{AcademicID: fmt.Sprintf("20260%02d", i), Email: fmt.Sprintf("r%d@teste.local", i)},
		}})
		require.Nil(t, terr, want)
		assert.Len(t, res.Created, 1, "the student stays created")
		require.NotNil(t, res.Enrollment)
		require.NotNil(t, res.Enrollment.Error, want)
		assert.Equal(t, want, res.Enrollment.Error.Type)
		assert.Equal(t, 0, res.Enrollment.Enrolled)
	}
	assert.Len(t, st.Registered, 3)
}

// Covers SPEC-045 CA-07 and RN-05: the write rate limit applies.
func TestCreateStudentsIsRateLimited(t *testing.T) {
	e, st, _ := studentsSetup(t, true)
	e.f.Deny = true
	_, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{Students: ten()})
	requireErr(t, terr, domain.TypeRateLimited)
	assert.Empty(t, st.Registered)
}

// Covers SPEC-045 CA-08 and RN-05: the log has counts and ids, never the personal data of a student.
func TestCreateStudentsLogsWithoutPersonalData(t *testing.T) {
	e, _, en := studentsSetup(t, false)
	class := en.AddClass(e.teacher.UserID)
	_, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{ClassID: class.String(), Students: []service.StudentInput{
		{AcademicID: "2026777", Email: "secret.person@teste.local", Name: "Pessoa Secreta"},
		{AcademicID: "bad", Email: "worse@teste.local"},
	}})
	require.Nil(t, terr)
	entries := e.logs.FilterMessage("mcp write").All()
	require.Len(t, entries, 1)
	fields := entries[0].ContextMap()
	assert.Equal(t, domain.ToolCreateStudents, fields["tool"])
	assert.Equal(t, e.teacher.UserID.String(), fields["userId"])
	assert.Equal(t, class.String(), fields["classId"])
	assert.EqualValues(t, 1, fields["created"])
	assert.EqualValues(t, 1, fields["rejected"])
	for _, entry := range e.logs.All() {
		text := entry.Message + fmt.Sprint(entry.ContextMap())
		for _, secret := range []string{"2026777", "secret.person", "Pessoa Secreta", "worse@"} {
			assert.NotContains(t, text, secret)
		}
	}
}

func TestCreateStudentsNeedsTheStudentsPort(t *testing.T) {
	e := setup(t, false)
	_, terr := e.svc.CreateStudents(context.Background(), e.teacher, service.CreateStudentsInput{Students: ten()})
	requireErr(t, terr, domain.TypeInternal)
}
