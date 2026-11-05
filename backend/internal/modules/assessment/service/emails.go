package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// The e-mail texts below are user-facing content addressed to Portuguese speakers, so they are written in Portuguese (exception to the English-only
// code rule, like the e-mails of the schedule and of the auth modules).

// Mail is an e-mail to one user: the subject, the paragraphs and the path of the platform it points to; the composition root finds the address,
// greets the user and puts it in the outbox of SPEC-042. DedupeKey keeps the same e-mail from going twice.
type Mail struct {
	UserID    uuid.UUID
	Subject   string
	Lines     []string
	Path      string
	DedupeKey string
}

// Mailer sends the e-mails of the assessments (SPEC-099 D-05).
type Mailer interface {
	Send(ctx context.Context, mails []Mail) error
}

// WithMail plugs the sending of the e-mails (SPEC-099 D-05).
func (s *Service) WithMail(m Mailer) *Service {
	s.mail = m
	return s
}

func hour(t time.Time) string { return t.In(domain.Location()).Format("15:04") }

// mailEarlyStart tells each eligible student that the exam was started before the time set, with the new end (SPEC-099 D-05, CA-06).
func (s *Service) mailEarlyStart(ctx context.Context, a domain.Assessment, setStart time.Time) error {
	if s.mail == nil {
		return nil
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return err
	}
	mails := make([]Mail, 0, len(eligible))
	for student := range eligible {
		mails = append(mails, Mail{
			UserID:  student,
			Subject: "Prova iniciada antes do horário: " + a.Title,
			Lines: []string{
				"A docente iniciou a prova " + a.Title + " às " + hour(a.StartsAt) + ", antes do horário marcado (" + hour(setStart) + ").",
				"O término passou para " + hour(a.EndsAt) + ".",
				"Entre na plataforma para fazer a prova.",
			},
			Path:      "/app/classes/" + a.ClassID.String() + "/assessments/" + a.ID.String(),
			DedupeKey: "assessment-early-start:" + a.ID.String() + ":" + student.String(),
		})
	}
	if len(mails) == 0 {
		return nil
	}
	return s.mail.Send(ctx, mails)
}
