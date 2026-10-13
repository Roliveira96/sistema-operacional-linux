package mcptest

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	practicedomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
	practiceservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
)

// Grading is the in-memory correction of descriptive answers (SPEC-039). It authorizes against the modules of the Fake and keeps the
// suggestion with the real rules of the domain.
type Grading struct {
	F       *Fake
	Answers map[uuid.UUID]*practiceservice.AnswerRow
}

// NewGrading creates an empty correction over the modules of f.
func NewGrading(f *Fake) *Grading {
	return &Grading{F: f, Answers: map[uuid.UUID]*practiceservice.AnswerRow{}}
}

// AddAnswer stores a descriptive answer of a student to a question of the module and returns its id (the id of the progress).
func (g *Grading) AddAnswer(moduleID uuid.UUID, title, html, student string) uuid.UUID {
	id := uuid.New()
	at := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	response, _ := json.Marshal(map[string]string{"html": html})
	g.Answers[id] = &practiceservice.AnswerRow{
		Progress: practicedomain.Progress{ID: id, UserID: uuid.New(), QuestionID: uuid.New(), Attempts: 1, Response: response, CompletedAt: &at, CreatedAt: at, UpdatedAt: at},
		ModuleID: moduleID, QuestionTitle: title, Statement: "<p>Explain chmod 750.</p>", ExpectedAnswer: "<p>Owner rwx, group r-x.</p>", StudentName: student,
	}
	g.Answers[id].QuestionID = g.Answers[id].Progress.QuestionID
	return id
}

// List returns the answers of the module in the situation.
func (g *Grading) List(_ context.Context, who contentservice.Actor, moduleID uuid.UUID, status string) ([]practiceservice.AnswerRow, error) {
	if err := g.F.enter("Grading.List"); err != nil {
		return nil, err
	}
	if status != "" && status != practicedomain.StatusPending && status != practicedomain.StatusSuggested && status != practicedomain.StatusGraded {
		return nil, practiceservice.ErrInvalidAnswerStatus
	}
	if err := g.F.authorize(who, moduleID); err != nil {
		return nil, err
	}
	out := []practiceservice.AnswerRow{}
	for _, r := range g.Answers {
		if r.ModuleID == moduleID && (status == "" || r.Grade.Status() == status) {
			out = append(out, *r)
		}
	}
	return out, nil
}

// Get returns one answer, authorized against its module.
func (g *Grading) Get(_ context.Context, who contentservice.Actor, progressID uuid.UUID) (practiceservice.AnswerRow, error) {
	if err := g.F.enter("Grading.Get"); err != nil {
		return practiceservice.AnswerRow{}, err
	}
	r, ok := g.Answers[progressID]
	if !ok {
		return practiceservice.AnswerRow{}, practiceservice.ErrAnswerNotFound
	}
	if err := g.F.authorize(who, r.ModuleID); err != nil {
		return practiceservice.AnswerRow{}, err
	}
	return *r, nil
}

// Suggest keeps the suggestion with the rules of the domain.
func (g *Grading) Suggest(ctx context.Context, who contentservice.Actor, progressID uuid.UUID, score int, reason, studentNote string) error {
	if err := g.F.enter("Grading.Suggest"); err != nil {
		return err
	}
	r, ok := g.Answers[progressID]
	if !ok {
		return practiceservice.ErrAnswerNotFound
	}
	if err := g.F.authorize(who, r.ModuleID); err != nil {
		return err
	}
	if r.Grade.ID == uuid.Nil {
		r.Grade = practicedomain.AnswerGrade{ID: uuid.New(), ProgressID: progressID}
	}
	_, err := r.Grade.Suggest(score, reason, studentNote, who.UserID, time.Now())
	return err
}
