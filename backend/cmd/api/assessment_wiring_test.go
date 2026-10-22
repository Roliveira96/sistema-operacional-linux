package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	assessmentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	assessmentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/repository"
	assessmentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	classgroupdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classgrouprepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	classgroupservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/service"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/repository"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	coursemoduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	coursemodulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	schedulerepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/repository"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

// Covers SPEC-075 as a whole, with the real services of the other modules and a real PostgreSQL: the adapters of assessment_refs.go, wired as in
// main.go, give the assessments the class, its students, the lesson, the module and the bank; the calendar of the schedule carries the assessment;
// and the bank of questions refuses to delete a question that a scheduled assessment lists. It is the only test that proves the wiring.
func TestAssessmentsWiredLikeTheComposition(t *testing.T) {
	db := dbtest.Open(t)

	users := userrepository.New(db)
	tname, sname := "Profa. Sediane", "Ana"
	teacher := userdomain.User{Name: &tname, Email: "prof@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(ctx, &teacher))
	ra := "1000001"
	student := userdomain.User{Name: &sname, Email: "ana@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, users.Create(ctx, &student))

	classRepo := classgrouprepository.New(db)
	now := time.Now()
	class := classgroupdomain.ClassGroup{TeacherID: teacher.ID, Name: "SO", CourseCode: "SO34E", Semester: "2026/2",
		StartDate: now.AddDate(0, 0, -10), EndDate: now.AddDate(0, 0, 60), Status: classgroupdomain.ClassStatusActive}
	require.NoError(t, classRepo.CreateClass(ctx, &class, []uuid.UUID{student.ID}, now))

	moduleRepo := coursemodulerepository.New(db)
	module := coursemoduledomain.CourseModule{TeacherID: teacher.ID, Title: "Permissões", Description: "d", Visibility: coursemoduledomain.VisibilityPublic, Status: coursemoduledomain.ModuleStatusActive}
	require.NoError(t, moduleRepo.CreateModule(ctx, &module, []uuid.UUID{class.ID}, teacher.ID))

	contentRepo := contentrepository.New(db)
	var questionIDs []uuid.UUID
	for i, title := range []string{"Criar a pasta", "Apagar a pasta", "Mudar a permissão"} {
		by := teacher.ID
		q := contentdomain.Question{ID: uuid.New(), ModuleID: module.ID, Kind: contentdomain.KindPractical, Usage: contentdomain.UsageAssessment, InAssessment: true,
			Difficulty: "EASY", Status: contentdomain.StatusPublished, Title: title, Statement: "<p>" + title + "</p>", Hints: json.RawMessage(`[]`),
			EndConditions: json.RawMessage(`[{"kind":"DIR_EXISTS","path":"/a"}]`), ValidationConditions: json.RawMessage(`[{"type":"DIRECTORY_EXISTS","path":"/a"}]`),
			ReferenceSolution: json.RawMessage(`{"steps":[{"command":"mkdir /a"}]}`), CreatedBy: &by, UpdatedBy: &by, CreatedAt: now, UpdatedAt: now}
		require.NoError(t, contentRepo.CreateExercise(ctx, &q), i)
		questionIDs = append(questionIDs, q.ID)
	}

	tomorrow := time.Date(now.In(assessmentdomain.Location()).Year(), now.In(assessmentdomain.Location()).Month(), now.In(assessmentdomain.Location()).Day()+1, 0, 0, 0, 0, assessmentdomain.Location())
	lesson := uuid.New()
	require.NoError(t, db.Conn(ctx).Exec(`INSERT INTO class_sessions (id, class_id, date, start_time, end_time, lesson_count, mode, status, origin, topic, module_id, created_at, updated_at)
		VALUES (?, ?, ?, '09:00', '11:00', 2, 'IN_PERSON', 'SCHEDULED', 'EXTRA', 'Permissões e donos', ?, now(), now())`, lesson, class.ID, tomorrow, module.ID).Error)

	// the wiring of main.go, with the real services
	classService := classgroupservice.New(classRepo)
	scheduleService := scheduleservice.New(schedulerepository.New(db), time.Now, "http://lab.example")
	moduleService := coursemoduleservice.New(moduleRepo)
	contentReader := contentservice.NewReader(moduleService, contentRepo)
	contentExercises := contentservice.NewExercises(contentRepo, zap.NewNop())
	people := assessmentClasses{classes: classService}
	assessments := assessmentservice.New(assessmentrepository.New(db), assessmentservice.Ports{
		Classes: people, Students: people, Users: people,
		Lessons: assessmentLessons{schedule: scheduleService}, Modules: assessmentModules{modules: moduleService},
		Questions: assessmentQuestions{bank: contentExercises, questions: contentReader}, Homologation: noHomologation{}, Attempts: noAttempts{},
	}, time.Now)
	scheduleService.WithAssessments(scheduleAssessments{assessments: assessments})
	contentExercises.WithAssessmentUse(assessments)

	owner := assessmentservice.Actor{UserID: teacher.ID, Role: authn.RoleTeacher}
	pupil := assessmentservice.Actor{UserID: student.ID, Role: authn.RoleStudent}
	weights := assessmentdomain.EqualWeights(assessmentdomain.Points(10), 3)

	// the assessment is made from the lesson: its time, topic and module come from it
	created, err := assessments.Create(ctx, owner, class.ID, assessmentservice.CreateInput{
		ClassSessionID: &lesson, Type: assessmentdomain.TypeExam, MaxScore: assessmentdomain.Points(10), Composition: assessmentdomain.CompositionManual,
		Items: []assessmentdomain.Item{
			{QuestionID: questionIDs[0], Weight: weights[0]}, {QuestionID: questionIDs[1], Weight: weights[1]}, {QuestionID: questionIDs[2], Weight: weights[2]},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "Permissões e donos", created.Title, "the topic of the lesson")
	assert.Equal(t, "Permissões", created.ModuleTitle, "the module read through the module service")
	assert.Equal(t, 3, created.TotalQuestions)
	assert.Equal(t, 1, created.EligibleStudents, "the students read through the class service")
	assert.Equal(t, "Profa. Sediane", created.CreatedByName, "the names read through the class service")
	assert.True(t, created.StartsAt.Equal(tomorrow.Add(9*time.Hour)), "the date and the start time of the lesson, in Brasília")

	// SPEC-076, SPEC-083: an exam is in person and requires the clearance, the student waits for it, and the teacher only decides it after she starts
	// the exam, which cannot happen before its day
	assert.Equal(t, assessmentdomain.ModalityInPerson, created.Modality)
	assert.True(t, created.RequiresClearance)
	assert.Equal(t, assessmentservice.ClearanceCounts{Pending: 1}, created.ClearanceCounts)
	waiting, err := assessments.MyAccess(ctx, pupil, class.ID, created.ID)
	require.NoError(t, err)
	assert.Equal(t, assessmentdomain.AccessNotOpenYet, waiting.Reason)
	require.NotNil(t, waiting.Clearance)
	assert.Equal(t, assessmentdomain.ClearancePending, waiting.Clearance.Status)
	_, err = assessments.Decide(ctx, owner, class.ID, created.ID, assessmentservice.ClearanceInput{Action: assessmentservice.ClearanceApproveAll})
	require.ErrorIs(t, err, assessmentdomain.ErrAssessmentNotStarted, "the clearance waits for the teacher to start the exam")
	_, err = assessments.Start(ctx, owner, class.ID, created.ID)
	require.ErrorIs(t, err, assessmentdomain.ErrAssessmentNotOpenYet, "and she cannot start it before its day")
	list, err := assessments.Clearances(ctx, owner, class.ID, created.ID)
	require.NoError(t, err, "the list is read before the start")
	assert.Equal(t, assessmentservice.ClearanceCounts{Pending: 1}, list.Counts)
	assert.Equal(t, "Ana", list.Items[0].Name, "the names read through the class service")

	// the student sees it, in the public form; the teacher sees the detail with the questions and the history
	public, err := assessments.Public(ctx, pupil, class.ID, created.ID)
	require.NoError(t, err)
	assert.Equal(t, created.ID, public.ID)
	detail, err := assessments.Detail(ctx, owner, class.ID, created.ID)
	require.NoError(t, err)
	require.Len(t, detail.Items, 3)
	assert.Equal(t, "Criar a pasta", detail.Items[0].Title, "the title of the question, read through the content services")
	require.Len(t, detail.Events, 1, "only the creation: the clearance and the start did not happen")
	assert.Equal(t, "Profa. Sediane", detail.Events[0].ActorName)
	preview, err := assessments.Preview(ctx, owner, class.ID, created.ID)
	require.NoError(t, err)
	require.Len(t, preview.Questions, 3)
	assert.JSONEq(t, `{"steps":[{"command":"mkdir /a"}]}`, preview.Questions[0].AnswerKey, "the reference solution of a practical question")

	// the calendar of the schedule carries it, for the teacher with the count and for the student without
	from, to := tomorrow.AddDate(0, 0, -1), tomorrow.AddDate(0, 0, 1)
	calendar, err := scheduleService.ClassCalendar(ctx, scheduleservice.Actor{UserID: teacher.ID, Role: authn.RoleTeacher}, class.ID, from, to)
	require.NoError(t, err)
	require.Len(t, calendar.Assessments, 1)
	require.NotNil(t, calendar.Assessments[0].EligibleStudents)
	assert.Equal(t, 1, *calendar.Assessments[0].EligibleStudents)
	studentCalendar, err := scheduleService.ClassCalendar(ctx, scheduleservice.Actor{UserID: student.ID, Role: authn.RoleStudent}, class.ID, from, to)
	require.NoError(t, err)
	require.Len(t, studentCalendar.Assessments, 1)
	assert.Nil(t, studentCalendar.Assessments[0].EligibleStudents, "the student never gets the teacher's data")
	assert.Nil(t, studentCalendar.Assessments[0].Composition)

	// the bank of questions keeps what the scheduled assessment lists
	err = contentExercises.Delete(ctx, contentservice.Actor{UserID: teacher.ID, Role: authn.RoleTeacher}, module.ID, questionIDs[0])
	assert.ErrorIs(t, err, contentservice.ErrQuestionInUse)

	// canceled, the assessment frees the question and the lesson
	_, err = assessments.Cancel(ctx, owner, class.ID, created.ID, "Falta de energia")
	require.NoError(t, err)
	assert.NoError(t, contentExercises.Delete(ctx, contentservice.Actor{UserID: teacher.ID, Role: authn.RoleTeacher}, module.ID, questionIDs[0]))
}
