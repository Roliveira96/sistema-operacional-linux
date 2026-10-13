package repository_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

func namePtr(s string) *string { return &s }

// Covers SPEC-039 RN-03 to RN-07, CA-03, CA-06, CA-07 and CA-09 against PostgreSQL: a descriptive answer, the suggestion, the
// confirmation and the revision, the history that is never changed, and the bands enforced by the database.
func TestDescriptiveAnswerCorrection(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	users := userrepository.New(db)
	teacher := userdomain.User{Name: namePtr("Ana Prof"), Email: "ana@example.com", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(ctx, &teacher))
	student := userdomain.User{Name: namePtr("Bia Aluna"), Email: "bia@example.com", Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(ctx, &student))
	module := cmdomain.CourseModule{TeacherID: teacher.ID, Title: "M", Description: "d", Visibility: cmdomain.VisibilityPublic, Status: cmdomain.ModuleStatusActive}
	require.NoError(t, cmrepository.New(db).CreateModule(ctx, &module, nil, teacher.ID))

	exercises := contentservice.NewExercises(contentrepository.New(db), zap.NewNop())
	who := contentservice.Actor{UserID: teacher.ID, Role: "TEACHER"}
	size := 500
	q, err := exercises.Create(ctx, who, module.ID, contentdomainInput(size), nil, contentservice.ExerciseLinks{Practice: true})
	require.NoError(t, err)
	_, err = exercises.SetLinks(ctx, who, module.ID, q.ID, contentservice.ExerciseLinks{Practice: true}, "PUBLISHED")
	require.NoError(t, err)

	repo := repository.New(db)
	practice := service.New(contentservice.NewReader(cmservice.New(cmrepository.New(db)), contentrepository.New(db)), repo)
	sid := student.ID
	viewer := contentservice.Viewer{UserID: &sid, Role: "STUDENT"}
	r, err := practice.Submit(ctx, q.ID, viewer, service.Submission{Response: json.RawMessage(`{"html":"<p>Owner rwx: <code>chmod 750</code></p>"}`)})
	require.NoError(t, err)
	assert.True(t, r.Pending)

	grading := service.NewGrading(repo, exercises)
	pending, err := grading.List(ctx, who, module.ID, domain.StatusPending)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	answer := pending[0]
	assert.Equal(t, "Bia Aluna", answer.StudentName)
	assert.JSONEq(t, `{"html":"<p>Owner rwx: <code>chmod 750</code></p>"}`, string(answer.Progress.Response))
	assert.Equal(t, "<p>rwx r-x ---</p>", answer.ExpectedAnswer)

	require.NoError(t, grading.Suggest(ctx, who, answer.Progress.ID, 75, "missed the others", "Almost."))
	suggested, err := grading.List(ctx, who, module.ID, domain.StatusSuggested)
	require.NoError(t, err)
	require.Len(t, suggested, 1)
	assert.Equal(t, 75, *suggested[0].Grade.SuggestedScore)

	_, err = grading.Confirm(ctx, who, answer.Progress.ID, domain.GradeInput{UseSuggestion: true, StudentNote: "Almost.", PrivateNote: "kind"})
	require.NoError(t, err)
	_, err = grading.Confirm(ctx, who, answer.Progress.ID, domain.GradeInput{Score: intPtr(100), Reason: "reread", StudentNote: "Complete.", PrivateNote: "kind"})
	require.NoError(t, err)
	graded, err := grading.Get(ctx, who, answer.Progress.ID)
	require.NoError(t, err)
	assert.Equal(t, 100, *graded.Grade.Score)
	assert.Equal(t, domain.SourceTeacher, *graded.Grade.Source)
	assert.Equal(t, "kind", stringOr(graded.Grade.PrivateNote))

	var kinds []string
	require.NoError(t, db.Conn(ctx).Raw("SELECT kind FROM answer_grade_events WHERE grade_id = ? ORDER BY created_at, kind", graded.Grade.ID).Scan(&kinds).Error)
	assert.ElementsMatch(t, []string{"SUGGESTED", "CONFIRMED", "REVISED"}, kinds)
	assert.Error(t, db.Conn(ctx).Exec("UPDATE answer_grade_events SET score = 0 WHERE grade_id = ?", graded.Grade.ID).Error, "the history is never changed")
	assert.Error(t, db.Conn(ctx).Exec("DELETE FROM answer_grade_events WHERE grade_id = ?", graded.Grade.ID).Error, "nor removed")
	assert.Error(t, db.Conn(ctx).Exec("UPDATE answer_grades SET score = 60 WHERE id = ?", graded.Grade.ID).Error, "only the five bands")

	// The student sees the grade and the note to her, never the private note.
	progress, err := practice.ModuleProgress(ctx, module.ID, viewer)
	require.NoError(t, err)
	require.Len(t, progress, 1)
	assert.Equal(t, domain.StatusGraded, progress[0].AnswerStatus)
	assert.Equal(t, 100, *progress[0].Score)
	assert.Equal(t, "Complete.", *progress[0].StudentNote)

	_, err = grading.Get(ctx, who, uuid.New())
	assert.ErrorIs(t, err, service.ErrAnswerNotFound)
	all, err := grading.List(ctx, who, module.ID, "")
	require.NoError(t, err)
	assert.Len(t, all, 1)
}

func intPtr(v int) *int { return &v }

func stringOr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func contentdomainInput(size int) contentdomain.ExerciseInput {
	return contentdomain.ExerciseInput{Kind: contentdomain.KindDiscursive, Title: "chmod", Difficulty: "EASY", Statement: "<p>Explain chmod 750.</p>",
		ExpectedAnswer: "<p>rwx r-x ---</p>", MaxLength: &size}
}
