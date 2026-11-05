package main

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	assessmentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
)

type fakeOutbox struct{ items []scheduleservice.OutboxItem }

func (o *fakeOutbox) Enqueue(_ context.Context, items []scheduleservice.OutboxItem) error {
	o.items = append(o.items, items...)
	return nil
}

// Covers SPEC-099 CA-06: the e-mail of the assessment goes to the outbox of SPEC-042 with the address of the student, the greeting, the lines, the
// link of the platform and its key; a student without an address is skipped.
func TestAssessmentMail_GoesToTheOutbox(t *testing.T) {
	ana, ghost := uuid.New(), uuid.New()
	outbox := &fakeOutbox{}
	m := assessmentMail{outbox: outbox, publicURL: "https://lab.example", recipients: func(_ context.Context, ids []uuid.UUID) (map[uuid.UUID][2]string, error) {
		return map[uuid.UUID][2]string{ana: {"ana@alunos.utfpr.edu.br", "Ana"}}, nil
	}}
	err := m.Send(context.Background(), []assessmentservice.Mail{
		{UserID: ana, Subject: "Prova iniciada antes do horário: P1", Lines: []string{"A docente iniciou a prova P1 às 08:40."}, Path: "/app/classes/c/assessments/a", DedupeKey: "k-ana"},
		{UserID: ghost, Subject: "x", Lines: []string{"y"}, DedupeKey: "k-ghost"},
	})
	require.NoError(t, err)
	require.Len(t, outbox.items, 1)
	it := outbox.items[0]
	assert.Equal(t, "ana@alunos.utfpr.edu.br", it.To)
	assert.Equal(t, ana, it.RecipientUserID)
	assert.Equal(t, "ASSESSMENT_EARLY_START", it.Kind)
	assert.Equal(t, "k-ana", it.DedupeKey)
	assert.Contains(t, it.TextBody, "Olá, Ana,")
	assert.Contains(t, it.TextBody, "https://lab.example/app/classes/c/assessments/a")
	assert.Contains(t, it.HTMLBody, `href="https://lab.example/app/classes/c/assessments/a"`)
}
