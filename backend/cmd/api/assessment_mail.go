package main

import (
	"context"
	"html"
	"strings"
	"time"

	"github.com/google/uuid"

	assessmentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// assessmentOutbox is the outbox of the schedule (SPEC-042), where the e-mails of the assessments go too.
type assessmentOutbox interface {
	Enqueue(ctx context.Context, items []scheduleservice.OutboxItem) error
}

// assessmentMail puts the e-mails of the assessments in the outbox of SPEC-042 (SPEC-099 D-05): it finds the address and the name of each user,
// greets them, and points the link to the public address of the platform. A user without an address is skipped.
type assessmentMail struct {
	outbox     assessmentOutbox
	publicURL  string
	recipients func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][2]string, error) // id -> {e-mail, name}
}

func (m assessmentMail) Send(ctx context.Context, mails []assessmentservice.Mail) error {
	ids := make([]uuid.UUID, len(mails))
	for i, mail := range mails {
		ids[i] = mail.UserID
	}
	who, err := m.recipients(ctx, ids)
	if err != nil {
		return err
	}
	now := time.Now()
	items := make([]scheduleservice.OutboxItem, 0, len(mails))
	for _, mail := range mails {
		r, ok := who[mail.UserID]
		if !ok || r[0] == "" {
			continue
		}
		greeting := "Olá,"
		if r[1] != "" {
			greeting = "Olá, " + r[1] + ","
		}
		var text, body strings.Builder
		text.WriteString(greeting + "\n\n")
		body.WriteString("<p>" + html.EscapeString(greeting) + "</p>")
		for _, line := range mail.Lines {
			text.WriteString(line + "\n")
			body.WriteString("<p>" + html.EscapeString(line) + "</p>")
		}
		if mail.Path != "" && m.publicURL != "" {
			link := m.publicURL + mail.Path
			text.WriteString("\n" + link + "\n")
			body.WriteString(`<p><a href="` + html.EscapeString(link) + `">Abrir a prova</a></p>`)
		}
		text.WriteString("\nLinux na Prática\n")
		items = append(items, scheduleservice.OutboxItem{
			RecipientUserID: mail.UserID, To: r[0], Kind: "ASSESSMENT_EARLY_START", Subject: mail.Subject,
			TextBody: text.String(), HTMLBody: body.String(), DedupeKey: mail.DedupeKey, SendAfter: now,
		})
	}
	if len(items) == 0 {
		return nil
	}
	return m.outbox.Enqueue(ctx, items)
}

// userRecipients reads the address and the name of the users, for the e-mails of the assessments.
func userRecipients(db *database.DB) func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][2]string, error) {
	return func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][2]string, error) {
		out := make(map[uuid.UUID][2]string, len(ids))
		if len(ids) == 0 {
			return out, nil
		}
		var rows []struct {
			ID    uuid.UUID
			Email string
			Name  string
		}
		err := db.Conn(ctx).Table("users").Select("id, email, COALESCE(TRIM(name), '') AS name").Where("id IN ? AND deleted_at IS NULL", ids).
			Scan(&rows).Error
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			out[r.ID] = [2]string{r.Email, r.Name}
		}
		return out, nil
	}
}
