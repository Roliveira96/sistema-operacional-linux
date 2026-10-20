package handler_test

import (
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sorted(keys ...string) []string {
	sort.Strings(keys)
	return keys
}

func calendarAssessment(withOptionals bool) service.CalendarAssessment {
	brt := time.FixedZone("BRT", -3*3600)
	a := service.CalendarAssessment{
		ID: uuid.New(), ClassID: uuid.New(), Title: "Prova 1", Description: "Leia com atenção.", Type: "EXAM", Status: "SCHEDULED", Phase: "UPCOMING",
		StartsAt: time.Date(2026, 10, 21, 9, 0, 0, 0, brt), EndsAt: time.Date(2026, 10, 21, 11, 0, 0, 0, brt), MaxScore: 10,
	}
	if withOptionals {
		session, minutes, reason := uuid.New(), 60, "Falta de energia"
		a.ClassSessionID, a.DurationMinutes, a.CancelReason, a.Status = &session, &minutes, &reason, "CANCELED"
	}
	return a
}

// The keys of an assessment in the calendar: the public form of SPEC-075 section 5.1, without the clock of the server (the calendar is not the
// place to count down).
var calendarRequired = []string{"id", "classId", "title", "description", "type", "status", "phase", "startsAt", "endsAt", "maxScore"}

// Covers SPEC-075 CA-09, CA-19 (RN-09, RN-17): the calendar answers an `assessments` list, always present, whose items have exactly the public keys
// (the optional ones only when they have a value), with the dates in ISO 8601 with the offset.
func TestCalendarRoute_AssessmentsHaveOnlyThePublicKeys(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	path := "/api/v1/classes/" + uuid.NewString() + "/calendar?from=2026-10-01&to=2026-10-31"

	_, body := call(t, srv, http.MethodGet, path, nil)
	list, ok := body["assessments"].([]any)
	require.True(t, ok, "assessments is always in the answer, even with none")
	assert.Empty(t, list)

	svc.calendar = service.Calendar{Assessments: []service.CalendarAssessment{calendarAssessment(true), calendarAssessment(false)}}
	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	list, ok = body["assessments"].([]any)
	require.True(t, ok)
	require.Len(t, list, 2)

	full, ok := list[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, sorted(append([]string{"classSessionId", "durationMinutes", "cancelReason"}, calendarRequired...)...), keysOf(full))
	assert.Equal(t, "2026-10-21T09:00:00-03:00", full["startsAt"])
	assert.Equal(t, "2026-10-21T11:00:00-03:00", full["endsAt"])
	assert.EqualValues(t, 10, full["maxScore"])
	assert.Equal(t, "Falta de energia", full["cancelReason"])

	minimal, ok := list[1].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, sorted(calendarRequired...), keysOf(minimal))
	for _, secret := range []string{"teacherPrivateNotes", "items", "drawRules", "students", "moduleId", "totalQuestions", "eligibleStudents", "composition"} {
		assert.NotContains(t, minimal, secret)
		assert.NotContains(t, full, secret)
	}
}

// Covers SPEC-075 CA-19 (RN-17): for the teacher the calendar item also says how many students are eligible and how the questions were chosen.
func TestCalendarRoute_TeacherGetsTheCountAndTheComposition(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	a := calendarAssessment(false)
	eligible, composition := 24, "DRAW"
	a.EligibleStudents, a.Composition = &eligible, &composition
	svc.calendar = service.Calendar{Assessments: []service.CalendarAssessment{a}}

	status, body := call(t, srv, http.MethodGet, "/api/v1/me/calendar?from=2026-10-01&to=2026-10-31", nil)
	require.Equal(t, http.StatusOK, status)
	list, ok := body["assessments"].([]any)
	require.True(t, ok)
	require.Len(t, list, 1)
	item, ok := list[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, sorted(append([]string{"eligibleStudents", "composition"}, calendarRequired...)...), keysOf(item))
	assert.EqualValues(t, 24, item["eligibleStudents"])
	assert.Equal(t, "DRAW", item["composition"])
}
