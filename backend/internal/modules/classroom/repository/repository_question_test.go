package repository_test

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/migrations"
)

// ---- SPEC-058: the doubt that comes with the raised hand ----

// storedQuestions are the questions in the table, by student, with nil for the null of the column; closed hands included.
func storedQuestions(t *testing.T, e env, session string) map[string][]*string {
	t.Helper()
	var rows []struct {
		StudentID string
		Status    string
		Question  *string
	}
	require.NoError(t, e.db.Conn(e.ctx).Table("live_hand_raises").Select("student_id::text AS student_id, status, question").
		Where("session_id::text = ?", session).Order("created_at, id").Scan(&rows).Error)
	out := map[string][]*string{}
	for _, r := range rows {
		out[r.StudentID] = append(out[r.StudentID], r.Question)
	}
	return out
}

// Covers SPEC-058 CA-07 and section 4: the question is written with the hand and read back with the queue; with no text the column is null.
func TestHandQuestion_SavedAndReadWithTheQueue(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	text := "Como funciona o fork?\ncom 😀 e acentuação"

	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, bruno.ID, "", e.now.Add(time.Second)))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, text, e.now.Add(2*time.Second)))

	queue, err := e.repo.ListHandRaises(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, queue, 2)
	assert.Equal(t, "Bruno", queue[0].Name)
	assert.Equal(t, "", queue[0].Question, "no question: empty in the queue")
	assert.Equal(t, "Ana", queue[1].Name)
	assert.Equal(t, text, queue[1].Question, "the text comes back as it went, line break and emoji included")

	stored := storedQuestions(t, e, s.ID.String())
	require.Len(t, stored[bruno.ID.String()], 1)
	assert.Nil(t, stored[bruno.ID.String()][0], "no question is null in the column, not an empty text")
	require.NotNil(t, stored[e.student.ID.String()][0])
	assert.Equal(t, text, *stored[e.student.ID.String()][0])
}

// Covers SPEC-058 CA-08: raising the hand again, while it is up, updates the question and keeps the hand: no second row, and the same place
// in the queue (the time it was raised does not change); sending none takes the question away.
func TestHandQuestion_UpdatedByTheResend(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, "primeira", e.now.Add(time.Second)))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, bruno.ID, "", e.now.Add(2*time.Second)))

	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, "segunda", e.now.Add(time.Minute)))
	queue, err := e.repo.ListHandRaises(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, queue, 2, "no second hand of Ana")
	assert.Equal(t, []string{"Ana", "Bruno"}, []string{queue[0].Name, queue[1].Name}, "she keeps her place")
	assert.Equal(t, "segunda", queue[0].Question)
	assert.True(t, queue[0].RequestedAt.Equal(e.now.Add(time.Second)), "the hand is the one raised at first")
	assert.Len(t, storedQuestions(t, e, s.ID.String())[e.student.ID.String()], 1)

	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, "", e.now.Add(2*time.Minute)))
	queue, _ = e.repo.ListHandRaises(e.ctx, s.ID)
	require.Len(t, queue, 2)
	assert.Equal(t, "", queue[0].Question, "sending none takes the question away")
	assert.Nil(t, storedQuestions(t, e, s.ID.String())[e.student.ID.String()][0], "and the column goes back to null")
}

// Covers SPEC-058 CA-05: the question is erased when the hand goes down, whoever lowers it: the student, the teacher answering, or the
// teacher lowering every hand. The row of the hand stays (it is the record of the lesson); the text does not.
func TestHandQuestion_ErasedWhenTheHandGoesDown(t *testing.T) {
	e := newEnv(t)
	bruno := e.newStudent(t, "1000002", "Bruno")
	carla := e.newStudent(t, "1000003", "Carla")
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, "da Ana", e.now.Add(time.Second)))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, bruno.ID, "do Bruno", e.now.Add(2*time.Second)))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, carla.ID, "da Carla", e.now.Add(3*time.Second)))

	require.NoError(t, e.repo.ResolveHand(e.ctx, s.ID, e.student.ID, domain.HandLowered, e.now.Add(time.Minute)))
	stored := storedQuestions(t, e, s.ID.String())
	require.Len(t, stored[e.student.ID.String()], 1, "the row of the hand is kept")
	assert.Nil(t, stored[e.student.ID.String()][0], "the student lowered it: no question")
	require.NotNil(t, stored[bruno.ID.String()][0], "the others are not touched")

	require.NoError(t, e.repo.ResolveHand(e.ctx, s.ID, bruno.ID, domain.HandAnswered, e.now.Add(time.Minute)))
	assert.Nil(t, storedQuestions(t, e, s.ID.String())[bruno.ID.String()][0], "the teacher answered it: no question")
	require.NotNil(t, storedQuestions(t, e, s.ID.String())[carla.ID.String()][0])

	require.NoError(t, e.repo.ResolveAllHands(e.ctx, s.ID, e.now.Add(2*time.Minute)))
	assert.Nil(t, storedQuestions(t, e, s.ID.String())[carla.ID.String()][0], "the teacher lowered every hand: no question")

	// a hand that comes after starts with none, and the old text does not come back
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, "", e.now.Add(3*time.Minute)))
	queue, err := e.repo.ListHandRaises(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, queue, 1)
	assert.Equal(t, "", queue[0].Question)
	rows := storedQuestions(t, e, s.ID.String())[e.student.ID.String()]
	require.Len(t, rows, 2, "the lowered hand and the new one")
	assert.Nil(t, rows[0])
	assert.Nil(t, rows[1])
}

// migration00033 splits the migration of SPEC-058 in its two parts: what goes up and what comes down.
func migration00033(t *testing.T) (up, down string) {
	t.Helper()
	entries, err := migrations.FS.ReadDir(".")
	require.NoError(t, err)
	var text string
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "00033_") {
			raw, err := migrations.FS.ReadFile(entry.Name())
			require.NoError(t, err)
			text = string(raw)
		}
	}
	require.NotEmpty(t, text, "migration 00033 exists")
	upAt, downAt := strings.Index(text, "-- +goose Up"), strings.Index(text, "-- +goose Down")
	require.True(t, upAt >= 0 && downAt > upAt, "migration 00033 has its Up and its Down")
	return text[upAt+len("-- +goose Up") : downAt], text[downAt+len("-- +goose Down"):]
}

func questionColumn(t *testing.T, e env) (dataType, nullable string, found bool) {
	t.Helper()
	var rows []struct{ DataType, IsNullable string }
	require.NoError(t, e.db.Conn(e.ctx).Raw(
		"SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'live_hand_raises' AND column_name = 'question'").
		Scan(&rows).Error)
	if len(rows) == 0 {
		return "", "", false
	}
	return rows[0].DataType, rows[0].IsNullable, true
}

// Covers SPEC-058 CA-10 and section 4: the migration 00033 adds the column question, text and null, to the table of the hands; going down
// takes it away, going up again brings it back, and the hands that exist are kept.
func TestMigration00033_AddsTheColumnAndTakesItBack(t *testing.T) {
	e := newEnv(t) // every migration was applied by the helper
	up, down := migration00033(t)
	s := e.session(e.class.ID, e.now)
	require.NoError(t, e.repo.CreateSession(e.ctx, &s))
	require.NoError(t, e.repo.RaiseHand(e.ctx, s.ID, e.student.ID, "ficará só até a reversão", e.now))

	dataType, nullable, found := questionColumn(t, e)
	require.True(t, found, "the migration added the column")
	assert.Equal(t, "text", dataType)
	assert.Equal(t, "YES", nullable, "null: a hand with no question has no text")

	require.NoError(t, e.db.Conn(e.ctx).Exec(down).Error, "the Down runs")
	_, _, found = questionColumn(t, e)
	assert.False(t, found, "the Down took the column away")
	var hands int64
	require.NoError(t, e.db.Conn(e.ctx).Table("live_hand_raises").Count(&hands).Error)
	assert.EqualValues(t, 1, hands, "and kept the hands")

	require.NoError(t, e.db.Conn(e.ctx).Exec(up).Error, "the Up runs again")
	dataType, nullable, found = questionColumn(t, e)
	require.True(t, found)
	assert.Equal(t, "text", dataType)
	assert.Equal(t, "YES", nullable)
	queue, err := e.repo.ListHandRaises(e.ctx, s.ID)
	require.NoError(t, err)
	require.Len(t, queue, 1)
	assert.Equal(t, "", queue[0].Question, "the hand that was there comes back with no question")

	// the database holds the limit of the domain, in characters and not in bytes
	require.NoError(t, e.db.Conn(e.ctx).Exec("UPDATE live_hand_raises SET question = ?", strings.Repeat("😀", 300)).Error, "300 characters")
	assert.Error(t, e.db.Conn(e.ctx).Exec("UPDATE live_hand_raises SET question = ?", strings.Repeat("😀", 301)).Error, "301 characters")
}
