package handler

import (
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/service"
)

// iso writes an instant in ISO 8601 with the offset of Brasília (SPEC-042 RN-13).
func iso(t time.Time) string { return t.In(domain.Location()).Format(time.RFC3339) }

func isoPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := iso(*t)
	return &s
}

// publicJSON is the only form of an assessment that a student ever receives (SPEC-075 section 5.1, RN-09): the fields and nothing else. A test
// compares its keys with the list of the spec.
type publicJSON struct {
	ID              uuid.UUID     `json:"id"`
	ClassID         uuid.UUID     `json:"classId"`
	ClassSessionID  *uuid.UUID    `json:"classSessionId,omitempty"`
	Title           string        `json:"title"`
	Description     string        `json:"description"`
	Type            domain.Type   `json:"type"`
	Status          domain.Status `json:"status"`
	Phase           domain.Phase  `json:"phase"`
	StartsAt        string        `json:"startsAt"`
	EndsAt          string        `json:"endsAt"`
	DurationMinutes *int          `json:"durationMinutes,omitempty"`
	MaxScore        float64       `json:"maxScore"`
	CancelReason    *string       `json:"cancelReason,omitempty"`
}

func toPublic(p service.Public) publicJSON {
	return publicJSON{
		ID: p.ID, ClassID: p.ClassID, ClassSessionID: p.ClassSessionID, Title: p.Title, Description: p.Description, Type: p.Type, Status: p.Status,
		Phase: p.Phase, StartsAt: iso(p.StartsAt), EndsAt: iso(p.EndsAt), DurationMinutes: p.DurationMinutes, MaxScore: p.MaxScore.Float(),
		CancelReason: p.CancelReason,
	}
}

// publicResponse is one assessment for the student, with the clock of the server for the countdown.
type publicResponse struct {
	publicJSON
	ServerNow string `json:"serverNow"`
}

type summaryJSON struct {
	publicJSON
	ModuleID            uuid.UUID          `json:"moduleId"`
	ModuleTitle         string             `json:"moduleTitle"`
	Composition         domain.Composition `json:"composition"`
	Audience            domain.Audience    `json:"audience"`
	Modality            domain.Modality    `json:"modality"`
	RequiresClearance   bool               `json:"requiresClearance"`
	ClearanceCounts     countsJSON         `json:"clearanceCounts"`
	EligibleStudents    int                `json:"eligibleStudents"`
	TotalQuestions      int                `json:"totalQuestions"`
	Frozen              bool               `json:"frozen"`
	TeacherPrivateNotes *string            `json:"teacherPrivateNotes"`
	CreatedBy           uuid.UUID          `json:"createdBy"`
	CreatedByName       string             `json:"createdByName"`
	UpdatedBy           uuid.UUID          `json:"updatedBy"`
	UpdatedByName       string             `json:"updatedByName"`
	UpdatedAt           string             `json:"updatedAt"`
	CanceledBy          *uuid.UUID         `json:"canceledBy,omitempty"`
	CanceledAt          *string            `json:"canceledAt,omitempty"`
}

func toSummary(s service.Summary) summaryJSON {
	return summaryJSON{
		publicJSON: toPublic(s.Public), ModuleID: s.ModuleID, ModuleTitle: s.ModuleTitle, Composition: s.Composition, Audience: s.Audience,
		Modality: s.Modality, RequiresClearance: s.RequiresClearance, ClearanceCounts: toCounts(s.ClearanceCounts), EligibleStudents: s.EligibleStudents, TotalQuestions: s.TotalQuestions, Frozen: s.Frozen, TeacherPrivateNotes: s.TeacherPrivateNotes,
		CreatedBy: s.CreatedBy, CreatedByName: s.CreatedByName, UpdatedBy: s.UpdatedBy, UpdatedByName: s.UpdatedByName, UpdatedAt: iso(s.UpdatedAt),
		CanceledBy: s.CanceledBy, CanceledAt: isoPtr(s.CanceledAt),
	}
}

type summaryResponse struct {
	summaryJSON
	ServerNow string `json:"serverNow"`
}

type itemJSON struct {
	QuestionID uuid.UUID         `json:"questionId"`
	Position   int               `json:"position"`
	Weight     float64           `json:"weight"`
	Title      string            `json:"title"`
	Kind       string            `json:"kind"`
	Difficulty domain.Difficulty `json:"difficulty"`
}

type ruleJSON struct {
	Difficulty        domain.Difficulty `json:"difficulty"`
	Quantity          int               `json:"quantity"`
	PointsPerQuestion float64           `json:"pointsPerQuestion"`
}

type studentJSON struct {
	StudentID  uuid.UUID `json:"studentId"`
	Name       string    `json:"name"`
	AcademicID string    `json:"academicId"`
}

type eventJSON struct {
	Kind          domain.EventKind `json:"kind"`
	ActorName     string           `json:"actorName"`
	CreatedAt     string           `json:"createdAt"`
	Reason        *string          `json:"reason,omitempty"`
	OldStartsAt   *string          `json:"oldStartsAt,omitempty"`
	OldEndsAt     *string          `json:"oldEndsAt,omitempty"`
	NewStartsAt   *string          `json:"newStartsAt,omitempty"`
	NewEndsAt     *string          `json:"newEndsAt,omitempty"`
	ChangedFields []string         `json:"changedFields,omitempty"`
}

type detailResponse struct {
	summaryJSON
	Items     []itemJSON    `json:"items"`
	DrawRules []ruleJSON    `json:"drawRules"`
	Students  []studentJSON `json:"students"`
	Events    []eventJSON   `json:"events"`
	ServerNow string        `json:"serverNow"`
}

func toRules(rules []domain.DrawRule) []ruleJSON {
	out := make([]ruleJSON, len(rules))
	for i, r := range rules {
		out[i] = ruleJSON{Difficulty: r.Difficulty, Quantity: r.Quantity, PointsPerQuestion: r.Points.Float()}
	}
	return out
}

func toDetail(d service.Detail, now time.Time) detailResponse {
	out := detailResponse{
		summaryJSON: toSummary(d.Summary), DrawRules: toRules(d.Rules), ServerNow: iso(now),
		Items: make([]itemJSON, len(d.Items)), Students: make([]studentJSON, len(d.Students)), Events: make([]eventJSON, len(d.Events)),
	}
	for i, it := range d.Items {
		out.Items[i] = itemJSON{QuestionID: it.QuestionID, Position: it.Position, Weight: it.Weight.Float(), Title: it.Title, Kind: it.Kind, Difficulty: it.Difficulty}
	}
	for i, st := range d.Students {
		out.Students[i] = studentJSON{StudentID: st.ID, Name: st.Name, AcademicID: st.AcademicID}
	}
	for i, e := range d.Events {
		out.Events[i] = eventJSON{
			Kind: e.Kind, ActorName: e.ActorName, CreatedAt: iso(e.CreatedAt), Reason: e.Reason, OldStartsAt: isoPtr(e.OldStartsAt), OldEndsAt: isoPtr(e.OldEndsAt),
			NewStartsAt: isoPtr(e.NewStartsAt), NewEndsAt: isoPtr(e.NewEndsAt), ChangedFields: e.ChangedFields,
		}
	}
	return out
}

type contentJSON struct {
	QuestionID  uuid.UUID         `json:"questionId"`
	Title       string            `json:"title"`
	Kind        string            `json:"kind"`
	Difficulty  domain.Difficulty `json:"difficulty"`
	Statement   string            `json:"statement"`
	AnswerKey   string            `json:"answerKey"`
	Explanation string            `json:"explanation"`
}

func toContent(c service.QuestionContent) contentJSON {
	return contentJSON{QuestionID: c.ID, Title: c.Title, Kind: c.Kind, Difficulty: c.Difficulty, Statement: c.Statement, AnswerKey: c.AnswerKey, Explanation: c.Explanation}
}

type previewQuestionJSON struct {
	Position int     `json:"position"`
	Weight   float64 `json:"weight"`
	contentJSON
}

type previewResponse struct {
	Questions []previewQuestionJSON     `json:"questions"`
	Rules     []ruleJSON                `json:"rules,omitempty"`
	Stock     map[domain.Difficulty]int `json:"stock,omitempty"`
	Sample    []contentJSON             `json:"sample,omitempty"`
}

func toPreview(p service.Preview) previewResponse {
	out := previewResponse{Questions: make([]previewQuestionJSON, len(p.Questions)), Rules: toRules(p.Rules), Stock: p.Stock}
	if len(out.Rules) == 0 {
		out.Rules = nil
	}
	for i, q := range p.Questions {
		out.Questions[i] = previewQuestionJSON{Position: q.Position, Weight: q.Weight.Float(), contentJSON: toContent(q.QuestionContent)}
	}
	for _, q := range p.Sample {
		out.Sample = append(out.Sample, toContent(q))
	}
	return out
}

type questionJSON struct {
	QuestionID uuid.UUID         `json:"questionId"`
	Title      string            `json:"title"`
	Kind       string            `json:"kind"`
	Difficulty domain.Difficulty `json:"difficulty"`
}

type questionsResponse struct {
	Items []questionJSON            `json:"items"`
	Total int                       `json:"total"`
	Stock map[domain.Difficulty]int `json:"stock"`
}

func toQuestions(p service.QuestionPage) questionsResponse {
	out := questionsResponse{Items: make([]questionJSON, len(p.Items)), Total: p.Total, Stock: p.Stock}
	for i, q := range p.Items {
		out.Items[i] = questionJSON{QuestionID: q.ID, Title: q.Title, Kind: q.Kind, Difficulty: q.Difficulty}
	}
	return out
}
