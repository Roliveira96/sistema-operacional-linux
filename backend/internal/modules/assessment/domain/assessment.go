// Package domain holds the assessments of a class on the calendar (SPEC-075): the entity, its enumerations and the rules that need no
// database: the period, the phases of the clock, the composition by weights or by draw, and the rescheduling.
package domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// Limits of SPEC-075 RN-02, RN-06, RN-07 and RN-13. The instructions are html, up to 20,000 characters after the filter (SPEC-077 RN-01).
const (
	MaxTitleLength       = 150
	MaxDescriptionLength = 20000
	MaxNotesLength       = 5000
	MaxReasonLength      = 500
	MinDurationMinutes   = 5
	MaxQuestions         = 50
	MaxScoreOfAssessment = Score(10000) // 100 points
	MinWeight            = Score(1)     // 0.01 point
)

// Type is what kind of assessment it is.
type Type string

const (
	// TypeExam starts and ends on the same day of Brasília (RN-03).
	TypeExam Type = "EXAM"
	// TypeAssignment may go on for several days.
	TypeAssignment Type = "ASSIGNMENT"
)

// Modality is where the assessment is done (SPEC-076 RN-01): in the laboratory or at a distance.
type Modality string

const (
	ModalityInPerson Modality = "IN_PERSON"
	ModalityOnline   Modality = "ONLINE"
)

// DefaultModality is the modality of a type when nothing is said: an exam is in person and an assignment is online (RN-01).
func DefaultModality(t Type) Modality {
	if t == TypeExam {
		return ModalityInPerson
	}
	return ModalityOnline
}

// DefaultRequiresClearance is whether a modality requires the clearance of the students when nothing is said: only the in-person one does (RN-02).
func DefaultRequiresClearance(m Modality) bool { return m == ModalityInPerson }

// Status is the stored state of an assessment. The phase of the clock is not stored (RN-03).
type Status string

const (
	StatusScheduled Status = "SCHEDULED"
	// StatusCanceled is final: nothing undoes it (RN-12).
	StatusCanceled Status = "CANCELED"
)

// Composition is how the questions get into the assessment.
type Composition string

const (
	CompositionManual Composition = "MANUAL"
	CompositionDraw   Composition = "DRAW"
)

// Audience says to whom the assessment is open (RN-08).
type Audience string

const (
	AudienceAllClass Audience = "ALL_CLASS"
	AudienceSelected Audience = "SELECTED"
)

// Phase is where the assessment is on the clock of the server.
type Phase string

const (
	PhaseUpcoming Phase = "UPCOMING"
	PhaseRunning  Phase = "RUNNING"
	PhaseEnded    Phase = "ENDED"
)

// Difficulty is a level of difficulty of a question.
type Difficulty string

const (
	DifficultyEasy   Difficulty = "EASY"
	DifficultyMedium Difficulty = "MEDIUM"
	DifficultyHard   Difficulty = "HARD"
)

// Levels are the levels of difficulty in the order the draw reports them.
var Levels = []Difficulty{DifficultyEasy, DifficultyMedium, DifficultyHard}

// Access is the answer of AccessOf (RN-14).
type Access string

const (
	AccessAllowed     Access = "ALLOWED"
	AccessCanceled    Access = "CANCELED"
	AccessNotEligible Access = "NOT_ELIGIBLE"
	AccessNotOpenYet  Access = "NOT_OPEN_YET"
	AccessEnded       Access = "ENDED"
	// AccessNotStarted is an in-person exam that is running by the clock and that the teacher has not started yet (SPEC-083 RN-05).
	AccessNotStarted Access = "NOT_STARTED"
	// AccessNotCleared is the last reason: the assessment requires the clearance and the student has not got it (SPEC-076 RN-08).
	AccessNotCleared Access = "NOT_CLEARED"
)

var location = mustLoadLocation("America/Sao_Paulo")

func mustLoadLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("load time zone %s: %v", name, err))
	}
	return loc
}

// Location is the time zone of the school, where the days of an exam are counted (SPEC-042 RN-13).
func Location() *time.Location { return location }

// Assessment is an exam or an assignment of a class, with its period and its audience (SPEC-075 section 4).
type Assessment struct {
	database.Model
	ClassID             uuid.UUID
	ModuleID            uuid.UUID
	ClassSessionID      *uuid.UUID
	Title               string
	Description         string
	Type                Type
	Status              Status
	Modality            Modality
	RequiresClearance   bool
	MaxScore            Score
	DurationMinutes     *int
	StartsAt            time.Time
	EndsAt              time.Time
	Composition         Composition
	DrawTotal           *int
	Audience            Audience
	TeacherPrivateNotes *string
	CreatedBy           uuid.UUID
	UpdatedBy           uuid.UUID
	CanceledBy          *uuid.UUID
	CanceledAt          *time.Time
	CancelReason        *string
	// StartedAt and StartedBy are the start of an in-person exam by the teacher (SPEC-083 RN-01); nil until she starts it.
	StartedAt *time.Time
	StartedBy *uuid.UUID
}

// TableName pins the table name.
func (Assessment) TableName() string { return "assessments" }

// PhaseAt gives the phase at the instant now: before the start, from the start until the end (exclusive), and from the end on (RN-03).
func (a Assessment) PhaseAt(now time.Time) Phase {
	switch {
	case now.Before(a.StartsAt):
		return PhaseUpcoming
	case now.Before(a.EndsAt):
		return PhaseRunning
	default:
		return PhaseEnded
	}
}

// Frozen tells whether the composition can no longer change: from the instant of the start on (RN-10).
func (a Assessment) Frozen(now time.Time) bool { return !now.Before(a.StartsAt) }

// Validate checks the data of the assessment (RN-02): the text, the enumerations, the score and the duration against the period.
func (a Assessment) Validate() error {
	if n := utf8.RuneCountInString(strings.TrimSpace(a.Title)); n < 1 || n > MaxTitleLength {
		return ErrInvalidAssessment
	}
	if utf8.RuneCountInString(a.Description) > MaxDescriptionLength {
		return ErrInvalidAssessment
	}
	if a.Type != TypeExam && a.Type != TypeAssignment {
		return ErrInvalidAssessment
	}
	if a.Modality != ModalityInPerson && a.Modality != ModalityOnline {
		return ErrInvalidAssessment
	}
	// an assignment is only online, and only an in-person assessment may require the clearance (SPEC-076 RN-01, RN-02)
	if (a.Type == TypeAssignment && a.Modality != ModalityOnline) || (a.RequiresClearance && a.Modality != ModalityInPerson) {
		return ErrInvalidAssessment
	}
	if a.Composition != CompositionManual && a.Composition != CompositionDraw {
		return ErrInvalidAssessment
	}
	if a.Audience != AudienceAllClass && a.Audience != AudienceSelected {
		return ErrInvalidAssessment
	}
	if a.MaxScore < MinWeight || a.MaxScore > MaxScoreOfAssessment {
		return ErrInvalidAssessment
	}
	if a.DurationMinutes != nil {
		if d := *a.DurationMinutes; d < MinDurationMinutes || d > int(a.EndsAt.Sub(a.StartsAt)/time.Minute) {
			return ErrInvalidAssessment
		}
	}
	return nil
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.In(location).Date()
	by, bm, bd := b.In(location).Date()
	return ay == by && am == bm && ad == bd
}

// ValidatePeriod checks the period (RN-03): it starts after now, it ends after it starts, and an exam is inside one day of Brasília.
func ValidatePeriod(t Type, startsAt, endsAt, now time.Time) error {
	if !startsAt.After(now) || !endsAt.After(startsAt) {
		return ErrInvalidPeriod
	}
	if t == TypeExam && !sameDay(startsAt, endsAt) {
		return ErrInvalidPeriod
	}
	return nil
}

// Item is a question in the manual composition, with its place in the exam and its weight (RN-06).
type Item struct {
	QuestionID uuid.UUID
	Position   int
	Weight     Score
}

// DrawRule is how many questions of a level the draw takes, and what each one is worth: the same for the whole level (RN-07, D-04).
type DrawRule struct {
	Difficulty Difficulty
	Quantity   int
	Points     Score
}

// ValidateManual checks a manual composition (RN-06): from 1 to 50 different questions, each worth from 0.01 to 100, adding up to the maximum
// score exactly, in hundredths.
func ValidateManual(max Score, items []Item) error {
	if len(items) < 1 || len(items) > MaxQuestions {
		return ErrInvalidAssessment
	}
	seen := make(map[uuid.UUID]bool, len(items))
	var sum Score
	for _, it := range items {
		if it.Weight < MinWeight || it.Weight > MaxScoreOfAssessment || seen[it.QuestionID] {
			return ErrInvalidAssessment
		}
		seen[it.QuestionID] = true
		sum += it.Weight
	}
	if sum != max {
		return ErrWeightsMismatch
	}
	return nil
}

// EqualWeights splits the maximum score among n questions in hundredths; the leftover goes, one hundredth each, to the first questions, so the
// sum is exact (D-14).
func EqualWeights(max Score, n int) []Score {
	if n <= 0 {
		return nil
	}
	out := make([]Score, n)
	base, rest := max/Score(n), max%Score(n)
	for i := range out {
		out[i] = base
		if Score(i) < rest {
			out[i]++
		}
	}
	return out
}

func validLevel(d Difficulty) bool {
	return d == DifficultyEasy || d == DifficultyMedium || d == DifficultyHard
}

// ValidateDraw checks a draw (RN-07): a total from 1 to 50, one rule at most for each level, quantities that add up to the total, and
// quantity times points over all the levels equal to the maximum score.
func ValidateDraw(max Score, total int, rules []DrawRule) error {
	if total < 1 || total > MaxQuestions {
		return ErrInvalidAssessment
	}
	seen := make(map[Difficulty]bool, len(rules))
	var quantity int
	var sum Score
	for _, r := range rules {
		if !validLevel(r.Difficulty) || seen[r.Difficulty] || r.Quantity < 0 || r.Points < MinWeight || r.Points > MaxScoreOfAssessment {
			return ErrInvalidAssessment
		}
		seen[r.Difficulty] = true
		quantity += r.Quantity
		sum += r.Points * Score(r.Quantity)
	}
	if quantity != total {
		return ErrDrawMismatch
	}
	if sum != max {
		return ErrWeightsMismatch
	}
	return nil
}

// CleanReason trims a reason and checks it: it is required, and it has at most 500 characters.
func CleanReason(raw string) (string, error) {
	reason := strings.TrimSpace(raw)
	if reason == "" {
		return "", ErrReasonRequired
	}
	if utf8.RuneCountInString(reason) > MaxReasonLength {
		return "", ErrInvalidAssessment
	}
	return reason, nil
}

// CleanNotes trims the private notes and checks the limit; an empty text clears them (RN-13).
func CleanNotes(raw string) (string, error) {
	notes := strings.TrimSpace(raw)
	if utf8.RuneCountInString(notes) > MaxNotesLength {
		return "", ErrInvalidAssessment
	}
	return notes, nil
}

// CheckReschedule says whether the assessment may move to the new period, by the phase it is in (RN-11): nothing moves once it is canceled or
// ended; before the start both dates change; in progress the start stays and the end only goes later, with a reason.
func CheckReschedule(a Assessment, now, startsAt, endsAt time.Time, reason string) error {
	if a.Status == StatusCanceled {
		return ErrAssessmentCanceled
	}
	phase := a.PhaseAt(now)
	if phase == PhaseEnded {
		return ErrAssessmentEnded
	}
	reason = strings.TrimSpace(reason)
	if utf8.RuneCountInString(reason) > MaxReasonLength {
		return ErrInvalidAssessment
	}
	if phase == PhaseUpcoming {
		return ValidatePeriod(a.Type, startsAt, endsAt, now)
	}
	if !startsAt.Equal(a.StartsAt) || !endsAt.After(a.EndsAt) {
		return ErrInvalidPeriod
	}
	if a.Type == TypeExam && !sameDay(a.StartsAt, endsAt) {
		return ErrInvalidPeriod
	}
	if reason == "" {
		return ErrReasonRequired
	}
	return nil
}

// EventKind is what an event of the history says happened.
type EventKind string

const (
	EventCreated     EventKind = "CREATED"
	EventUpdated     EventKind = "UPDATED"
	EventRescheduled EventKind = "RESCHEDULED"
	EventCanceled    EventKind = "CANCELED"
	// EventClearanceUpdated is one action of the teacher on the clearance of the students (SPEC-076 RN-11).
	EventClearanceUpdated EventKind = "CLEARANCE_UPDATED"
	// EventStarted is the teacher starting an in-person exam (SPEC-083 RN-03).
	EventStarted EventKind = "STARTED"
)

// Event is a line of the history of an assessment: who did what, when and why. It is only ever added (RN-15).
type Event struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey"`
	AssessmentID  uuid.UUID
	Kind          EventKind
	ActorID       uuid.UUID
	Reason        *string
	OldStartsAt   *time.Time
	OldEndsAt     *time.Time
	NewStartsAt   *time.Time
	NewEndsAt     *time.Time
	ChangedFields []string `gorm:"type:jsonb;serializer:json"`
	CreatedAt     time.Time
}

// TableName pins the table name.
func (Event) TableName() string { return "assessment_events" }
