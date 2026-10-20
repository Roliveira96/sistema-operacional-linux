package repository_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
)

// another student, so a batch has more than one row.
func (e env) anotherStudent(t *testing.T, name, ra string) userdomain.User {
	t.Helper()
	u := userdomain.User{Name: &name, Email: ra + "@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(e.db).Create(e.ctx, &u))
	return u
}

func (e env) clearedEvent(at time.Time) domain.Event {
	return domain.Event{Kind: domain.EventClearanceUpdated, ActorID: e.teacher.ID, CreatedAt: at, ChangedFields: []string{"clearances"}}
}

func (e env) decision(student uuid.UUID, status domain.ClearanceStatus, reason *string, at time.Time) domain.Clearance {
	return domain.Clearance{StudentID: student, Status: status, RejectionReason: reason, ClearedBy: e.teacher.ID, ClearedAt: at}
}

// ---- RN-01, RN-02: the columns ----

// Covers SPEC-076 CA-01, CA-02, CA-03 (section 4): the modality and the requirement come back as stored, and the database refuses what the rules
// refuse: an assignment in person, a modality that does not exist, and an online assessment that requires the clearance.
func TestRepository_ModalityConstraints(t *testing.T) {
	e := newEnv(t)

	inPerson := e.create(t, func(a *domain.Assessment) { a.Modality, a.RequiresClearance = domain.ModalityInPerson, true })
	got, err := e.repo.Find(e.ctx, inPerson.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ModalityInPerson, got.Modality)
	assert.True(t, got.RequiresClearance)

	online := e.create(t, func(a *domain.Assessment) { a.Modality = domain.ModalityOnline })
	got, err = e.repo.Find(e.ctx, online.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ModalityOnline, got.Modality)
	assert.False(t, got.RequiresClearance)

	e.create(t, func(a *domain.Assessment) {
		a.Type, a.Modality, a.EndsAt = domain.TypeAssignment, domain.ModalityOnline, at(23, 18, 0)
	})

	for name, mutate := range map[string]func(*domain.Assessment){
		"an assignment in person": func(a *domain.Assessment) {
			a.Type, a.Modality, a.EndsAt = domain.TypeAssignment, domain.ModalityInPerson, at(23, 18, 0)
		},
		"online and required":     func(a *domain.Assessment) { a.Modality, a.RequiresClearance = domain.ModalityOnline, true },
		"a modality that is none": func(a *domain.Assessment) { a.Modality = "HYBRID" },
		"no modality":             func(a *domain.Assessment) { a.Modality = "" },
	} {
		a := e.assessment(mutate)
		assert.Error(t, e.repo.Create(e.ctx, &a, e.items(3), nil, nil, e.created(e.now)), name)
	}

	// the modality is saved with the rest of the assessment
	got, err = e.repo.Find(e.ctx, inPerson.ID)
	require.NoError(t, err)
	got.Modality, got.RequiresClearance = domain.ModalityOnline, false
	require.NoError(t, e.repo.Save(e.ctx, &got, service.Replacements{}, nil))
	got, err = e.repo.Find(e.ctx, inPerson.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ModalityOnline, got.Modality)
}

// ---- RN-04, RN-11, RN-12: the decisions ----

// Covers SPEC-076 CA-14 (section 4): one decision for each student of the assessment; the last one wins and only it is kept, with who, when and
// the reason; a second row for the same student is refused by the database.
func TestRepository_OneClearancePerStudentAndAssessment(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	ana := e.student
	moment := e.now

	require.NoError(t, e.repo.SaveClearances(e.ctx, a.ID, []domain.Clearance{e.decision(ana.ID, domain.ClearanceRejected, ptr("Reprovada por faltas"), moment)}, e.clearedEvent(moment)))
	later := moment.Add(time.Hour)
	require.NoError(t, e.repo.SaveClearances(e.ctx, a.ID, []domain.Clearance{e.decision(ana.ID, domain.ClearanceApproved, nil, later)}, e.clearedEvent(later)))

	rows, err := e.repo.Clearances(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1, "one row for the student")
	assert.Equal(t, domain.ClearanceApproved, rows[0].Status)
	assert.Nil(t, rows[0].RejectionReason, "the old reason went with the old decision")
	assert.Equal(t, e.teacher.ID, rows[0].ClearedBy)
	assert.True(t, rows[0].ClearedAt.Equal(later))
	assert.Equal(t, ana.ID, rows[0].StudentID)
	assert.Equal(t, a.ID, rows[0].AssessmentID)

	// the unique key itself, below the upsert
	err = e.db.Conn(e.ctx).Exec(`INSERT INTO assessment_clearances (id, assessment_id, student_id, status, cleared_by, cleared_at, created_at, updated_at)
		VALUES (?, ?, ?, 'APPROVED', ?, now(), now(), now())`, uuid.New(), a.ID, ana.ID, e.teacher.ID).Error
	assert.Error(t, err, "a second row for the same student and assessment")

	// another assessment has its own decision about the same student
	other := e.create(t)
	require.NoError(t, e.repo.SaveClearances(e.ctx, other.ID, []domain.Clearance{e.decision(ana.ID, domain.ClearanceRejected, nil, moment)}, e.clearedEvent(moment)))
	rows, err = e.repo.Clearances(e.ctx, other.ID)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, domain.ClearanceRejected, rows[0].Status)
}

// Covers SPEC-076 CA-14 (RN-12): the rows and the event of an action go together; when a row is refused, neither the other rows nor the event are
// written.
func TestRepository_ClearanceBatchIsAtomicWithItsEvent(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	bruno := e.anotherStudent(t, "Bruno", "1000002")
	events, err := e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	before := len(events)

	// the second student does not exist: the foreign key refuses the row, and Bruno goes back with it
	err = e.repo.SaveClearances(e.ctx, a.ID, []domain.Clearance{
		e.decision(bruno.ID, domain.ClearanceApproved, nil, e.now),
		e.decision(uuid.New(), domain.ClearanceApproved, nil, e.now),
	}, e.clearedEvent(e.now))
	assert.Error(t, err)
	rows, err := e.repo.Clearances(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Empty(t, rows, "nothing of the batch stayed")
	events, err = e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	assert.Len(t, events, before, "and no event")

	require.NoError(t, e.repo.SaveClearances(e.ctx, a.ID, []domain.Clearance{
		e.decision(bruno.ID, domain.ClearanceApproved, nil, e.now),
		e.decision(e.student.ID, domain.ClearanceRejected, ptr("Faltas"), e.now),
	}, e.clearedEvent(e.now)))
	events, err = e.repo.Events(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, events, before+1, "one event for the whole batch")
	last := events[len(events)-1]
	assert.Equal(t, domain.EventClearanceUpdated, last.Kind)
	assert.Equal(t, e.teacher.ID, last.ActorID)
	assert.Equal(t, []string{"clearances"}, last.ChangedFields)
}

// Covers SPEC-076 CA-05 (RN-05): the decisions of an assessment are read by assessment and only its own; and the status the database holds is one
// of the two decided ones: waiting is never a row.
func TestRepository_ClearanceCountsAndListByAssessment(t *testing.T) {
	e := newEnv(t)
	a := e.create(t)
	other := e.create(t)
	bruno := e.anotherStudent(t, "Bruno", "1000002")

	require.NoError(t, e.repo.SaveClearances(e.ctx, a.ID, []domain.Clearance{
		e.decision(e.student.ID, domain.ClearanceApproved, nil, e.now),
		e.decision(bruno.ID, domain.ClearanceRejected, ptr("Reprovado por faltas"), e.now),
	}, e.clearedEvent(e.now)))
	require.NoError(t, e.repo.SaveClearances(e.ctx, other.ID, []domain.Clearance{e.decision(bruno.ID, domain.ClearanceApproved, nil, e.now)}, e.clearedEvent(e.now)))

	rows, err := e.repo.Clearances(e.ctx, a.ID)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	byStudent := map[uuid.UUID]domain.Clearance{}
	for _, r := range rows {
		byStudent[r.StudentID] = r
	}
	assert.Equal(t, domain.ClearanceApproved, byStudent[e.student.ID].Status)
	assert.Equal(t, domain.ClearanceRejected, byStudent[bruno.ID].Status)
	require.NotNil(t, byStudent[bruno.ID].RejectionReason)
	assert.Equal(t, "Reprovado por faltas", *byStudent[bruno.ID].RejectionReason)

	none, err := e.repo.Clearances(e.ctx, uuid.New())
	require.NoError(t, err)
	assert.Empty(t, none)

	for name, row := range map[string]domain.Clearance{
		"waiting stored":        e.decision(e.student.ID, domain.ClearancePending, nil, e.now),
		"a reason on approval":  e.decision(e.student.ID, domain.ClearanceApproved, ptr("x"), e.now),
		"a reason above 300":    e.decision(e.student.ID, domain.ClearanceRejected, ptr(strings.Repeat("a", 301)), e.now),
		"a status that is none": e.decision(e.student.ID, "MAYBE", nil, e.now),
	} {
		assert.Error(t, e.repo.SaveClearances(e.ctx, other.ID, []domain.Clearance{row}, e.clearedEvent(e.now)), name)
	}
}

// ---- the migration ----

// Covers SPEC-076 CA-20 (section 4): migration 00042 adds the modality and the requirement to the assessments already stored (an exam in person, an
// assignment online, nothing requiring the clearance), makes the table of the decisions and lets the new kind of event in; going down takes all that
// away and leaves the rest of the schema, and going up again brings it back ready to use.
func TestMigration00042_UpAndDown(t *testing.T) {
	e := newEnv(t) // every migration was applied by the helper
	up, down := migrationParts(t, "00042_")

	hasClearances := func() bool {
		var n int64
		require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'assessment_clearances'`).Scan(&n).Error)
		return n == 1
	}
	assert.True(t, hasClearances(), "the table exists after the migration")

	// an event of the new kind, which the old Down has to get rid of for the old check to hold
	a := e.create(t)
	require.NoError(t, e.repo.SaveClearances(e.ctx, a.ID, []domain.Clearance{e.decision(e.student.ID, domain.ClearanceApproved, nil, e.now)}, e.clearedEvent(e.now)))

	runMigration(t, e, down)
	assert.False(t, hasClearances(), "the Down took the table away")
	var columns int64
	require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
		AND table_name = 'assessments' AND column_name IN ('modality', 'requires_clearance')`).Scan(&columns).Error)
	assert.Zero(t, columns, "and the two columns")
	var stored int64
	require.NoError(t, e.db.Conn(e.ctx).Table("assessments").Count(&stored).Error, "and left the rest of the schema")
	assert.Equal(t, int64(1), stored)

	// two assessments stored the way the SPEC-075 stored them: no modality and no requirement
	for _, kind := range []string{"EXAM", "ASSIGNMENT"} {
		require.NoError(t, e.db.Conn(e.ctx).Exec(`INSERT INTO assessments (id, class_id, module_id, title, description, type, status, max_score, starts_at, ends_at,
			composition, audience, created_by, updated_by, created_at, updated_at)
			VALUES (?, ?, ?, ?, '', ?, 'SCHEDULED', 10, '2026-10-21 12:00+00', '2026-10-21 14:00+00', 'MANUAL', 'ALL_CLASS', ?, ?, now(), now())`,
			uuid.New(), e.class.ID, e.module.ID, "antiga "+kind, kind, e.teacher.ID, e.teacher.ID).Error)
	}

	runMigration(t, e, up)
	assert.True(t, hasClearances(), "the table is back")
	type row struct {
		Title             string
		Modality          string
		RequiresClearance bool
	}
	var old []row
	require.NoError(t, e.db.Conn(e.ctx).Raw(`SELECT title, modality, requires_clearance FROM assessments WHERE title LIKE 'antiga %' ORDER BY title`).Scan(&old).Error)
	assert.Equal(t, []row{{"antiga ASSIGNMENT", "ONLINE", false}, {"antiga EXAM", "IN_PERSON", false}}, old, "the modality by the type, and nothing requires the clearance")

	again := e.assessment()
	require.NoError(t, e.repo.Create(e.ctx, &again, e.items(3), nil, nil, e.created(e.now)), "and it is ready to use")
	require.NoError(t, e.repo.SaveClearances(e.ctx, again.ID, []domain.Clearance{e.decision(e.student.ID, domain.ClearanceRejected, nil, e.now)}, e.clearedEvent(e.now)))
}
