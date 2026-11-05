package service_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// Covers SPEC-099 CA-01, CA-02 (D-01 to D-03, D-06): up to an hour before the time set, the teacher starts the exam and the period moves to begin
// now with the same length; the history keeps the old period and the new one. More than an hour before, it is refused; in the period, nothing moves.
func TestStart_EarlyWithinTheHourMovesThePeriod(t *testing.T) {
	f := newFixture(t)
	exam := f.createOnline(t) // 09:00 to 11:00

	f.now = at(21, 7, 59)
	_, err := f.svc.Start(ctx, f.teacher, f.class.ID, exam.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotOpenYet, "61 minutes before")

	f.now = at(21, 8, 10)
	got, err := f.svc.Start(ctx, f.teacher, f.class.ID, exam.ID)
	require.NoError(t, err)
	require.NotNil(t, got.StartedAt)
	assert.Equal(t, at(21, 8, 10), *got.StartedAt)
	assert.Equal(t, at(21, 8, 10), got.StartsAt, "the period begins now")
	assert.Equal(t, at(21, 10, 10), got.EndsAt, "with the same two hours")
	assert.Equal(t, domain.PhaseRunning, got.Phase)

	events := startedEvents(f, exam)
	require.Len(t, events, 1)
	e := events[0]
	require.NotNil(t, e.OldStartsAt)
	assert.Equal(t, at(21, 9, 0), *e.OldStartsAt)
	assert.Equal(t, at(21, 11, 0), *e.OldEndsAt)
	assert.Equal(t, at(21, 8, 10), *e.NewStartsAt)
	assert.Equal(t, at(21, 10, 10), *e.NewEndsAt)

	onTime := f.createOnline(t)
	f.now = at(21, 9, 5)
	started, err := f.svc.Start(ctx, f.teacher, f.class.ID, onTime.ID)
	require.NoError(t, err)
	assert.Equal(t, at(21, 9, 0), started.StartsAt, "in the period nothing moves")
	assert.Equal(t, at(21, 11, 0), started.EndsAt)
	assert.Nil(t, startedEvents(f, onTime)[0].OldStartsAt)
}

// Covers SPEC-099 CA-03 (D-04): an hour before the time set, the room takes the teacher and the students wait, and the student has the way in;
// earlier, the room refuses and the exam is not open yet.
func TestEarlyHour_TheRoomAndTheAccessOpen(t *testing.T) {
	f := newFixture(t)
	exam := f.createOnline(t)

	f.now = at(21, 7, 59)
	_, err := f.svc.EnterRoom(ctx, f.teacher, f.class.ID, exam.ID)
	assert.ErrorIs(t, err, domain.ErrAssessmentNotOpenYet)
	access, err := f.svc.AccessOf(ctx, f.ana.ID, exam.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotOpenYet, access)

	f.now = at(21, 8, 0)
	entry, err := f.svc.EnterRoom(ctx, f.teacher, f.class.ID, exam.ID)
	require.NoError(t, err)
	assert.True(t, entry.Controller)
	entry, err = f.svc.EnterRoom(ctx, f.as(f.ana), f.class.ID, exam.ID)
	require.NoError(t, err)
	assert.True(t, entry.Waiting, "the student waits for the start")
	access, err = f.svc.AccessOf(ctx, f.ana.ID, exam.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.AccessNotStarted, access, "the way in to the waiting room shows up")
}

// fakeMail keeps the e-mails the service asked to send (SPEC-099 D-05).
type fakeMail struct{ sent []service.Mail }

func (m *fakeMail) Send(_ context.Context, mails []service.Mail) error {
	m.sent = append(m.sent, mails...)
	return nil
}

// Covers SPEC-099 CA-06 (D-05): the exam started early sends an e-mail to each eligible student, with the title, the hour of the start, the hour
// set, the new end and the way to the assessment; started on time, no e-mail.
func TestStart_EarlyMailsTheStudents(t *testing.T) {
	f := newFixture(t)
	mail := &fakeMail{}
	f.svc = f.svc.WithMail(mail)
	exam := f.createOnline(t)
	f.now = at(21, 8, 40)
	_, err := f.svc.Start(ctx, f.teacher, f.class.ID, exam.ID)
	require.NoError(t, err)
	require.Len(t, mail.sent, 3, "Ana, Bruno and Carla")
	got := map[uuid.UUID]service.Mail{}
	for _, m := range mail.sent {
		got[m.UserID] = m
	}
	ana := got[f.ana.ID]
	assert.Contains(t, ana.Subject, "Prova iniciada antes do horário")
	assert.Contains(t, ana.Subject, exam.Title)
	text := strings.Join(ana.Lines, "\n")
	assert.Contains(t, text, "08:40")
	assert.Contains(t, text, "09:00")
	assert.Contains(t, text, "10:40", "the new end")
	assert.Equal(t, "/app/classes/"+f.class.ID.String()+"/assessments/"+exam.ID.String(), ana.Path)
	assert.NotEmpty(t, ana.DedupeKey)

	onTime := f.createOnline(t)
	f.now = at(21, 9, 5)
	_, err = f.svc.Start(ctx, f.teacher, f.class.ID, onTime.ID)
	require.NoError(t, err)
	assert.Len(t, mail.sent, 3, "on time, no e-mail")
}
