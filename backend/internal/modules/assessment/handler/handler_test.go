package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/handler"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/server"
)

func at(day, hour, minute int) time.Time {
	return time.Date(2026, 10, day, hour, minute, 0, 0, domain.Location())
}

func ptr[T any](v T) *T { return &v }

type fakeValidator struct{ principal authn.Principal }

func (f *fakeValidator) Authenticate(context.Context, string) (authn.Principal, error) {
	return f.principal, nil
}

// fakeService records which methods were called and with what, and answers what the test configured.
type fakeService struct {
	err   error
	calls []string
	actor service.Actor

	classID, id uuid.UUID
	questionID  uuid.UUID
	scenario    json.RawMessage
	create      service.CreateInput
	update      service.UpdateInput
	reschedule  service.RescheduleInput
	reason      string
	notes       string
	list        service.ListFilter
	questions   service.QuestionFilter

	now     time.Time
	summary service.Summary
	public  service.Public
	detail  service.Detail
	preview service.Preview
	page    service.QuestionPage
	listed  []service.Summary
	listedP []service.Public

	// SPEC-076
	clearances  service.ClearanceList
	clearanceIn service.ClearanceInput
	access      service.MyAccess
}

func (f *fakeService) saw(call string, a service.Actor) { f.calls, f.actor = append(f.calls, call), a }

func (f *fakeService) Now() time.Time { return f.now }

func (f *fakeService) Create(_ context.Context, a service.Actor, classID uuid.UUID, in service.CreateInput) (service.Summary, error) {
	f.saw("Create", a)
	f.classID, f.create = classID, in
	return f.summary, f.err
}

func (f *fakeService) Update(_ context.Context, a service.Actor, classID, id uuid.UUID, in service.UpdateInput) (service.Summary, error) {
	f.saw("Update", a)
	f.classID, f.id, f.update = classID, id, in
	return f.summary, f.err
}

func (f *fakeService) Reschedule(_ context.Context, a service.Actor, classID, id uuid.UUID, in service.RescheduleInput) (service.Summary, error) {
	f.saw("Reschedule", a)
	f.classID, f.id, f.reschedule = classID, id, in
	return f.summary, f.err
}

func (f *fakeService) Cancel(_ context.Context, a service.Actor, classID, id uuid.UUID, reason string) (service.Summary, error) {
	f.saw("Cancel", a)
	f.classID, f.id, f.reason = classID, id, reason
	return f.summary, f.err
}

func (f *fakeService) Start(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.Summary, error) {
	f.saw("Start", a)
	f.classID, f.id = classID, id
	return f.summary, f.err
}

func (f *fakeService) QuestionScenario(_ context.Context, a service.Actor, classID, id, questionID uuid.UUID) (json.RawMessage, error) {
	f.saw("QuestionScenario", a)
	f.classID, f.id, f.questionID = classID, id, questionID
	return f.scenario, f.err
}

func (f *fakeService) SaveNotes(_ context.Context, a service.Actor, classID, id uuid.UUID, notes string) (string, error) {
	f.saw("SaveNotes", a)
	f.classID, f.id, f.notes = classID, id, notes
	return notes, f.err
}

func (f *fakeService) Detail(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.Detail, error) {
	f.saw("Detail", a)
	f.classID, f.id = classID, id
	return f.detail, f.err
}

func (f *fakeService) Public(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.Public, error) {
	f.saw("Public", a)
	f.classID, f.id = classID, id
	return f.public, f.err
}

func (f *fakeService) List(_ context.Context, a service.Actor, classID uuid.UUID, filter service.ListFilter) ([]service.Summary, error) {
	f.saw("List", a)
	f.classID, f.list = classID, filter
	return f.listed, f.err
}

func (f *fakeService) ListPublic(_ context.Context, a service.Actor, classID uuid.UUID, filter service.ListFilter) ([]service.Public, error) {
	f.saw("ListPublic", a)
	f.classID, f.list = classID, filter
	return f.listedP, f.err
}

func (f *fakeService) Preview(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.Preview, error) {
	f.saw("Preview", a)
	f.classID, f.id = classID, id
	return f.preview, f.err
}

func (f *fakeService) EligibleQuestions(_ context.Context, a service.Actor, classID uuid.UUID, filter service.QuestionFilter) (service.QuestionPage, error) {
	f.saw("EligibleQuestions", a)
	f.classID, f.questions = classID, filter
	return f.page, f.err
}

func (f *fakeService) Clearances(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.ClearanceList, error) {
	f.saw("Clearances", a)
	f.classID, f.id = classID, id
	return f.clearances, f.err
}

func (f *fakeService) Decide(_ context.Context, a service.Actor, classID, id uuid.UUID, in service.ClearanceInput) (service.ClearanceList, error) {
	f.saw("Decide", a)
	f.classID, f.id, f.clearanceIn = classID, id, in
	return f.clearances, f.err
}

func (f *fakeService) MyAccess(_ context.Context, a service.Actor, classID, id uuid.UUID) (service.MyAccess, error) {
	f.saw("MyAccess", a)
	f.classID, f.id = classID, id
	return f.access, f.err
}

func setup(role string) (*httptest.Server, *fakeService, uuid.UUID) {
	userID := uuid.New()
	svc := &fakeService{now: at(20, 8, 0)}
	h := handler.New(svc, &fakeValidator{principal: authn.Principal{UserID: userID, Role: role}})
	return httptest.NewServer(server.NewEngine(zap.NewNop(), nil, h)), svc, userID
}

// call sends a request with a session cookie and returns the status and the JSON object of the answer.
func call(t *testing.T, srv *httptest.Server, method, path string, body any) (int, map[string]any) {
	t.Helper()
	return send(t, srv, method, path, body, true)
}

func send(t *testing.T, srv *httptest.Server, method, path string, body any, withSession bool) (int, map[string]any) {
	t.Helper()
	var raw []byte
	switch b := body.(type) {
	case nil:
	case string:
		raw = []byte(b)
	default:
		var err error
		raw, err = json.Marshal(b)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, srv.URL+path, bytes.NewReader(raw))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	if withSession {
		req.AddCookie(&http.Cookie{Name: authn.CookieName, Value: "session"})
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(data) > 0 {
		_ = json.Unmarshal(data, &out)
	}
	return res.StatusCode, out
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func array(t *testing.T, v any) []any {
	t.Helper()
	list, ok := v.([]any)
	require.True(t, ok, "expected a list, got %T", v)
	return list
}

func object(t *testing.T, v any) map[string]any {
	t.Helper()
	m, ok := v.(map[string]any)
	require.True(t, ok, "expected an object, got %T", v)
	return m
}

func sorted(keys ...string) []string {
	sort.Strings(keys)
	return keys
}

// The only keys the student may ever receive for an assessment (SPEC-075 section 5.1, RN-09).
var (
	publicRequired = []string{"id", "classId", "title", "description", "type", "status", "phase", "startsAt", "endsAt", "maxScore", "serverNow"}
	publicOptional = []string{"classSessionId", "durationMinutes", "cancelReason"}
)

func fullPublic() service.Public {
	return service.Public{
		ID: uuid.New(), ClassID: uuid.New(), ClassSessionID: ptr(uuid.New()), Title: "Prova 1", Description: "Leia com atenção.",
		Type: domain.TypeExam, Status: domain.StatusCanceled, Phase: domain.PhaseUpcoming,
		StartsAt: at(21, 9, 0), EndsAt: at(21, 11, 0), DurationMinutes: ptr(60), MaxScore: domain.Points(10), CancelReason: ptr("Falta de energia"),
	}
}

func minimalPublic() service.Public {
	p := fullPublic()
	p.ClassSessionID, p.DurationMinutes, p.CancelReason = nil, nil, nil
	p.Status = domain.StatusScheduled
	return p
}

func classPath(classID uuid.UUID) string { return "/api/v1/classes/" + classID.String() }

func assessmentPath(classID, id uuid.UUID) string {
	return classPath(classID) + "/assessments/" + id.String()
}

// ---- RN-09: what the student receives ----

// Covers SPEC-075 CA-08, CA-09, CA-10 (RN-09): the student gets the public form and nothing else, with exactly its keys; the handler never asks the
// service for the teacher's detail on behalf of a student.
func TestHandler_StudentResponseHasExactlyThePublicKeys(t *testing.T) {
	srv, svc, userID := setup(authn.RoleStudent)
	defer srv.Close()
	classID := uuid.New()

	svc.public = fullPublic()
	status, body := call(t, srv, http.MethodGet, assessmentPath(classID, svc.public.ID), nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, sorted(append(append([]string{}, publicRequired...), publicOptional...)...), keysOf(body))
	assert.Equal(t, []string{"Public"}, svc.calls, "a student gets the public form, never the detail")
	assert.Equal(t, authn.RoleStudent, svc.actor.Role)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)

	assert.EqualValues(t, 10, body["maxScore"], "the score is a number")
	assert.Equal(t, "2026-10-21T09:00:00-03:00", body["startsAt"], "dates in ISO 8601 with the offset of Brasília")
	assert.Equal(t, "2026-10-21T11:00:00-03:00", body["endsAt"])
	assert.Equal(t, "2026-10-20T08:00:00-03:00", body["serverNow"], "the clock of the server, for the countdown")
	assert.Equal(t, "CANCELED", body["status"])
	assert.Equal(t, "Falta de energia", body["cancelReason"])
	assert.EqualValues(t, 60, body["durationMinutes"])

	svc.public = minimalPublic()
	_, body = call(t, srv, http.MethodGet, assessmentPath(classID, svc.public.ID), nil)
	assert.Equal(t, sorted(publicRequired...), keysOf(body), "the optional fields are left out when they have no value")
	for _, secret := range []string{"teacherPrivateNotes", "items", "drawRules", "students", "events", "moduleId", "composition", "audience", "totalQuestions", "eligibleStudents"} {
		assert.NotContains(t, body, secret)
	}
}

// Covers SPEC-075 CA-09 (RN-09): in the list the items have the public keys, and the clock of the server is said once, outside them.
func TestHandler_ListForStudentHasExactlyThePublicKeys(t *testing.T) {
	srv, svc, _ := setup(authn.RoleStudent)
	defer srv.Close()
	svc.listedP = []service.Public{fullPublic(), minimalPublic()}

	status, body := call(t, srv, http.MethodGet, classPath(uuid.New())+"/assessments", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, []string{"ListPublic"}, svc.calls)
	assert.Equal(t, "2026-10-20T08:00:00-03:00", body["serverNow"])
	items := array(t, body["items"])
	require.Len(t, items, 2)
	withoutClock := func(keys []string) []string {
		out := []string{}
		for _, k := range keys {
			if k != "serverNow" {
				out = append(out, k)
			}
		}
		return sorted(out...)
	}
	assert.Equal(t, withoutClock(append(append([]string{}, publicRequired...), publicOptional...)), keysOf(object(t, items[0])))
	assert.Equal(t, withoutClock(publicRequired), keysOf(object(t, items[1])))
}

// Covers SPEC-075 CA-10, CA-18 (RN-13, RN-15): the teacher and the administrator get the summary and the detail, with the private notes, the
// names of who changed it, the composition and the history.
func TestHandler_TeacherGetsTheDetailWithTheSecretsTheStudentNeverGets(t *testing.T) {
	for _, role := range []string{authn.RoleTeacher, authn.RoleAdmin} {
		srv, svc, _ := setup(role)
		classID, moduleID, questionID := uuid.New(), uuid.New(), uuid.New()
		svc.detail = service.Detail{
			Summary: service.Summary{
				Public: fullPublic(), ModuleID: moduleID, ModuleTitle: "Permissões", Composition: domain.CompositionManual,
				Audience: domain.AudienceSelected, EligibleStudents: 2, TotalQuestions: 1, Frozen: true,
				TeacherPrivateNotes: ptr("Atenção na questão 3"), CreatedBy: uuid.New(), CreatedByName: "Profa. Sediane",
				UpdatedBy: uuid.New(), UpdatedByName: "Profa. Sediane", UpdatedAt: at(20, 8, 0),
			},
			Items:    []service.ItemView{{Item: domain.Item{QuestionID: questionID, Position: 1, Weight: domain.Points(10)}, Title: "Q1", Kind: "PRACTICAL", Difficulty: domain.DifficultyEasy}},
			Rules:    []domain.DrawRule{{Difficulty: domain.DifficultyHard, Quantity: 2, Points: domain.Points(2.5)}},
			Students: []service.Student{{ID: uuid.New(), Name: "Ana", AcademicID: "1000001"}},
			Events:   []service.EventView{{Event: domain.Event{Kind: domain.EventCreated, ActorID: uuid.New(), CreatedAt: at(20, 8, 0)}, ActorName: "Profa. Sediane"}},
		}
		status, body := call(t, srv, http.MethodGet, assessmentPath(classID, svc.detail.ID), nil)
		require.Equal(t, http.StatusOK, status, role)
		assert.Equal(t, []string{"Detail"}, svc.calls, role)
		for _, key := range []string{"moduleId", "moduleTitle", "composition", "audience", "eligibleStudents", "totalQuestions", "frozen",
			"teacherPrivateNotes", "createdBy", "createdByName", "updatedBy", "updatedByName", "updatedAt", "items", "drawRules", "students", "events"} {
			assert.Contains(t, body, key, role+": "+key)
		}
		assert.Equal(t, "Atenção na questão 3", body["teacherPrivateNotes"])
		assert.EqualValues(t, 10, body["maxScore"])
		items := array(t, body["items"])
		require.Len(t, items, 1)
		assert.Equal(t, sorted("questionId", "position", "weight", "title", "kind", "difficulty"), keysOf(object(t, items[0])))
		rules := array(t, body["drawRules"])
		require.Len(t, rules, 1)
		assert.Equal(t, sorted("difficulty", "quantity", "pointsPerQuestion"), keysOf(object(t, rules[0])))
		assert.EqualValues(t, 2.5, object(t, rules[0])["pointsPerQuestion"])
		students := array(t, body["students"])
		require.Len(t, students, 1)
		assert.Equal(t, sorted("studentId", "name", "academicId"), keysOf(object(t, students[0])))
		events := array(t, body["events"])
		require.Len(t, events, 1)
		assert.Equal(t, "Profa. Sediane", object(t, events[0])["actorName"])
		assert.Equal(t, "CREATED", object(t, events[0])["kind"])
		srv.Close()
	}
}

// ---- creating: the body and the answers ----

func createBody(extra map[string]any) map[string]any {
	body := map[string]any{
		"moduleId": uuid.New().String(), "title": "Prova 1", "description": "Leia com atenção.", "type": "EXAM", "maxScore": 10,
		"startsAt": "2026-10-21T09:00:00-03:00", "endsAt": "2026-10-21T11:00:00-03:00", "composition": "MANUAL",
		"items":    []map[string]any{{"questionId": uuid.New().String(), "weight": 5}, {"questionId": uuid.New().String(), "weight": 5}},
		"audience": "ALL_CLASS",
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

// Covers SPEC-075 CA-01, CA-03, CA-06 (section 5.2): the body is read into the input of the service, the actor and the class come from the
// session and the route, and the answer is 201 with the summary.
func TestHandler_CreateParsesTheBodyAndAnswers201(t *testing.T) {
	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	classID := uuid.New()
	svc.summary = service.Summary{Public: minimalPublic(), ModuleTitle: "Permissões", Composition: domain.CompositionManual, Audience: domain.AudienceAllClass}

	body := createBody(map[string]any{"durationMinutes": 90, "teacherPrivateNotes": "Conferir o lab"})
	status, got := call(t, srv, http.MethodPost, classPath(classID)+"/assessments", body)
	require.Equal(t, http.StatusCreated, status)
	assert.Equal(t, svc.summary.ID.String(), got["id"])
	assert.Equal(t, "Permissões", got["moduleTitle"])

	in := svc.create
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, body["moduleId"], in.ModuleID.String())
	assert.Equal(t, "Prova 1", in.Title)
	assert.Equal(t, "Leia com atenção.", in.Description)
	assert.Equal(t, domain.TypeExam, in.Type)
	assert.Equal(t, domain.Points(10), in.MaxScore)
	require.NotNil(t, in.DurationMinutes)
	assert.Equal(t, 90, *in.DurationMinutes)
	require.NotNil(t, in.StartsAt)
	assert.True(t, in.StartsAt.Equal(at(21, 9, 0)))
	assert.True(t, in.EndsAt.Equal(at(21, 11, 0)))
	assert.Equal(t, domain.CompositionManual, in.Composition)
	require.Len(t, in.Items, 2)
	assert.Equal(t, domain.Points(5), in.Items[0].Weight)
	assert.Equal(t, 1, in.Items[0].Position, "the order of the list is the order of the exam")
	assert.Equal(t, 2, in.Items[1].Position)
	assert.Equal(t, domain.AudienceAllClass, in.Audience)
	require.NotNil(t, in.PrivateNotes)
	assert.Equal(t, "Conferir o lab", *in.PrivateNotes)
	assert.Nil(t, in.ClassSessionID)
	assert.Nil(t, in.Draw)
}

// Covers SPEC-075 CA-03, CA-06, CA-07 (section 5.2): the draw is a total and a list of rules by level; a conversion sends only the lesson and what
// the teacher wants to override; chosen students come as a list of ids.
func TestHandler_CreateParsesTheDrawTheLessonAndTheStudents(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, lessonID, ana, bruno := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	draw := createBody(map[string]any{
		"composition": "DRAW", "items": nil,
		"draw": map[string]any{"total": 10, "rules": []map[string]any{
			{"difficulty": "EASY", "quantity": 3, "pointsPerQuestion": 1},
			{"difficulty": "MEDIUM", "quantity": 3, "pointsPerQuestion": 1},
			{"difficulty": "HARD", "quantity": 4, "pointsPerQuestion": 1},
		}},
	})
	status, _ := call(t, srv, http.MethodPost, classPath(classID)+"/assessments", draw)
	require.Equal(t, http.StatusCreated, status)
	require.NotNil(t, svc.create.Draw)
	assert.Equal(t, 10, svc.create.Draw.Total)
	assert.Equal(t, []domain.DrawRule{
		{Difficulty: domain.DifficultyEasy, Quantity: 3, Points: domain.Points(1)},
		{Difficulty: domain.DifficultyMedium, Quantity: 3, Points: domain.Points(1)},
		{Difficulty: domain.DifficultyHard, Quantity: 4, Points: domain.Points(1)},
	}, svc.create.Draw.Rules)
	assert.Empty(t, svc.create.Items)

	converted := map[string]any{
		"classSessionId": lessonID.String(), "type": "EXAM", "maxScore": 10, "composition": "MANUAL", "audience": "SELECTED",
		"studentIds": []string{ana.String(), bruno.String()},
		"items":      []map[string]any{{"questionId": uuid.New().String(), "weight": 10}},
	}
	status, _ = call(t, srv, http.MethodPost, classPath(classID)+"/assessments", converted)
	require.Equal(t, http.StatusCreated, status)
	require.NotNil(t, svc.create.ClassSessionID)
	assert.Equal(t, lessonID, *svc.create.ClassSessionID)
	assert.Nil(t, svc.create.ModuleID, "taken from the lesson")
	assert.Empty(t, svc.create.Title)
	assert.Nil(t, svc.create.StartsAt)
	assert.Nil(t, svc.create.EndsAt)
	assert.Equal(t, domain.AudienceSelected, svc.create.Audience)
	assert.Equal(t, []uuid.UUID{ana, bruno}, svc.create.StudentIDs)
}

// ---- the errors ----

// Covers SPEC-075 CA-02 to CA-07, CA-11, CA-13, CA-14, CA-16, CA-21 (section 5.2): every error of the domain becomes its status and its type.
func TestHandler_StatusCodesAndProblemTypes(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	cases := []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrInvalidAssessment, http.StatusBadRequest, "invalid-assessment"},
		{domain.ErrInvalidPeriod, http.StatusBadRequest, "invalid-period"},
		{domain.ErrWeightsMismatch, http.StatusBadRequest, "weights-mismatch"},
		{domain.ErrDrawMismatch, http.StatusBadRequest, "draw-mismatch"},
		{domain.ErrQuestionNotEligible, http.StatusBadRequest, "question-not-eligible"},
		{domain.ErrStudentNotInClass, http.StatusBadRequest, "student-not-in-class"},
		{domain.ErrReasonRequired, http.StatusBadRequest, "reason-required"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrAssessmentNotFound, http.StatusNotFound, "assessment-not-found"},
		{domain.ErrSessionNotFound, http.StatusNotFound, "session-not-found"},
		{domain.ErrSessionNotConvertible, http.StatusConflict, "session-not-convertible"},
		{domain.ErrModuleNotAssigned, http.StatusConflict, "module-not-assigned"},
		{&domain.StockError{Short: []domain.Shortage{{Difficulty: domain.DifficultyEasy, Asked: 6, Available: 5}}}, http.StatusConflict, "insufficient-stock"},
		{domain.ErrAssessmentFrozen, http.StatusConflict, "assessment-frozen"},
		{domain.ErrAssessmentEnded, http.StatusConflict, "assessment-ended"},
		{domain.ErrAssessmentCanceled, http.StatusConflict, "assessment-canceled"},
		{domain.ErrGradesHomologated, http.StatusConflict, "grades-homologated"},
		{errors.New("the database is down"), http.StatusInternalServerError, ""},
	}
	for _, c := range cases {
		svc.err = c.err
		status, body := call(t, srv, http.MethodPost, classPath(uuid.New())+"/assessments", createBody(nil))
		assert.Equal(t, c.status, status, c.err.Error())
		if c.typ != "" {
			assert.Equal(t, c.typ, body["type"], c.err.Error())
		}
		assert.NotContains(t, body, "teacherPrivateNotes")
	}
}

// Covers SPEC-075 CA-06 (section 5.2): the error of stock says which levels fall short, how many were asked and how many the bank has.
func TestHandler_InsufficientStockListsTheShortLevels(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	svc.err = &domain.StockError{Short: []domain.Shortage{
		{Difficulty: domain.DifficultyEasy, Asked: 6, Available: 5},
		{Difficulty: domain.DifficultyMedium, Asked: 5, Available: 4},
	}}
	status, body := call(t, srv, http.MethodPost, classPath(uuid.New())+"/assessments", createBody(nil))
	require.Equal(t, http.StatusConflict, status)
	short := array(t, body["shortages"])
	require.Len(t, short, 2)
	first := object(t, short[0])
	assert.Equal(t, "EASY", first["difficulty"])
	assert.EqualValues(t, 6, first["asked"])
	assert.EqualValues(t, 5, first["available"])
}

// Covers SPEC-075 CA-21 (RN-01): every route needs a session, whatever the method.
func TestHandler_RolesAndAuthentication(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	c, a := uuid.New(), uuid.New()
	routes := []struct{ method, path string }{
		{http.MethodPost, classPath(c) + "/assessments"},
		{http.MethodGet, classPath(c) + "/assessments"},
		{http.MethodGet, assessmentPath(c, a)},
		{http.MethodGet, assessmentPath(c, a) + "/preview"},
		{http.MethodPatch, assessmentPath(c, a)},
		{http.MethodPut, assessmentPath(c, a) + "/schedule"},
		{http.MethodPost, assessmentPath(c, a) + "/cancel"},
		{http.MethodPut, assessmentPath(c, a) + "/private-notes"},
		{http.MethodGet, classPath(c) + "/assessment-questions?moduleId=" + uuid.NewString()},
	}
	for _, r := range routes {
		status, body := send(t, srv, r.method, r.path, map[string]any{}, false)
		assert.Equal(t, http.StatusUnauthorized, status, r.method+" "+r.path)
		assert.Equal(t, "not-authenticated", body["type"], r.method+" "+r.path)
	}
	assert.Empty(t, svc.calls, "nothing reached the service without a session")

	// the routes that are only for the teacher hand the student to the service, which refuses (RN-01)
	student, svcStudent, _ := setup(authn.RoleStudent)
	defer student.Close()
	svcStudent.err = domain.ErrForbidden
	for _, r := range routes[3:] {
		status, body := call(t, student, r.method, r.path, map[string]any{"reason": "x", "teacherPrivateNotes": "x", "startsAt": "2026-10-21T09:00:00-03:00", "endsAt": "2026-10-21T11:00:00-03:00"})
		assert.Equal(t, http.StatusForbidden, status, r.method+" "+r.path)
		assert.Equal(t, "forbidden", body["type"])
	}
	for _, name := range svcStudent.calls {
		assert.NotEqual(t, "Detail", name)
	}
	assert.Equal(t, authn.RoleStudent, svcStudent.actor.Role, "the service knows who asked")
}

// Covers SPEC-075 section 5 (common errors): a bad id, a broken body or a value of the wrong kind is a bad request, and the service is not called.
func TestHandler_BadInputIsABadRequest(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	good := classPath(uuid.New()) + "/assessments"

	status, body := call(t, srv, http.MethodGet, "/api/v1/classes/not-a-uuid/assessments", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", body["type"])
	status, body = call(t, srv, http.MethodGet, classPath(uuid.New())+"/assessments/not-a-uuid", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "invalid-uuid", body["type"])

	for name, bad := range map[string]any{
		"broken json":          "{not json",
		"date that is no date": createBody(map[string]any{"startsAt": "ontem"}),
		"score as a word":      createBody(map[string]any{"maxScore": "dez"}),
		"weight as a word":     createBody(map[string]any{"items": []map[string]any{{"questionId": uuid.NewString(), "weight": "x"}}}),
		"question id no uuid":  createBody(map[string]any{"items": []map[string]any{{"questionId": "x", "weight": 10}}}),
		"student id no uuid":   createBody(map[string]any{"audience": "SELECTED", "studentIds": []string{"x"}}),
	} {
		status, body := call(t, srv, http.MethodPost, good, bad)
		assert.Equal(t, http.StatusBadRequest, status, name)
		assert.Equal(t, "malformed-request", body["type"], name)
	}
	assert.Empty(t, svc.calls)
}

// ---- the other routes ----

// Covers SPEC-075 CA-10 to CA-16 (section 5.2): the update sends only what came, the reschedule sends the dates and the reason, the cancel sends the
// reason, and the notes route sends the text and gives it back.
func TestHandler_UpdateRescheduleCancelAndNotes(t *testing.T) {
	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()
	svc.summary = service.Summary{Public: minimalPublic()}

	status, _ := call(t, srv, http.MethodPatch, assessmentPath(classID, id), map[string]any{"title": "Prova 1 (revisada)"})
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, userID, svc.actor.UserID)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, id, svc.id)
	require.NotNil(t, svc.update.Title)
	assert.Equal(t, "Prova 1 (revisada)", *svc.update.Title)
	assert.Nil(t, svc.update.Description, "what did not come is not changed")
	assert.Nil(t, svc.update.MaxScore)
	assert.Nil(t, svc.update.Items)
	assert.Nil(t, svc.update.StudentIDs)

	call(t, srv, http.MethodPatch, assessmentPath(classID, id), map[string]any{"audience": "SELECTED", "studentIds": []string{}})
	require.NotNil(t, svc.update.StudentIDs, "an empty list sent is not the same as no list")
	assert.Empty(t, *svc.update.StudentIDs)

	status, _ = call(t, srv, http.MethodPut, assessmentPath(classID, id)+"/schedule", map[string]any{
		"startsAt": "2026-10-22T14:00:00-03:00", "endsAt": "2026-10-22T16:00:00-03:00", "reason": "Laboratório ocupado",
	})
	require.Equal(t, http.StatusOK, status)
	assert.True(t, svc.reschedule.StartsAt.Equal(at(22, 14, 0)))
	assert.True(t, svc.reschedule.EndsAt.Equal(at(22, 16, 0)))
	assert.Equal(t, "Laboratório ocupado", svc.reschedule.Reason)

	status, _ = call(t, srv, http.MethodPut, assessmentPath(classID, id)+"/schedule", map[string]any{"startsAt": "2026-10-22T14:00:00-03:00"})
	assert.Equal(t, http.StatusBadRequest, status, "the end is required")

	status, _ = call(t, srv, http.MethodPost, assessmentPath(classID, id)+"/cancel", map[string]any{"reason": "Falta de energia"})
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "Falta de energia", svc.reason)

	status, body := call(t, srv, http.MethodPut, assessmentPath(classID, id)+"/private-notes", map[string]any{"teacherPrivateNotes": "Conferir o lab 02"})
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, "Conferir o lab 02", svc.notes)
	assert.Equal(t, sorted("teacherPrivateNotes"), keysOf(body))
	assert.Equal(t, "Conferir o lab 02", body["teacherPrivateNotes"])

	call(t, srv, http.MethodPut, assessmentPath(classID, id)+"/private-notes", map[string]any{"teacherPrivateNotes": ""})
	assert.Empty(t, svc.notes, "an empty text clears the notes")
}

// Covers SPEC-075 CA-23 (section 5.2): the list takes the phase and the status as filters, and refuses the ones that do not exist.
func TestHandler_ListPassesTheFilters(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	svc.listed = []service.Summary{{Public: minimalPublic(), EligibleStudents: 3}}

	status, body := call(t, srv, http.MethodGet, classPath(uuid.New())+"/assessments?phase=UPCOMING&status=SCHEDULED", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, domain.PhaseUpcoming, svc.list.Phase)
	assert.Equal(t, domain.StatusScheduled, svc.list.Status)
	assert.Equal(t, []string{"List"}, svc.calls)
	items := array(t, body["items"])
	require.Len(t, items, 1)
	assert.EqualValues(t, 3, object(t, items[0])["eligibleStudents"])
	assert.Contains(t, body, "serverNow")

	status, resp := call(t, srv, http.MethodGet, classPath(uuid.New())+"/assessments?phase=SOON", nil)
	assert.Equal(t, http.StatusBadRequest, status)
	assert.Equal(t, "malformed-request", resp["type"])
}

// Covers SPEC-081 CA-14, CA-15 (section 5): every question of the preview and of the sample carries studentView, with the fields of its kind and no
// answer; the fields the preview already had do not change.
func TestHandler_PreviewCarriesTheStudentViewOfEachKind(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()
	yes, size := true, 300
	of := func(kind string, view service.StudentView) service.QuestionContent {
		return service.QuestionContent{
			Question:  service.Question{ID: uuid.New(), Title: kind, Kind: kind, Difficulty: domain.DifficultyEasy},
			Statement: "<p>enunciado</p>", AnswerKey: "a resposta", Explanation: "porque", StudentView: view,
		}
	}
	single := of("THEORETICAL_SINGLE", service.StudentView{Choices: []service.StudentChoice{{ID: "a", HTML: "<p>ls</p>"}}, Shuffle: &yes})
	matching := of("THEORETICAL_MATCHING", service.StudentView{
		Columns: &service.StudentColumns{Left: []service.StudentItem{{ID: "l1", Text: "ls"}}, Right: []service.StudentItem{{ID: "r1", Text: "lista"}}},
		Shuffle: &yes,
	})
	discursive := of("DISCURSIVE", service.StudentView{MaxLength: &size})
	boolean := of("THEORETICAL_BOOLEAN", service.StudentView{})
	svc.preview = service.Preview{
		Questions: []service.PreviewQuestion{
			{Position: 1, Weight: domain.Points(2), QuestionContent: single}, {Position: 2, Weight: domain.Points(2), QuestionContent: matching},
			{Position: 3, Weight: domain.Points(2), QuestionContent: discursive}, {Position: 4, Weight: domain.Points(2), QuestionContent: boolean},
		},
		Sample: []service.QuestionContent{single},
	}
	status, body := call(t, srv, http.MethodGet, assessmentPath(classID, id)+"/preview", nil)
	require.Equal(t, http.StatusOK, status)
	questions := array(t, body["questions"])
	require.Len(t, questions, 4)
	for _, q := range questions {
		assert.Equal(t, sorted("position", "weight", "questionId", "title", "kind", "difficulty", "statement", "answerKey", "explanation", "studentView"),
			keysOf(object(t, q)), "the old fields stay and studentView is always there")
	}
	view := func(i int) map[string]any { return object(t, object(t, questions[i])["studentView"]) }
	assert.Equal(t, sorted("choices", "shuffle"), keysOf(view(0)))
	assert.Equal(t, sorted("id", "html"), keysOf(object(t, array(t, view(0)["choices"])[0])))
	assert.Equal(t, sorted("columns", "shuffle"), keysOf(view(1)))
	columns := object(t, view(1)["columns"])
	assert.Equal(t, sorted("left", "right"), keysOf(columns))
	assert.Equal(t, sorted("id", "text"), keysOf(object(t, array(t, columns["left"])[0])))
	assert.Equal(t, sorted("maxLength"), keysOf(view(2)))
	assert.EqualValues(t, 300, view(2)["maxLength"])
	assert.Empty(t, view(3), "a true or false question has only the statement")
	sample := array(t, body["sample"])
	require.Len(t, sample, 1)
	assert.Contains(t, object(t, sample[0]), "studentView", "the sample is shown to the student the same way")
}

// Covers SPEC-083 CA-01, CA-08 (section 5): the teacher starts the exam by the route of the start, with no body, and gets the summary with who
// started it and when; the summary has no start before it happens, and the route is only for the teacher and the administrator.
func TestHandler_StartTheExam(t *testing.T) {
	srv, svc, userID := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id := uuid.New(), uuid.New()
	svc.summary = service.Summary{Public: minimalPublic(), Modality: domain.ModalityInPerson, StartedAt: ptr(at(21, 9, 5)), StartedBy: ptr(userID), StartedByName: "Profa. Sediane"}

	status, body := call(t, srv, http.MethodPost, assessmentPath(classID, id)+"/start", nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, []string{"Start"}, svc.calls)
	assert.Equal(t, classID, svc.classID)
	assert.Equal(t, id, svc.id)
	assert.Equal(t, userID.String(), body["startedBy"])
	assert.Equal(t, "Profa. Sediane", body["startedByName"])
	assert.Contains(t, body["startedAt"], "2026-10-21T09:05:00")
	assert.Contains(t, body, "serverNow")

	svc.summary = service.Summary{Public: minimalPublic(), Modality: domain.ModalityInPerson}
	_, body = call(t, srv, http.MethodPost, assessmentPath(classID, id)+"/start", nil)
	assert.NotContains(t, body, "startedAt", "no start before it happens")
	assert.NotContains(t, body, "startedBy")
	assert.NotContains(t, body, "startedByName")
}

// Covers SPEC-083 CA-03, CA-04 (section 5): the errors of the start and of the clearance before the start, with their status and slug.
func TestHandler_StartAndClearanceErrors(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	path := assessmentPath(uuid.New(), uuid.New())
	cases := []struct {
		route  string
		err    error
		status int
		typ    string
	}{
		{"/start", domain.ErrInvalidAssessment, http.StatusBadRequest, "invalid-assessment"},
		{"/start", domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{"/start", domain.ErrAssessmentNotFound, http.StatusNotFound, "assessment-not-found"},
		{"/start", domain.ErrAssessmentCanceled, http.StatusConflict, "assessment-canceled"},
		{"/start", domain.ErrAssessmentEnded, http.StatusConflict, "assessment-ended"},
		{"/start", domain.ErrAssessmentNotOpenYet, http.StatusConflict, "assessment-not-open-yet"},
		{"/start", domain.ErrAssessmentAlreadyStarted, http.StatusConflict, "assessment-already-started"},
		{"/clearances", domain.ErrAssessmentNotStarted, http.StatusConflict, "assessment-not-started"},
	}
	for _, c := range cases {
		svc.err = c.err
		status, body := call(t, srv, http.MethodPost, path+c.route, map[string]any{"action": "APPROVE_ALL"})
		assert.Equal(t, c.status, status, c.route+" "+c.err.Error())
		assert.Equal(t, c.typ, body["type"], c.route+" "+c.err.Error())
	}
}

// Covers SPEC-075 CA-04, CA-22 (section 5.2): the preview carries the questions with the answer key, and for a draw the rules, the stock and the
// sample; the questions to pick from take the module and the filters, and the module is required.
func TestHandler_PreviewAndEligibleQuestions(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id, moduleID, q := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	content := service.QuestionContent{
		Question:  service.Question{ID: q, Title: "Criar pasta", Kind: "PRACTICAL", Difficulty: domain.DifficultyEasy},
		Statement: "Crie /a", AnswerKey: "mkdir /a", Explanation: "mkdir cria pastas",
	}
	svc.preview = service.Preview{
		Questions: []service.PreviewQuestion{{Position: 1, Weight: domain.Points(5), QuestionContent: content}},
		Rules:     []domain.DrawRule{{Difficulty: domain.DifficultyEasy, Quantity: 3, Points: domain.Points(1)}},
		Stock:     map[domain.Difficulty]int{domain.DifficultyEasy: 5, domain.DifficultyHard: 4},
		Sample:    []service.QuestionContent{content},
	}
	status, body := call(t, srv, http.MethodGet, assessmentPath(classID, id)+"/preview", nil)
	require.Equal(t, http.StatusOK, status)
	questions := array(t, body["questions"])
	require.Len(t, questions, 1)
	assert.Equal(t, sorted("position", "weight", "questionId", "title", "kind", "difficulty", "statement", "answerKey", "explanation", "studentView"),
		keysOf(object(t, questions[0])))
	assert.Equal(t, "mkdir /a", object(t, questions[0])["answerKey"])
	assert.Contains(t, body, "rules")
	assert.EqualValues(t, 5, object(t, body["stock"])["EASY"])
	assert.EqualValues(t, 4, object(t, body["stock"])["HARD"])
	assert.Len(t, array(t, body["sample"]), 1)

	svc.page = service.QuestionPage{
		Items: []service.Question{content.Question}, Total: 13,
		Stock: map[domain.Difficulty]int{domain.DifficultyEasy: 5, domain.DifficultyMedium: 4, domain.DifficultyHard: 4},
	}
	path := classPath(classID) + "/assessment-questions?moduleId=" + moduleID.String() + "&difficulty=HARD&kind=PRACTICAL&q=pasta&page=2&pageSize=20"
	status, body = call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, service.QuestionFilter{ModuleID: moduleID, Difficulty: domain.DifficultyHard, Kind: "PRACTICAL", Query: "pasta", Page: 2, PageSize: 20}, svc.questions)
	items := array(t, body["items"])
	require.Len(t, items, 1)
	assert.Equal(t, sorted("questionId", "title", "kind", "difficulty"), keysOf(object(t, items[0])))
	assert.EqualValues(t, 13, body["total"])
	assert.EqualValues(t, 4, object(t, body["stock"])["MEDIUM"])

	status, resp := call(t, srv, http.MethodGet, classPath(classID)+"/assessment-questions", nil)
	assert.Equal(t, http.StatusBadRequest, status, "the module is required")
	assert.Equal(t, "malformed-request", resp["type"])
}

// Covers SPEC-084 CA-14 (section 5): the route of the scenario of a question answers the question and the machine, and no machine when the question has
// none; the errors have their slug and status.
func TestHandler_QuestionScenario(t *testing.T) {
	srv, svc, _ := setup(authn.RoleTeacher)
	defer srv.Close()
	classID, id, question := uuid.New(), uuid.New(), uuid.New()
	path := assessmentPath(classID, id) + "/questions/" + question.String() + "/scenario"

	svc.scenario = json.RawMessage(`{"files":{"/a":"x"}}`)
	status, body := call(t, srv, http.MethodGet, path, nil)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, []string{"QuestionScenario"}, svc.calls)
	assert.Equal(t, question, svc.questionID)
	assert.Equal(t, question.String(), body["questionId"])
	assert.Equal(t, sorted("questionId", "snapshot"), keysOf(body))
	assert.Equal(t, map[string]any{"files": map[string]any{"/a": "x"}}, body["snapshot"])

	svc.scenario = nil
	_, body = call(t, srv, http.MethodGet, path, nil)
	assert.Equal(t, sorted("questionId"), keysOf(body), "a question without a scenario has no snapshot")

	for _, c := range []struct {
		err    error
		status int
		typ    string
	}{
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrClassNotFound, http.StatusNotFound, "class-not-found"},
		{domain.ErrAssessmentNotFound, http.StatusNotFound, "assessment-not-found"},
		{domain.ErrQuestionNotFound, http.StatusNotFound, "question-not-found"},
	} {
		svc.err = c.err
		status, body := call(t, srv, http.MethodGet, path, nil)
		assert.Equal(t, c.status, status, c.err.Error())
		assert.Equal(t, c.typ, body["type"], c.err.Error())
	}
}
