package repository_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

type bankFixture struct {
	db      *database.DB
	ctx     context.Context
	repo    *repository.Repository
	teacher userdomain.User
	module  cmdomain.CourseModule
	now     time.Time
}

func newBank(t *testing.T) bankFixture {
	t.Helper()
	db := dbtest.Open(t)
	ctx := context.Background()
	ana := userdomain.User{Name: ptr("Ana Prof"), Email: "ana@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(db).Create(ctx, &ana))
	module := cmdomain.CourseModule{TeacherID: ana.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, ana.ID))
	return bankFixture{db: db, ctx: ctx, repo: repository.New(db), teacher: ana, module: module, now: time.Now().UTC().Truncate(time.Microsecond)}
}

func (f bankFixture) create(t *testing.T, title string) service.ExerciseRecord {
	t.Helper()
	by := f.teacher.ID
	q := domain.Question{ID: uuid.New(), ModuleID: f.module.ID, Kind: domain.KindPractical, Usage: domain.UsageAssessment, Difficulty: "EASY", Status: domain.StatusDraft,
		Title: title, Statement: "<p>x</p>", Hints: json.RawMessage(`[]`), EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`),
		ValidationConditions: json.RawMessage(`[{"type":"DIRECTORY_EXISTS","path":"/a"}]`), CreatedBy: &by, UpdatedBy: &by, CreatedAt: f.now, UpdatedAt: f.now}
	require.NoError(t, f.repo.CreateExercise(f.ctx, &q))
	rec, err := f.repo.FindExercise(f.ctx, f.module.ID, q.ID)
	require.NoError(t, err)
	return rec
}

func (f bankFixture) titles(t *testing.T) []string {
	t.Helper()
	list, err := f.repo.ListExercises(f.ctx, f.module.ID)
	require.NoError(t, err)
	out := make([]string, len(list))
	for i, r := range list {
		out[i] = r.Title
	}
	return out
}

// Covers SPEC-023 RN-01, RN-03: an exercise is created reserved, and making it available gives it a place at the end of the trail.
func TestExerciseBankAvailability(t *testing.T) {
	f := newBank(t)
	a, b, c := f.create(t, "A"), f.create(t, "B"), f.create(t, "C")
	assert.Equal(t, "Ana Prof", a.CreatedByName)
	assert.Zero(t, a.Position, "created reserved: no place in the trail")

	for _, rec := range []service.ExerciseRecord{a, b, c} {
		_, err := f.repo.SetAvailability(f.ctx, f.module.ID, rec.ID, domain.UsageExercise, domain.StatusPublished, f.now)
		require.NoError(t, err)
	}
	assert.Equal(t, []string{"A", "B", "C"}, f.titles(t))
	got, err := f.repo.FindExercise(f.ctx, f.module.ID, c.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, got.Position)
	assert.True(t, got.Mandatory)
	assert.Equal(t, domain.UsageExercise, got.Usage)

	// Reserving the one in the middle closes the gap and keeps the order of the others.
	reserved, err := f.repo.SetAvailability(f.ctx, f.module.ID, b.ID, domain.UsageAssessment, domain.StatusPublished, f.now)
	require.NoError(t, err)
	assert.Zero(t, reserved.Position)
	assert.Equal(t, []string{"A", "C", "B"}, f.titles(t), "the available ones in order, then the reserved ones")
	c2, _ := f.repo.FindExercise(f.ctx, f.module.ID, c.ID)
	assert.Equal(t, 2, c2.Position)

	_, err = f.repo.SetAvailability(f.ctx, f.module.ID, uuid.New(), domain.UsageExercise, domain.StatusDraft, f.now)
	assert.ErrorIs(t, err, service.ErrExerciseNotFound)
}

// Covers SPEC-023 RN-03: the order and the obligation of the trail are set as the teacher says, and only with exactly the available ones.
func TestExerciseBankReorder(t *testing.T) {
	f := newBank(t)
	ids := map[string]uuid.UUID{}
	for _, title := range []string{"A", "B", "C"} {
		rec := f.create(t, title)
		ids[title] = rec.ID
		_, err := f.repo.SetAvailability(f.ctx, f.module.ID, rec.ID, domain.UsageExercise, domain.StatusPublished, f.now)
		require.NoError(t, err)
	}
	require.NoError(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: ids["C"], Mandatory: false}, {ExerciseID: ids["A"], Mandatory: true}, {ExerciseID: ids["B"], Mandatory: true}}, f.now))
	assert.Equal(t, []string{"C", "A", "B"}, f.titles(t))
	c, _ := f.repo.FindExercise(f.ctx, f.module.ID, ids["C"])
	assert.False(t, c.Mandatory)

	assert.ErrorIs(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: ids["A"]}}, f.now), service.ErrInvalidExerciseOrder, "a list that leaves one out")
	assert.ErrorIs(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: ids["A"]}, {ExerciseID: ids["B"]}, {ExerciseID: uuid.New()}}, f.now), service.ErrInvalidExerciseOrder, "a list with a stranger")
	assert.Equal(t, []string{"C", "A", "B"}, f.titles(t), "nothing changed")
}

// Covers SPEC-023 RN-05, CA-08: saving writes the fields and the author, and detects a change by someone else.
func TestExerciseBankUpdate(t *testing.T) {
	f := newBank(t)
	a := f.create(t, "A")
	clean, err := domain.NormalizeExercise(domain.ExerciseInput{Title: "A novo", Difficulty: "HARD", Statement: "<p>novo</p>",
		Hints:      json.RawMessage(`[{"text":"dica"}]`),
		Solution:   json.RawMessage(`{"steps":[{"command":"mkdir /b"}]}`),
		Conditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/b"}]`)}, domain.NewHTMLSanitizer())
	require.NoError(t, err)
	catalog, _ := json.Marshal(clean.Catalog)
	later := f.now.Add(time.Minute)

	saved, err := f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, service.ExerciseUpdate{Exercise: clean, Catalog: catalog, By: f.teacher.ID, Now: later}, &a.UpdatedAt)
	require.NoError(t, err)
	assert.Equal(t, "A novo", saved.Title)
	assert.Equal(t, "HARD", saved.Difficulty)
	assert.True(t, saved.UpdatedAt.Equal(later))
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /b"}]}`, string(saved.ReferenceSolution))
	assert.JSONEq(t, `[{"type":"DIRECTORY_EXISTS","path":"/b"}]`, string(saved.ValidationConditions))
	assert.Equal(t, "Ana Prof", saved.UpdatedByName)
	assert.False(t, saved.ContinuesPrevious)

	// RN-11: the exercise can be saved as continuing from the previous one, and goes back.
	clean.ContinuesPrevious = true
	chained, err := f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, service.ExerciseUpdate{Exercise: clean, Catalog: catalog, By: f.teacher.ID, Now: later.Add(30 * time.Second)}, nil)
	require.NoError(t, err)
	assert.True(t, chained.ContinuesPrevious)
	clean.ContinuesPrevious = false
	saved = chained

	// A second save with the instant the editor had before is a conflict; without the guard it goes through.
	_, err = f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, service.ExerciseUpdate{Exercise: clean, Catalog: catalog, By: f.teacher.ID, Now: later.Add(time.Minute)}, &a.UpdatedAt)
	assert.ErrorIs(t, err, service.ErrExerciseConflict)
	_, err = f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, service.ExerciseUpdate{Exercise: clean, Catalog: catalog, By: f.teacher.ID, Now: later.Add(time.Minute)}, nil)
	require.NoError(t, err)
	_, err = f.repo.UpdateExercise(f.ctx, f.module.ID, uuid.New(), service.ExerciseUpdate{Exercise: clean, Catalog: catalog, By: f.teacher.ID, Now: later}, nil)
	assert.ErrorIs(t, err, service.ErrExerciseNotFound)
}

// Covers SPEC-023 RN-09: removing an exercise takes it out of the bank and of the trail, and erases the progress of the students in it.
func TestExerciseBankDelete(t *testing.T) {
	f := newBank(t)
	a, b := f.create(t, "A"), f.create(t, "B")
	for _, rec := range []service.ExerciseRecord{a, b} {
		_, err := f.repo.SetAvailability(f.ctx, f.module.ID, rec.ID, domain.UsageExercise, domain.StatusPublished, f.now)
		require.NoError(t, err)
	}
	student := userdomain.User{Email: "aluno@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(f.db).Create(f.ctx, &student))
	require.NoError(t, f.db.Conn(f.ctx).Exec(`INSERT INTO exercise_progress (id, user_id, question_id, attempts, last_passed, completed_at, created_at, updated_at)
        VALUES (gen_random_uuid(), ?, ?, 1, true, now(), now(), now())`, student.ID, a.ID).Error)

	require.NoError(t, f.repo.DeleteExercise(f.ctx, f.module.ID, a.ID, f.now))
	assert.Equal(t, []string{"B"}, f.titles(t))
	b2, _ := f.repo.FindExercise(f.ctx, f.module.ID, b.ID)
	assert.Equal(t, 1, b2.Position, "the trail is numbered again")
	var left int64
	require.NoError(t, f.db.Conn(f.ctx).Table("exercise_progress").Where("question_id = ?", a.ID).Count(&left).Error)
	assert.Zero(t, left)
	_, err := f.repo.FindExercise(f.ctx, f.module.ID, a.ID)
	assert.ErrorIs(t, err, service.ErrExerciseNotFound)
	assert.ErrorIs(t, f.repo.DeleteExercise(f.ctx, f.module.ID, a.ID, f.now), service.ErrExerciseNotFound)
}

// Covers SPEC-023 RN-06, D-07: the two snapshots are kept apart, and a published version freezes them and restores them.
func TestExerciseSetupsInVersions(t *testing.T) {
	f := newBank(t)
	ex, as, err := f.repo.ExerciseSetups(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.Nil(t, ex)
	assert.Nil(t, as)

	hashBefore := func() bool { _, changed, err := f.repo.ListVersions(f.ctx, f.module.ID); require.NoError(t, err); return changed }
	assert.False(t, hashBefore(), "a module without the snapshots keeps the hash of its first version")

	exercises := json.RawMessage(`{"steps":[{"command":"mkdir /treino"}]}`)
	assessment := json.RawMessage(`{"steps":[{"command":"mkdir /prova"}]}`)
	require.NoError(t, f.repo.SaveExerciseSetups(f.ctx, f.module.ID, exercises, assessment))
	ex, as, err = f.repo.ExerciseSetups(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, string(exercises), string(ex))
	assert.JSONEq(t, string(assessment), string(as))
	assert.True(t, hashBefore(), "the snapshots are part of the draft")

	published, err := f.repo.PublishVersion(f.ctx, f.module.ID, f.teacher.ID, "com ambientes")
	require.NoError(t, err)
	var frozen domain.VersionContent
	require.NoError(t, json.Unmarshal(published.Content, &frozen))
	assert.JSONEq(t, string(exercises), string(frozen.ExercisesSetupOrNil()))
	assert.JSONEq(t, string(assessment), string(frozen.AssessmentSetupOrNil()))

	// The draft moves on; restoring the first version (which had none) clears them, and restoring the published one brings them back.
	require.NoError(t, f.repo.SaveExerciseSetups(f.ctx, f.module.ID, nil, nil))
	require.NoError(t, f.repo.RestoreVersion(f.ctx, f.module.ID, published.Number, f.now))
	ex, as, err = f.repo.ExerciseSetups(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, string(exercises), string(ex))
	assert.JSONEq(t, string(assessment), string(as))
	require.NoError(t, f.repo.RestoreVersion(f.ctx, f.module.ID, 1, f.now))
	ex, as, err = f.repo.ExerciseSetups(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.Nil(t, ex)
	assert.Nil(t, as)
}

// Covers SPEC-023 CA-05, CA-06: the student reads the published exercises of the practice in the order of the trail, and never the
// reserved ones or the drafts as practice.
func TestExerciseBankForTheStudent(t *testing.T) {
	f := newBank(t)
	a, b, c, d := f.create(t, "A"), f.create(t, "B"), f.create(t, "C"), f.create(t, "D")
	for _, rec := range []service.ExerciseRecord{a, b, c} {
		_, err := f.repo.SetAvailability(f.ctx, f.module.ID, rec.ID, domain.UsageExercise, domain.StatusPublished, f.now)
		require.NoError(t, err)
	}
	_, err := f.repo.SetAvailability(f.ctx, f.module.ID, d.ID, domain.UsageAssessment, domain.StatusPublished, f.now)
	require.NoError(t, err)
	// The teacher puts C first, and B is taken back to draft.
	require.NoError(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: c.ID, Mandatory: true}, {ExerciseID: a.ID, Mandatory: true}, {ExerciseID: b.ID, Mandatory: true}}, f.now))
	_, err = f.repo.SetAvailability(f.ctx, f.module.ID, b.ID, domain.UsageExercise, domain.StatusDraft, f.now)
	require.NoError(t, err)

	practice, err := f.repo.ListQuestions(f.ctx, f.module.ID, domain.UsageExercise, false)
	require.NoError(t, err)
	titles := make([]string, len(practice))
	for i, q := range practice {
		titles[i] = q.Title
	}
	assert.Equal(t, []string{"C", "A"}, titles, "published and available, in the order of the trail")
}
