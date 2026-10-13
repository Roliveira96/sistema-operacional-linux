package domain

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Errors of the grade of a descriptive answer (SPEC-039).
var (
	ErrInvalidScore   = errors.New("the grade must be 0, 25, 50, 75 or 100")
	ErrNoSuggestion   = errors.New("there is no suggestion to use")
	ErrReasonRequired = errors.New("changing a confirmed grade needs a reason")
)

// The situation of a descriptive answer.
const (
	StatusPending   = "PENDING"
	StatusSuggested = "SUGGESTED"
	StatusGraded    = "GRADED"
)

// Where the confirmed grade came from (SPEC-039 RN-05).
const (
	SourceAIAccepted = "AI_ACCEPTED"
	SourceTeacher    = "TEACHER"
)

// The kinds of event of a grade, kept forever (SPEC-039 RN-06).
const (
	GradeSuggested = "SUGGESTED"
	GradeConfirmed = "CONFIRMED"
	GradeRevised   = "REVISED"
)

// validScore tells whether a grade is one of the five bands: the percentage of what is right.
func validScore(score int) bool {
	return score == 0 || score == 25 || score == 50 || score == 75 || score == 100
}

// AnswerGrade is the correction of a descriptive answer: the suggestion of the AI and the grade the teacher confirms (SPEC-039).
type AnswerGrade struct {
	ID                   uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	ProgressID           uuid.UUID  `json:"progress_id" gorm:"type:uuid"`
	SuggestedScore       *int       `json:"suggested_score"`
	SuggestionReason     *string    `json:"suggestion_reason"`
	SuggestedStudentNote *string    `json:"suggested_student_note"`
	SuggestedAt          *time.Time `json:"suggested_at"`
	SuggestedBy          *uuid.UUID `json:"suggested_by" gorm:"type:uuid"`
	Score                *int       `json:"score"`
	Source               *string    `json:"source"`
	StudentNote          *string    `json:"student_note"`
	PrivateNote          *string    `json:"private_note"`
	GradedBy             *uuid.UUID `json:"graded_by" gorm:"type:uuid"`
	GradedAt             *time.Time `json:"graded_at"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// TableName pins the table name.
func (AnswerGrade) TableName() string { return "answer_grades" }

// GradeEvent is a step of the history of a grade, never changed nor removed (SPEC-039 RN-06).
type GradeEvent struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey"`
	GradeID       uuid.UUID `gorm:"type:uuid"`
	Kind          string
	Score         *int
	PreviousScore *int
	ByUser        uuid.UUID `gorm:"type:uuid"`
	Reason        *string
	CreatedAt     time.Time
}

// TableName pins the table name.
func (GradeEvent) TableName() string { return "answer_grade_events" }

// GradeInput is what the teacher confirms: the suggestion of the AI or a band of her own, the note to the student, the private note,
// and the reason when she changes a grade already confirmed (SPEC-039 D-06, D-07).
type GradeInput struct {
	Score         *int
	UseSuggestion bool
	StudentNote   string
	PrivateNote   string
	Reason        string
}

// Status says where the answer stands.
func (g *AnswerGrade) Status() string {
	switch {
	case g.Score != nil:
		return StatusGraded
	case g.SuggestedScore != nil:
		return StatusSuggested
	}
	return StatusPending
}

func optional(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func newEventID() uuid.UUID {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.New()
	}
	return id
}

// Suggest keeps the suggestion of the AI (SPEC-039 RN-04): it never is a grade on its own.
func (g *AnswerGrade) Suggest(score int, reason, studentNote string, by uuid.UUID, at time.Time) (GradeEvent, error) {
	if !validScore(score) {
		return GradeEvent{}, ErrInvalidScore
	}
	when := at
	g.SuggestedScore, g.SuggestionReason, g.SuggestedStudentNote = &score, optional(reason), optional(studentNote)
	g.SuggestedAt, g.SuggestedBy = &when, &by
	s := score
	return GradeEvent{ID: newEventID(), GradeID: g.ID, Kind: GradeSuggested, Score: &s, ByUser: by, Reason: optional(reason), CreatedAt: at}, nil
}

// Confirm sets the grade the teacher decides (SPEC-039 RN-05, D-07): the suggestion as it is, or a band of her own. Changing a grade
// already confirmed is a revision and needs a reason.
func (g *AnswerGrade) Confirm(in GradeInput, by uuid.UUID, at time.Time) (GradeEvent, error) {
	score, source := 0, SourceTeacher
	switch {
	case in.UseSuggestion:
		if g.SuggestedScore == nil {
			return GradeEvent{}, ErrNoSuggestion
		}
		score, source = *g.SuggestedScore, SourceAIAccepted
	case in.Score == nil || !validScore(*in.Score):
		return GradeEvent{}, ErrInvalidScore
	default:
		score = *in.Score
	}
	kind := GradeConfirmed
	var previous *int
	if g.Score != nil {
		if strings.TrimSpace(in.Reason) == "" {
			return GradeEvent{}, ErrReasonRequired
		}
		kind, previous = GradeRevised, g.Score
	}
	when := at
	g.Score, g.Source = &score, &source
	g.StudentNote, g.PrivateNote = optional(in.StudentNote), optional(in.PrivateNote)
	g.GradedBy, g.GradedAt = &by, &when
	s := score
	return GradeEvent{ID: newEventID(), GradeID: g.ID, Kind: kind, Score: &s, PreviousScore: previous, ByUser: by, Reason: optional(in.Reason), CreatedAt: at}, nil
}
