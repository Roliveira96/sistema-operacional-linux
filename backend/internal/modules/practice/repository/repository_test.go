package repository_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/seed/data"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	userservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

type fixtures struct {
	Snapshots map[string]json.RawMessage `json:"snapshots"`
	Questions []struct {
		SourceKey string `json:"sourceKey"`
		Cases     []struct {
			Label        string `json:"label"`
			SnapshotHash string `json:"snapshotHash"`
		} `json:"cases"`
	} `json:"questions"`
}

// Covers SPEC-014 CA-02, CA-03, CA-04 and CA-06 against PostgreSQL with the
// real content: the reference solution passes and the untouched scenario fails.
func TestPracticeEndToEnd(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()

	admin := userdomain.User{Email: "admin@rmo.dev.br", Role: userdomain.RoleAdmin, Status: userdomain.StatusActive}
	users := userrepository.New(db)
	require.NoError(t, users.Create(ctx, &admin))
	studentUser := userdomain.User{Email: "aluno@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(ctx, &studentUser))

	modules := cmservice.New(cmrepository.New(db))
	manifest, err := contentservice.ReadManifest(bytes.NewReader(data.Manifest))
	require.NoError(t, err)
	_, err = contentservice.NewSeeder(cmservice.NewSeeder(cmrepository.New(db)), userservice.New(users),
		contentrepository.New(db), db, zap.NewNop()).Run(ctx, manifest, admin.Email)
	require.NoError(t, err)

	reader := contentservice.NewReader(modules, contentrepository.New(db))
	repo := repository.New(db)
	svc := service.New(reader, repo)

	f, err := os.Open("../../content/seed/data/equivalence_fixtures.json.gz")
	require.NoError(t, err)
	defer f.Close()
	gz, err := gzip.NewReader(f)
	require.NoError(t, err)
	var fx fixtures
	require.NoError(t, json.NewDecoder(gz).Decode(&fx))
	states := map[string]map[string]json.RawMessage{}
	for _, q := range fx.Questions {
		states[q.SourceKey] = map[string]json.RawMessage{}
		for _, c := range q.Cases {
			states[q.SourceKey][c.Label] = fx.Snapshots[c.SnapshotHash]
		}
	}

	id := func(sourceKey string) uuid.UUID {
		var raw string
		require.NoError(t, db.Conn(ctx).Table("questions").Select("id").Where("source_key = ?", sourceKey).Scan(&raw).Error)
		return uuid.MustParse(raw)
	}
	sid := studentUser.ID
	viewer := contentservice.Viewer{UserID: &sid, Role: "STUDENT"}

	// A published exercise of a public module: dir-1 (directories topic).
	question := id("dir-1")
	snapshot, err := svc.Scenario(ctx, question, contentservice.Viewer{})
	require.NoError(t, err, "visitors can open the scenario of a public module")
	assert.NotContains(t, string(snapshot), "validationConditions")

	r, err := svc.Check(ctx, question, viewer, states["dir-1"]["scenario"])
	require.NoError(t, err)
	assert.False(t, r.Passed, "the untouched scenario fails")
	r, err = svc.Check(ctx, question, viewer, states["dir-1"]["reference"])
	require.NoError(t, err)
	assert.True(t, r.Passed, "the reference solution passes")
	require.NotNil(t, r.CompletedAt)
	r, err = svc.Check(ctx, question, viewer, states["dir-1"]["scenario"])
	require.NoError(t, err)
	assert.NotNil(t, r.CompletedAt, "CA-04: a later failure keeps the completion")

	var moduleID string
	require.NoError(t, db.Conn(ctx).Table("questions").Select("module_id").Where("id = ?", question).Scan(&moduleID).Error)
	progress, err := svc.ModuleProgress(ctx, uuid.MustParse(moduleID), viewer)
	require.NoError(t, err)
	require.Len(t, progress, 1)
	assert.Equal(t, 3, progress[0].Attempts)

	// SPEC-035: a true or false question of the practice of the same module, answered once (CA-09, CA-10, CA-17).
	trueFalse := uuid.New()
	require.NoError(t, db.Conn(ctx).Exec(`INSERT INTO questions (id, module_id, kind, usage, difficulty, status, title, statement, answer_key, explanation, created_at, updated_at)
        VALUES (?, ?, 'THEORETICAL_BOOLEAN', 'EXERCISE', 'EASY', 'PUBLISHED', 'rm -r', '<p>rm -r removes non-empty directories.</p>', '{"correct":true}', '<p>It is recursive.</p>', NOW(), NOW())`,
		trueFalse, moduleID).Error)
	r, err = svc.Submit(ctx, trueFalse, viewer, service.Submission{Response: json.RawMessage(`{"value":false}`)})
	require.NoError(t, err)
	assert.False(t, r.Passed)
	assert.JSONEq(t, "true", string(r.Correct))
	require.NotNil(t, r.CompletedAt, "D-13: answered is done, right or wrong")
	_, err = svc.Submit(ctx, trueFalse, viewer, service.Submission{Response: json.RawMessage(`{"value":true}`)})
	assert.ErrorIs(t, err, service.ErrAlreadyAnswered, "CA-17: the first answer stays")

	progress, err = svc.ModuleProgress(ctx, uuid.MustParse(moduleID), viewer)
	require.NoError(t, err)
	require.Len(t, progress, 2)
	for _, p := range progress {
		if p.QuestionID == trueFalse {
			assert.JSONEq(t, `{"value":false}`, string(p.Response))
			assert.False(t, p.LastPassed)
			assert.Equal(t, 1, p.Attempts)
			assert.JSONEq(t, "true", string(p.Correct))
		}
	}

	// Two answers at the same time: only one is stored, the other is refused.
	raced := uuid.New()
	require.NoError(t, db.Conn(ctx).Exec(`INSERT INTO questions (id, module_id, kind, usage, difficulty, status, title, statement, answer_key, created_at, updated_at)
        VALUES (?, ?, 'THEORETICAL_BOOLEAN', 'EXERCISE', 'EASY', 'PUBLISHED', 'race', '<p>x</p>', '{"correct":false}', NOW(), NOW())`, raced, moduleID).Error)
	errs := make(chan error, 2)
	for _, value := range []bool{true, false} {
		go func(value bool) {
			p := domain.Progress{ID: uuid.New(), UserID: sid, QuestionID: raced}
			raw, _ := json.Marshal(map[string]bool{"value": value})
			p.Answer(raw, !value, time.Now())
			errs <- repo.SaveResponse(ctx, &p)
		}(value)
	}
	first, second := <-errs, <-errs
	assert.True(t, (first == nil) != (second == nil), "exactly one answer is stored: %v, %v", first, second)
	assert.True(t, errors.Is(first, service.ErrAlreadyAnswered) || errors.Is(second, service.ErrAlreadyAnswered))

	// SPEC-035: a dependency is only between practical questions.
	err = db.Conn(ctx).Exec("UPDATE questions SET depends_on = ? WHERE id = ?", question, trueFalse).Error
	assert.Error(t, err, "a true or false question cannot depend on another one")

	// CA-06: assessment questions are not served for practice.
	_, err = svc.Scenario(ctx, id("bas-fac-1"), viewer)
	assert.ErrorIs(t, err, contentservice.ErrQuestionNotFound)
}
