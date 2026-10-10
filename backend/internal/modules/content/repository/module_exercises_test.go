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

var (
	unlinked = service.ExerciseLinks{}
	practice = service.ExerciseLinks{Practice: true}
	both     = service.ExerciseLinks{Practice: true, Assessment: true}
)

// create puts an exercise in the bank with the links it is given, as the service does.
func (f bankFixture) create(t *testing.T, title string, links service.ExerciseLinks) service.ExerciseRecord {
	t.Helper()
	by := f.teacher.ID
	q := domain.Question{ID: uuid.New(), ModuleID: f.module.ID, Kind: domain.KindPractical, Usage: links.Usage(), InAssessment: links.Assessment, ExclusiveAssessment: links.Exclusive,
		Difficulty: "EASY", Status: domain.StatusDraft, Title: title, Statement: "<p>x</p>", Hints: json.RawMessage(`[]`),
		EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), ValidationConditions: json.RawMessage(`[{"type":"DIRECTORY_EXISTS","path":"/a"}]`),
		CreatedBy: &by, UpdatedBy: &by, CreatedAt: f.now, UpdatedAt: f.now}
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

// Covers SPEC-023 11.1: an exercise is created in the bank with the links it came with; being in the practice gives it the last place of the
// trail, and the same exercise can be in the practice and in the assessment.
func TestExerciseBankLinks(t *testing.T) {
	f := newBank(t)
	a := f.create(t, "A", unlinked)
	assert.Equal(t, "Ana Prof", a.CreatedByName)
	assert.Zero(t, a.Position, "not in the practice: no place in the trail")
	assert.Equal(t, unlinked, a.Links())

	b, c := f.create(t, "B", practice), f.create(t, "C", both)
	assert.Equal(t, 1, b.Position)
	assert.Equal(t, 2, c.Position)
	assert.Equal(t, both, c.Links(), "the same exercise in the practice and in the assessment")

	// Linking A to the practice gives it the last place; unlinking B closes the gap and keeps the order of the others.
	linked, err := f.repo.SetLinks(f.ctx, f.module.ID, a.ID, practice, domain.StatusPublished, f.now)
	require.NoError(t, err)
	assert.Equal(t, 3, linked.Position)
	assert.Equal(t, domain.StatusPublished, linked.Status)
	off, err := f.repo.SetLinks(f.ctx, f.module.ID, b.ID, service.ExerciseLinks{Assessment: true}, domain.StatusPublished, f.now)
	require.NoError(t, err)
	assert.Zero(t, off.Position)
	assert.Equal(t, service.ExerciseLinks{Assessment: true}, off.Links())
	assert.Equal(t, []string{"C", "A", "B"}, f.titles(t), "the ones in the practice in order, then the others; nothing left the bank")
	c2, _ := f.repo.FindExercise(f.ctx, f.module.ID, c.ID)
	a2, _ := f.repo.FindExercise(f.ctx, f.module.ID, a.ID)
	assert.Equal(t, []int{1, 2}, []int{c2.Position, a2.Position})

	// Exclusive to the assessment: the database does not accept it in the practice.
	exclusive, err := f.repo.SetLinks(f.ctx, f.module.ID, b.ID, service.ExerciseLinks{Assessment: true, Exclusive: true}, domain.StatusDraft, f.now)
	require.NoError(t, err)
	assert.True(t, exclusive.ExclusiveAssessment)
	_, err = f.repo.SetLinks(f.ctx, f.module.ID, b.ID, service.ExerciseLinks{Practice: true, Assessment: true, Exclusive: true}, domain.StatusDraft, f.now)
	assert.Error(t, err, "exclusive and in the practice")

	_, err = f.repo.SetLinks(f.ctx, f.module.ID, uuid.New(), practice, domain.StatusDraft, f.now)
	assert.ErrorIs(t, err, service.ErrExerciseNotFound)
}

// Covers SPEC-023 RN-03: the order and the obligation of the trail are set as the teacher says, and only with exactly the exercises in the practice.
func TestExerciseBankReorder(t *testing.T) {
	f := newBank(t)
	ids := map[string]uuid.UUID{}
	for _, title := range []string{"A", "B", "C"} {
		ids[title] = f.create(t, title, practice).ID
	}
	require.NoError(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: ids["C"], Mandatory: false}, {ExerciseID: ids["A"], Mandatory: true}, {ExerciseID: ids["B"], Mandatory: true}}, f.now))
	assert.Equal(t, []string{"C", "A", "B"}, f.titles(t))
	c, _ := f.repo.FindExercise(f.ctx, f.module.ID, ids["C"])
	assert.False(t, c.Mandatory)

	assert.ErrorIs(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: ids["A"]}}, f.now), service.ErrInvalidExerciseOrder, "a list that leaves one out")
	assert.ErrorIs(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: ids["A"]}, {ExerciseID: ids["B"]}, {ExerciseID: uuid.New()}}, f.now), service.ErrInvalidExerciseOrder, "a list with a stranger")
	assert.Equal(t, []string{"C", "A", "B"}, f.titles(t), "nothing changed")
}

// Covers SPEC-023 RN-05, CA-08: saving writes the fields, the dependency and the author, and detects a change by someone else.
func TestExerciseBankUpdate(t *testing.T) {
	f := newBank(t)
	a, before := f.create(t, "A", unlinked), f.create(t, "Antes", unlinked)
	clean, err := domain.NormalizeExercise(domain.ExerciseInput{Title: "A novo", Difficulty: "HARD", Statement: "<p>novo</p>",
		Hints:      json.RawMessage(`[{"text":"dica"}]`),
		Solution:   json.RawMessage(`{"steps":[{"command":"mkdir /b"}]}`),
		Conditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/b"}]`)}, domain.NewHTMLSanitizer())
	require.NoError(t, err)
	catalog, _ := json.Marshal(clean.Catalog)
	later := f.now.Add(time.Minute)

	saved, err := f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, service.ExerciseUpdate{Exercise: clean, Catalog: catalog, DependsOn: &before.ID, By: f.teacher.ID, Now: later}, &a.UpdatedAt)
	require.NoError(t, err)
	assert.Equal(t, "A novo", saved.Title)
	assert.Equal(t, "HARD", saved.Difficulty)
	assert.True(t, saved.UpdatedAt.Equal(later))
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /b"}]}`, string(saved.ReferenceSolution))
	assert.JSONEq(t, `[{"type":"DIRECTORY_EXISTS","path":"/b"}]`, string(saved.ValidationConditions))
	assert.Equal(t, "Ana Prof", saved.UpdatedByName)
	require.NotNil(t, saved.DependsOn)
	assert.Equal(t, before.ID, *saved.DependsOn)

	// The dependency goes back to none, and a second save with the instant the editor had before is a conflict unless it is not guarded.
	again := service.ExerciseUpdate{Exercise: clean, Catalog: catalog, By: f.teacher.ID, Now: later.Add(time.Minute)}
	_, err = f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, again, &a.UpdatedAt)
	assert.ErrorIs(t, err, service.ErrExerciseConflict)
	cleared, err := f.repo.UpdateExercise(f.ctx, f.module.ID, a.ID, again, nil)
	require.NoError(t, err)
	assert.Nil(t, cleared.DependsOn)
	_, err = f.repo.UpdateExercise(f.ctx, f.module.ID, uuid.New(), again, nil)
	assert.ErrorIs(t, err, service.ErrExerciseNotFound)
}

// Covers SPEC-023 D-16: an exercise can depend on another of the module, never on itself or on one that depends on it.
func TestExerciseBankValidDependency(t *testing.T) {
	f := newBank(t)
	a, b, c := f.create(t, "A", practice), f.create(t, "B", practice), f.create(t, "C", unlinked)
	valid := func(id *uuid.UUID, on uuid.UUID) bool {
		ok, err := f.repo.ValidDependency(f.ctx, f.module.ID, id, on)
		require.NoError(t, err)
		return ok
	}
	assert.True(t, valid(nil, a.ID), "a new exercise can depend on any exercise of the module")
	assert.True(t, valid(&b.ID, a.ID))
	assert.False(t, valid(&a.ID, a.ID), "not on itself")
	assert.False(t, valid(nil, uuid.New()), "not on one that is not there")

	// B depends on A, C on B: A cannot depend on C (a cycle of three), nor on B.
	for _, link := range []struct{ id, on uuid.UUID }{{b.ID, a.ID}, {c.ID, b.ID}} {
		require.NoError(t, f.db.Conn(f.ctx).Exec("UPDATE questions SET depends_on = ? WHERE id = ?", link.on, link.id).Error)
	}
	assert.False(t, valid(&a.ID, b.ID))
	assert.False(t, valid(&a.ID, c.ID))
	assert.True(t, valid(&c.ID, a.ID), "a longer chain without a cycle is fine")

	other := newBank(t)
	ok, err := other.repo.ValidDependency(other.ctx, other.module.ID, nil, a.ID)
	require.NoError(t, err)
	assert.False(t, ok, "an exercise of another module")
}

// Covers SPEC-023 RN-09: removing an exercise takes it out of the bank, of the trail and of the dependencies on it, and erases the progress of the
// students in it.
func TestExerciseBankDelete(t *testing.T) {
	f := newBank(t)
	a, b := f.create(t, "A", practice), f.create(t, "B", practice)
	require.NoError(t, f.db.Conn(f.ctx).Exec("UPDATE questions SET depends_on = ? WHERE id = ?", a.ID, b.ID).Error)
	student := userdomain.User{Email: "aluno@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, userrepository.New(f.db).Create(f.ctx, &student))
	require.NoError(t, f.db.Conn(f.ctx).Exec(`INSERT INTO exercise_progress (id, user_id, question_id, attempts, last_passed, completed_at, created_at, updated_at)
        VALUES (gen_random_uuid(), ?, ?, 1, true, now(), now(), now())`, student.ID, a.ID).Error)

	require.NoError(t, f.repo.DeleteExercise(f.ctx, f.module.ID, a.ID, f.now))
	assert.Equal(t, []string{"B"}, f.titles(t))
	b2, _ := f.repo.FindExercise(f.ctx, f.module.ID, b.ID)
	assert.Equal(t, 1, b2.Position, "the trail is numbered again")
	assert.Nil(t, b2.DependsOn, "what depended on it is free")
	var left int64
	require.NoError(t, f.db.Conn(f.ctx).Table("exercise_progress").Where("question_id = ?", a.ID).Count(&left).Error)
	assert.Zero(t, left)
	_, err := f.repo.FindExercise(f.ctx, f.module.ID, a.ID)
	assert.ErrorIs(t, err, service.ErrExerciseNotFound)
	assert.ErrorIs(t, f.repo.DeleteExercise(f.ctx, f.module.ID, a.ID, f.now), service.ErrExerciseNotFound)
}

// Covers SPEC-023 11.2, D-07: the bank has one snapshot, and a published version freezes it and restores it.
func TestBankSetupInVersions(t *testing.T) {
	f := newBank(t)
	setup, err := f.repo.BankSetup(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.Nil(t, setup)

	changed := func() bool { _, changed, err := f.repo.ListVersions(f.ctx, f.module.ID); require.NoError(t, err); return changed }
	assert.False(t, changed(), "a module without the snapshot keeps the hash of its first version")

	bank := json.RawMessage(`{"steps":[{"command":"mkdir /banco"}]}`)
	require.NoError(t, f.repo.SaveBankSetup(f.ctx, f.module.ID, bank))
	setup, err = f.repo.BankSetup(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, string(bank), string(setup))
	assert.True(t, changed(), "the snapshot is part of the draft")

	published, err := f.repo.PublishVersion(f.ctx, f.module.ID, f.teacher.ID, "com ambiente")
	require.NoError(t, err)
	var frozen domain.VersionContent
	require.NoError(t, json.Unmarshal(published.Content, &frozen))
	assert.JSONEq(t, string(bank), string(frozen.BankSetupOrNil()))

	// The draft moves on; restoring the first version (which had none) clears it, and restoring the published one brings it back.
	require.NoError(t, f.repo.SaveBankSetup(f.ctx, f.module.ID, nil))
	require.NoError(t, f.repo.RestoreVersion(f.ctx, f.module.ID, published.Number, f.now))
	setup, err = f.repo.BankSetup(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.JSONEq(t, string(bank), string(setup))
	require.NoError(t, f.repo.RestoreVersion(f.ctx, f.module.ID, 1, f.now))
	setup, err = f.repo.BankSetup(f.ctx, f.module.ID)
	require.NoError(t, err)
	assert.Nil(t, setup)
}

// Covers SPEC-023 CA-05, CA-06: the student reads the published exercises of the practice in the order of the trail, and never the ones that
// are only in the assessment, or the drafts, as practice.
func TestExerciseBankForTheStudent(t *testing.T) {
	f := newBank(t)
	a, b, c, d := f.create(t, "A", practice), f.create(t, "B", practice), f.create(t, "C", practice), f.create(t, "D", unlinked)
	for _, rec := range []service.ExerciseRecord{a, b, c} {
		_, err := f.repo.SetLinks(f.ctx, f.module.ID, rec.ID, practice, domain.StatusPublished, f.now)
		require.NoError(t, err)
	}
	_, err := f.repo.SetLinks(f.ctx, f.module.ID, d.ID, service.ExerciseLinks{Assessment: true, Exclusive: true}, domain.StatusPublished, f.now)
	require.NoError(t, err)
	// The teacher puts C first, and B is taken back to draft.
	require.NoError(t, f.repo.ReorderExercises(f.ctx, f.module.ID, []service.OrderItem{{ExerciseID: c.ID, Mandatory: true}, {ExerciseID: a.ID, Mandatory: true}, {ExerciseID: b.ID, Mandatory: true}}, f.now))
	_, err = f.repo.SetLinks(f.ctx, f.module.ID, b.ID, practice, domain.StatusDraft, f.now)
	require.NoError(t, err)

	practiced, err := f.repo.ListQuestions(f.ctx, f.module.ID, domain.UsageExercise, false)
	require.NoError(t, err)
	titles := make([]string, len(practiced))
	for i, q := range practiced {
		titles[i] = q.Title
	}
	assert.Equal(t, []string{"C", "A"}, titles, "published and in the practice, in the order of the trail")
}
