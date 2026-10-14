package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	classdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/domain"
	classrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classgroup/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/repository"
	userdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/domain"
	userrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/user/repository"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database/dbtest"
)

type env struct {
	ctx     context.Context
	db      *database.DB
	repo    *repository.Repository
	users   *userrepository.Repository
	teacher userdomain.User
	student userdomain.User
	class   classdomain.ClassGroup
	now     time.Time
}

func newEnv(t *testing.T) env {
	t.Helper()
	db := dbtest.Open(t)
	e := env{ctx: context.Background(), db: db, repo: repository.New(db), users: userrepository.New(db), now: time.Now().UTC().Truncate(time.Microsecond)}
	name := "Profa. Sediane"
	e.teacher = userdomain.User{Name: &name, Email: "prof@utfpr.edu.br", Role: userdomain.RoleTeacher, Status: userdomain.StatusActive}
	require.NoError(t, e.users.Create(e.ctx, &e.teacher))
	e.student = e.newStudent(t, "1000001", "Ana")
	e.class = e.newClass(t, "SO34E", e.student.ID)
	return e
}

func (e env) newStudent(t *testing.T, ra, name string) userdomain.User {
	t.Helper()
	u := userdomain.User{Name: &name, Email: ra + "@alunos.utfpr.edu.br", AcademicID: &ra, Role: userdomain.RoleStudent, Status: userdomain.StatusActive}
	require.NoError(t, e.users.Create(e.ctx, &u))
	return u
}

func (e env) newClass(t *testing.T, code string, students ...uuid.UUID) classdomain.ClassGroup {
	t.Helper()
	c := classdomain.ClassGroup{TeacherID: e.teacher.ID, Name: "SO", CourseCode: code, Semester: "2026/2",
		StartDate: e.now, EndDate: e.now.Add(90 * 24 * time.Hour), Status: classdomain.ClassStatusActive}
	require.NoError(t, classrepository.New(e.db).CreateClass(e.ctx, &c, students, e.now))
	return c
}

func (e env) session(class uuid.UUID, started time.Time) domain.LiveClassroomSession {
	return domain.LiveClassroomSession{ClassID: class, TeacherID: e.teacher.ID, Title: "Aula", DisplayMode: domain.ModeSlides,
		CurrentSlide: 1, Status: domain.StatusActive, StartedAt: started}
}

// Covers SPEC-051 CA-17 and RN-01: one active room per class, kept by the database.
func TestOnlyOneActiveSessionPerClass(t *testing.T) {
	e := newEnv(t)
	first := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &first))
	assert.NotEqual(t, uuid.Nil, first.ID)

	second := e.session(e.class.ID, e.now.Add(time.Minute))
	assert.ErrorIs(t, e.repo.CreateSession(e.ctx, &second), domain.ErrActiveSessionExists)

	otherClass := e.newClass(t, "SO99X")
	third := e.session(otherClass.ID, e.now)
	assert.NoError(t, e.repo.CreateSession(e.ctx, &third), "another class has its own room")

	active, err := e.repo.FindActiveSession(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Equal(t, first.ID, active.ID)

	// An ended room frees the class for a new one.
	first.End(e.now.Add(time.Hour))
	require.NoError(t, e.repo.SaveSession(e.ctx, &first))
	_, err = e.repo.FindActiveSession(e.ctx, e.class.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	fourth := e.session(e.class.ID, e.now.Add(2*time.Hour))
	assert.NoError(t, e.repo.CreateSession(e.ctx, &fourth))
}

// Covers SPEC-051 CA-18: the list has the open room first and then the ended ones, newest first.
func TestListSessionsOrderAndLimit(t *testing.T) {
	e := newEnv(t)
	old := e.session(e.class.ID, e.now.Add(-48*time.Hour))
	old.End(e.now.Add(-47 * time.Hour))
	newer := e.session(e.class.ID, e.now.Add(-24*time.Hour))
	newer.End(e.now.Add(-23 * time.Hour))
	open := e.session(e.class.ID, e.now)
	for _, s := range []*domain.LiveClassroomSession{&old, &newer, &open} {
		require.NoError(t, e.repo.CreateSession(e.ctx, s))
	}

	list, err := e.repo.ListSessions(e.ctx, e.class.ID, 50)
	require.NoError(t, err)
	require.Len(t, list, 3)
	assert.Equal(t, []uuid.UUID{open.ID, newer.ID, old.ID}, []uuid.UUID{list[0].ID, list[1].ID, list[2].ID})

	limited, err := e.repo.ListSessions(e.ctx, e.class.ID, 2)
	require.NoError(t, err)
	assert.Len(t, limited, 2)

	all, err := e.repo.ListActiveSessions(e.ctx)
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.Equal(t, open.ID, all[0].ID)
}

// Covers SPEC-051 RN-02 and RN-03: touching a room renews the moment the safety net counts from; a missing room is not found.
func TestTouchAndFind(t *testing.T) {
	e := newEnv(t)
	s := e.session(e.class.ID, e.now.Add(-5*time.Hour))
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	later := e.now.Add(-time.Hour)
	require.NoError(t, e.repo.TouchSession(e.ctx, s.ID, later))
	got, err := e.repo.FindSession(e.ctx, s.ID)
	require.NoError(t, err)
	assert.WithinDuration(t, later, got.UpdatedAt, time.Millisecond)

	_, err = e.repo.FindSession(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
}

// Covers SPEC-051 CA-03 and CA-04: the decks of a class are counted without the deleted ones; the pages are 1 to 100.
func TestDecks(t *testing.T) {
	e := newEnv(t)
	deck := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "Slides", ObjectKey: "classes/x/decks/a.pdf", PageCount: 12}
	require.NoError(t, e.repo.CreateDeck(e.ctx, &deck))
	other := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "Outro", ObjectKey: "classes/x/decks/b.pdf", PageCount: 1}
	require.NoError(t, e.repo.CreateDeck(e.ctx, &other))

	n, err := e.repo.CountDecks(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)
	got, err := e.repo.FindDeck(e.ctx, deck.ID)
	require.NoError(t, err)
	assert.Equal(t, 12, got.PageCount)
	assert.Equal(t, "classes/x/decks/a.pdf", got.ObjectKey)
	_, err = e.repo.FindDeck(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrDeckNotFound)

	require.NoError(t, e.db.Conn(e.ctx).Delete(&domain.SlideDeck{}, "id = ?", other.ID).Error)
	n, _ = e.repo.CountDecks(e.ctx, e.class.ID)
	assert.EqualValues(t, 1, n, "a deleted deck is not counted")

	bad := domain.SlideDeck{ClassID: e.class.ID, UploadedBy: e.teacher.ID, Title: "Zero", ObjectKey: "k", PageCount: 0}
	assert.Error(t, e.repo.CreateDeck(e.ctx, &bad), "the database also refuses 0 pages")
	bad.PageCount = 101
	assert.Error(t, e.repo.CreateDeck(e.ctx, &bad))
}

// Covers SPEC-051 CA-08 and CA-09: the queue is FIFO with the names, a raised hand is not duplicated, and a resolved one can be raised again.
func TestHandRaises(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))

	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, bruno.ID, e.now.Add(time.Second)))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, e.now.Add(2*time.Second)))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, bruno.ID, e.now.Add(3*time.Second)), "again: nothing new")

	queue, err := e.repo.ListHandRaises(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, queue, 2)
	assert.Equal(t, "Bruno", queue[0].Name)
	assert.Equal(t, bruno.ID, queue[0].StudentID)
	assert.Equal(t, "Ana", queue[1].Name)

	require.NoError(t, e.repo.ResolveHand(e.ctx, s.ID, bruno.ID, domain.HandAnswered, e.now.Add(time.Minute)))
	queue, _ = e.repo.ListHandRaises(e.ctx, s.ID)
	require.Len(t, queue, 1)
	assert.Equal(t, "Ana", queue[0].Name)

	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, bruno.ID, e.now.Add(2*time.Minute)))
	queue, _ = e.repo.ListHandRaises(e.ctx, s.ID)
	assert.Equal(t, []string{"Ana", "Bruno"}, []string{queue[0].Name, queue[1].Name}, "Bruno is at the end now")

	require.NoError(t, e.repo.ResolveAllHands(e.ctx, s.ID, e.now.Add(3*time.Minute)))
	queue, _ = e.repo.ListHandRaises(e.ctx, s.ID)
	assert.Empty(t, queue)
}

// Covers SPEC-051 CA-10 and section 4: one notebook per student and room; saving again changes it.
func TestOneNotebookPerStudentAndRoom(t *testing.T) {
	e := newEnv(t)
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))

	_, err := e.repo.FindNote(e.ctx, s.ID, e.student.ID)
	assert.ErrorIs(t, err, domain.ErrNotesNotFound)

	first, err := e.repo.SaveNote(e.ctx, s.ID, e.student.ID, "primeira versão")
	require.NoError(t, err)
	second, err := e.repo.SaveNote(e.ctx, s.ID, e.student.ID, "segunda versão")
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID, "the same notebook")

	var n int64
	require.NoError(t, e.db.Conn(e.ctx).Table("live_classroom_notes").Where("session_id = ? AND student_id = ?", s.ID, e.student.ID).Count(&n).Error)
	assert.EqualValues(t, 1, n)
	got, err := e.repo.FindNote(e.ctx, s.ID, e.student.ID)
	require.NoError(t, err)
	assert.Equal(t, "segunda versão", got.Content)

	bruno := e.newStudent(t, "1000002", "Bruno")
	_, err = e.repo.FindNote(e.ctx, s.ID, bruno.ID)
	assert.ErrorIs(t, err, domain.ErrNotesNotFound, "each student has his own")

	with, err := e.repo.SessionsWithNotes(e.ctx, e.student.ID, []uuid.UUID{s.ID, uuid.New()})
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]bool{s.ID: true}, with)
	with, _ = e.repo.SessionsWithNotes(e.ctx, bruno.ID, []uuid.UUID{s.ID})
	assert.Empty(t, with)
	with, err = e.repo.SessionsWithNotes(e.ctx, e.student.ID, nil)
	require.NoError(t, err)
	assert.Empty(t, with)
}

// Covers SPEC-051 CA-18: deleting a room by the soft delete keeps its notes and hands, and takes the room out of the lists.
func TestSoftDeleteKeepsNotesAndHandRaises(t *testing.T) {
	e := newEnv(t)
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	_, err := e.repo.SaveNote(e.ctx, s.ID, e.student.ID, "guardar")
	require.NoError(t, err)
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, e.now))

	require.NoError(t, e.db.Conn(e.ctx).Delete(&domain.LiveClassroomSession{}, "id = ?", s.ID).Error)
	_, err = e.repo.FindSession(e.ctx, s.ID)
	assert.ErrorIs(t, err, domain.ErrSessionNotFound)
	list, _ := e.repo.ListSessions(e.ctx, e.class.ID, 50)
	assert.Empty(t, list)

	var notes, hands, notDeleted int64
	require.NoError(t, e.db.Conn(e.ctx).Table("live_classroom_notes").Where("session_id = ?", s.ID).Count(&notes).Error)
	require.NoError(t, e.db.Conn(e.ctx).Table("live_hand_raises").Where("session_id = ?", s.ID).Count(&hands).Error)
	require.NoError(t, e.db.Conn(e.ctx).Table("live_classroom_notes").Where("session_id = ? AND deleted_at IS NULL", s.ID).Count(&notDeleted).Error)
	assert.EqualValues(t, 1, notes)
	assert.EqualValues(t, 1, hands)
	assert.EqualValues(t, 1, notDeleted, "no cascade: the rows are not touched")
}

// Covers SPEC-051 RN-01 and RN-04: the class, the enrollment and the links the service decides on.
func TestClassAndLinkChecks(t *testing.T) {
	e := newEnv(t)
	info, err := e.repo.FindClass(e.ctx, e.class.ID)
	require.NoError(t, err)
	assert.Equal(t, e.teacher.ID, info.TeacherID)
	assert.False(t, info.Archived)
	_, err = e.repo.FindClass(e.ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrClassNotFound)

	active, err := e.repo.IsActiveStudent(e.ctx, e.class.ID, e.student.ID)
	require.NoError(t, err)
	assert.True(t, active)
	active, _ = e.repo.IsActiveStudent(e.ctx, e.class.ID, uuid.New())
	assert.False(t, active)

	archived := e.class
	archived.Status = classdomain.ClassStatusArchived
	require.NoError(t, classrepository.New(e.db).UpdateClass(e.ctx, &archived))
	info, _ = e.repo.FindClass(e.ctx, e.class.ID)
	assert.True(t, info.Archived)

	lesson := uuid.New()
	require.NoError(t, e.db.Conn(e.ctx).Exec(`INSERT INTO class_sessions (id, class_id, date, start_time, end_time, lesson_count, mode, status, origin, created_at, updated_at)
        VALUES (?, ?, CURRENT_DATE, '08:00', '10:00', 2, 'IN_PERSON', 'SCHEDULED', 'EXTRA', NOW(), NOW())`, lesson, e.class.ID).Error)
	ok, err := e.repo.ClassSessionBelongsToClass(e.ctx, lesson, e.class.ID)
	require.NoError(t, err)
	assert.True(t, ok)
	other := e.newClass(t, "SO77Z")
	ok, _ = e.repo.ClassSessionBelongsToClass(e.ctx, lesson, other.ID)
	assert.False(t, ok, "a lesson of another class")
	ok, _ = e.repo.ClassSessionBelongsToClass(e.ctx, uuid.New(), e.class.ID)
	assert.False(t, ok)

	module := uuid.New()
	require.NoError(t, e.db.Conn(e.ctx).Exec(`INSERT INTO course_modules (id, teacher_id, title, description, visibility, status, created_at, updated_at)
        VALUES (?, ?, 'Linux', 'd', 'PUBLIC', 'ACTIVE', NOW(), NOW())`, module, e.teacher.ID).Error)
	ok, err = e.repo.ModuleExists(e.ctx, module)
	require.NoError(t, err)
	assert.True(t, ok)
	ok, _ = e.repo.ModuleExists(e.ctx, uuid.New())
	assert.False(t, ok)
}
