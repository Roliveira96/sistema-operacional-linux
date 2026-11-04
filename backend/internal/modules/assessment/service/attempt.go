package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// kindPractical is the kind of question of command Linux, the only one with a machine to check (SPEC-090 RN-05).
const kindPractical = "PRACTICAL"

// maxAnswerBytes is the largest answer: the machine of a practical question is up to 256 KiB, and the others fit well within (RN-04).
const maxAnswerBytes = 256 * 1024

// Graded is the result of grading an answer against the key of a question: the share that is right, from 0 to 1; whether only the teacher grades
// it (a written answer); and the answer to keep, when the kind cleans it (SPEC-090 RN-04, RN-08).
type Graded struct {
	Fraction float64
	Pending  bool
	Stored   json.RawMessage
}

// AttemptItemView is a question of the attempt as the student reads it: never the key nor the points (RN-10).
type AttemptItemView struct {
	Position      int
	Kind          string
	Weight        domain.Score
	StudentView   json.RawMessage
	Answer        json.RawMessage
	CheckedSolved *bool
}

// StudentAttempt is the attempt as the student reads it (RN-10).
type StudentAttempt struct {
	ID          uuid.UUID
	Status      domain.AttemptStatus
	StartedAt   time.Time
	DeadlineAt  time.Time
	SubmittedAt *time.Time
	Items       []AttemptItemView
}

// AttemptRow is an attempt in the list of the teacher (RN-09).
type AttemptRow struct {
	AttemptID        uuid.UUID
	StudentID        uuid.UUID
	StudentName      string
	AcademicID       string
	Status           domain.AttemptStatus
	StartedAt        time.Time
	SubmittedAt      *time.Time
	PreliminaryScore *domain.Score
	PendingItems     *int
	// EndedByName and EndReason are only there when the teacher ended the attempt (SPEC-091 RN-08).
	EndedByName string
	EndReason   string
	// ChatCount is the number of messages of the conversation (SPEC-093 RN-07).
	ChatCount int
}

// attemptView is what the student sees of a question, frozen in the attempt at the entry (RN-02).
type attemptView struct {
	Title     string          `json:"title"`
	Statement string          `json:"statement"`
	Choices   []StudentChoice `json:"choices,omitempty"`
	Columns   *StudentColumns `json:"columns,omitempty"`
	Shuffle   *bool           `json:"shuffle,omitempty"`
	MaxLength *int            `json:"maxLength,omitempty"`
	Scenario  json.RawMessage `json:"scenario,omitempty"`
}

// EnterAttempt is the student entering the exam (RN-01 to RN-03): the first entry creates the attempt, the next ones give the same attempt back.
// created tells which one happened.
func (s *Service) EnterAttempt(ctx context.Context, actor Actor, classID, id uuid.UUID) (StudentAttempt, bool, error) {
	a, err := s.examOf(ctx, actor, classID, id)
	if err != nil {
		return StudentAttempt{}, false, err
	}
	if existing, err := s.openAttempt(ctx, a.ID, actor.UserID); err == nil {
		if existing.Status != domain.AttemptInProgress {
			return StudentAttempt{}, false, domain.ErrAttemptAlreadySubmitted
		}
		view, err := s.studentAttempt(ctx, existing)
		return view, false, err
	} else if !errors.Is(err, domain.ErrAttemptNotFound) {
		return StudentAttempt{}, false, err
	}

	access, err := s.AccessOf(ctx, actor.UserID, a.ID)
	if err != nil {
		return StudentAttempt{}, false, err
	}
	if err := refusalOf(access); err != nil {
		return StudentAttempt{}, false, err
	}
	items, err := s.frozenItems(ctx, a)
	if err != nil {
		return StudentAttempt{}, false, err
	}
	now := s.now()
	attempt := domain.Attempt{AssessmentID: a.ID, StudentID: actor.UserID, Status: domain.AttemptInProgress, StartedAt: now,
		DeadlineAt: domain.AttemptDeadline(now, a.DurationMinutes, a.EndsAt), CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateAttempt(ctx, &attempt, items); errors.Is(err, domain.ErrAttemptExists) {
		// two entries at once: the other one created it
		return s.EnterAttempt(ctx, actor, classID, id)
	} else if err != nil {
		return StudentAttempt{}, false, err
	}
	view, err := s.studentAttempt(ctx, attempt)
	return view, true, err
}

// MyAttempt is the student reading their own attempt; an overdue one is closed first (RN-07, RN-10).
func (s *Service) MyAttempt(ctx context.Context, actor Actor, classID, id uuid.UUID) (StudentAttempt, error) {
	a, err := s.examOf(ctx, actor, classID, id)
	if err != nil {
		return StudentAttempt{}, err
	}
	attempt, err := s.openAttempt(ctx, a.ID, actor.UserID)
	if err != nil {
		return StudentAttempt{}, err
	}
	return s.studentAttempt(ctx, attempt)
}

// SaveAnswer stores the answer of a question of the attempt in progress, replacing the one before (RN-04).
func (s *Service) SaveAnswer(ctx context.Context, actor Actor, classID, id uuid.UUID, position int, answer json.RawMessage) error {
	attempt, item, err := s.writableItem(ctx, actor, classID, id, position)
	if err != nil {
		return err
	}
	if len(answer) > maxAnswerBytes {
		return domain.ErrInvalidAnswer
	}
	graded, err := s.ports.Questions.Grade(ctx, item.Kind, item.AnswerKey, answer)
	if err != nil {
		return err
	}
	if graded.Stored != nil {
		answer = graded.Stored
	}
	return s.repo.SaveAttemptAnswer(ctx, attempt.ID, position, answer, s.now(), nil)
}

// CheckAnswer grades the machine of a practical question against the key of the attempt, stores the machine and the result, and says whether it is
// solved (RN-05, D-03).
func (s *Service) CheckAnswer(ctx context.Context, actor Actor, classID, id uuid.UUID, position int, snapshot json.RawMessage) (bool, error) {
	attempt, item, err := s.writableItem(ctx, actor, classID, id, position)
	if err != nil {
		return false, err
	}
	if item.Kind != kindPractical {
		return false, domain.ErrNotPractical
	}
	if len(snapshot) > maxAnswerBytes {
		return false, domain.ErrInvalidAnswer
	}
	graded, err := s.ports.Questions.Grade(ctx, item.Kind, item.AnswerKey, snapshot)
	if err != nil {
		return false, err
	}
	solved := graded.Fraction >= 1
	return solved, s.repo.SaveAttemptAnswer(ctx, attempt.ID, position, snapshot, s.now(), &solved)
}

// SubmitAttempt is the student delivering the attempt in progress, which is graded (RN-06, RN-08).
func (s *Service) SubmitAttempt(ctx context.Context, actor Actor, classID, id uuid.UUID) (StudentAttempt, error) {
	a, err := s.examOf(ctx, actor, classID, id)
	if err != nil {
		return StudentAttempt{}, err
	}
	attempt, err := s.openAttempt(ctx, a.ID, actor.UserID)
	if err != nil {
		return StudentAttempt{}, err
	}
	switch attempt.Status {
	case domain.AttemptInProgress:
	case domain.AttemptTimeExpired:
		return StudentAttempt{}, domain.ErrAttemptExpired
	default:
		return StudentAttempt{}, domain.ErrAttemptAlreadySubmitted
	}
	if err := s.close(ctx, &attempt, domain.AttemptSubmitted); err != nil {
		return StudentAttempt{}, err
	}
	return s.studentAttempt(ctx, attempt)
}

// Attempts is the list of the attempts of an exam for its teacher and the administrator (RN-09).
func (s *Service) Attempts(ctx context.Context, actor Actor, classID, id uuid.UUID) ([]AttemptRow, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return nil, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListAttempts(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	students, err := s.ports.Students.ActiveStudents(ctx, classID)
	if err != nil {
		return nil, err
	}
	known := make(map[uuid.UUID]Student, len(students))
	for _, st := range students {
		known[st.ID] = st
	}
	var missing []uuid.UUID
	for _, at := range list {
		if _, ok := known[at.StudentID]; !ok {
			missing = append(missing, at.StudentID)
		}
	}
	var enders []uuid.UUID
	for _, at := range list {
		if at.EndedBy != nil {
			enders = append(enders, *at.EndedBy)
		}
	}
	enderNames := map[uuid.UUID]string{}
	if len(enders) > 0 {
		if enderNames, err = s.ports.Users.Names(ctx, enders); err != nil {
			return nil, err
		}
	}
	if len(missing) > 0 {
		names, err := s.ports.Users.Names(ctx, missing)
		if err != nil {
			return nil, err
		}
		for id, name := range names {
			known[id] = Student{ID: id, Name: name}
		}
	}
	counts, err := s.repo.ChatCounts(ctx, a.ID)
	if err != nil {
		return nil, err
	}
	rows := make([]AttemptRow, len(list))
	for i, at := range list {
		st := known[at.StudentID]
		rows[i] = AttemptRow{AttemptID: at.ID, StudentID: at.StudentID, StudentName: st.Name, AcademicID: st.AcademicID, Status: at.Status,
			StartedAt: at.StartedAt, SubmittedAt: at.SubmittedAt, PreliminaryScore: at.PreliminaryScore, PendingItems: at.PendingItems, ChatCount: counts[at.ID]}
		if at.EndedBy != nil {
			rows[i].EndedByName = enderNames[*at.EndedBy]
		}
		if at.EndReason != nil {
			rows[i].EndReason = *at.EndReason
		}
	}
	return rows, nil
}

// ExpireDue closes, as TIME_EXPIRED, every attempt in progress past its deadline and the tolerance, and says how many (RN-07). The server calls it
// every minute.
func (s *Service) ExpireDue(ctx context.Context) (int, error) {
	due, err := s.repo.DueAttempts(ctx, s.now().Add(-domain.AttemptTolerance))
	if err != nil {
		return 0, err
	}
	closed := 0
	for i := range due {
		if err := s.close(ctx, &due[i], domain.AttemptTimeExpired); errors.Is(err, domain.ErrAttemptAlreadySubmitted) {
			continue
		} else if err != nil {
			return closed, err
		}
		closed++
	}
	return closed, nil
}

// examOf checks that the actor is a student and that the assessment of the class is an exam (RN-01): an assignment has no attempt.
func (s *Service) examOf(ctx context.Context, actor Actor, classID, id uuid.UUID) (domain.Assessment, error) {
	if actor.Role != authn.RoleStudent {
		return domain.Assessment{}, domain.ErrForbidden
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return domain.Assessment{}, err
	}
	if a.Type != domain.TypeExam {
		return domain.Assessment{}, domain.ErrInvalidAssessment
	}
	return a, nil
}

// openAttempt reads the attempt of the student and closes it first when it is overdue (RN-07).
func (s *Service) openAttempt(ctx context.Context, assessmentID, studentID uuid.UUID) (domain.Attempt, error) {
	attempt, err := s.repo.FindAttempt(ctx, assessmentID, studentID)
	if err != nil {
		return domain.Attempt{}, err
	}
	if attempt.Overdue(s.now()) {
		if err := s.close(ctx, &attempt, domain.AttemptTimeExpired); err != nil && !errors.Is(err, domain.ErrAttemptAlreadySubmitted) {
			return domain.Attempt{}, err
		}
		return s.repo.FindAttempt(ctx, assessmentID, studentID)
	}
	return attempt, nil
}

// writableItem gives the attempt in progress of the student and one of its questions, refusing a delivered or expired attempt (RN-04, RN-05).
func (s *Service) writableItem(ctx context.Context, actor Actor, classID, id uuid.UUID, position int) (domain.Attempt, domain.AttemptItem, error) {
	a, err := s.examOf(ctx, actor, classID, id)
	if err != nil {
		return domain.Attempt{}, domain.AttemptItem{}, err
	}
	attempt, err := s.openAttempt(ctx, a.ID, actor.UserID)
	if err != nil {
		return domain.Attempt{}, domain.AttemptItem{}, err
	}
	switch attempt.Status {
	case domain.AttemptInProgress:
	case domain.AttemptTimeExpired:
		return domain.Attempt{}, domain.AttemptItem{}, domain.ErrAttemptExpired
	default: // delivered, or ended by the teacher (SPEC-091 RN-08)
		return domain.Attempt{}, domain.AttemptItem{}, domain.ErrAttemptAlreadySubmitted
	}
	items, err := s.repo.AttemptItems(ctx, attempt.ID)
	if err != nil {
		return domain.Attempt{}, domain.AttemptItem{}, err
	}
	for _, it := range items {
		if it.Position == position {
			return attempt, it, nil
		}
	}
	return domain.Attempt{}, domain.AttemptItem{}, domain.ErrAttemptNotFound
}

// close delivers the attempt with the status and grades it: each question against its key, the written one pending, a blank one zero (RN-08).
func (s *Service) close(ctx context.Context, attempt *domain.Attempt, status domain.AttemptStatus) error {
	items, err := s.repo.AttemptItems(ctx, attempt.ID)
	if err != nil {
		return err
	}
	var total domain.Score
	pending := 0
	points := make(map[int]*domain.Score, len(items))
	for _, it := range items {
		got := domain.Score(0)
		if len(it.Answer) > 0 {
			graded, err := s.ports.Questions.Grade(ctx, it.Kind, it.AnswerKey, it.Answer)
			switch {
			case errors.Is(err, domain.ErrInvalidAnswer):
				// an answer that no longer grades is worth nothing
			case err != nil:
				return err
			case graded.Pending:
				pending++
				points[it.Position] = nil
				continue
			default:
				got = domain.ScoreOf(it.Weight, graded.Fraction)
			}
		}
		total += got
		points[it.Position] = &got
	}
	now := s.now()
	attempt.Status, attempt.SubmittedAt, attempt.PreliminaryScore, attempt.PendingItems, attempt.UpdatedAt = status, &now, &total, &pending, now
	return s.repo.CloseAttempt(ctx, attempt, points)
}

// frozenItems are the questions of a new attempt: the ones of the assessment or a sample of the draw for this student, each with what the student
// sees and the key of the moment (RN-02).
func (s *Service) frozenItems(ctx context.Context, a domain.Assessment) ([]domain.AttemptItem, error) {
	type picked struct {
		content QuestionContent
		weight  domain.Score
	}
	var chosen []picked
	if a.Composition == domain.CompositionDraw {
		rules, err := s.repo.Rules(ctx, a.ID)
		if err != nil {
			return nil, err
		}
		for _, r := range rules {
			drawn, err := s.ports.Questions.Sample(ctx, a.ModuleID, r.Difficulty, r.Quantity)
			if err != nil {
				return nil, err
			}
			if len(drawn) < r.Quantity {
				return nil, domain.ErrInsufficientStock
			}
			for _, c := range drawn {
				chosen = append(chosen, picked{c, r.Points})
			}
		}
	} else {
		list, err := s.repo.Items(ctx, a.ID)
		if err != nil {
			return nil, err
		}
		ids := make([]uuid.UUID, len(list))
		for i, it := range list {
			ids[i] = it.QuestionID
		}
		contents, err := s.ports.Questions.Contents(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, it := range list {
			c, ok := contents[it.QuestionID]
			if !ok {
				return nil, domain.ErrQuestionNotEligible
			}
			chosen = append(chosen, picked{c, it.Weight})
		}
	}
	items := make([]domain.AttemptItem, len(chosen))
	for i, p := range chosen {
		view := attemptView{Title: p.content.Title, Statement: p.content.Statement, Choices: p.content.StudentView.Choices,
			Columns: p.content.StudentView.Columns, Shuffle: p.content.StudentView.Shuffle, MaxLength: p.content.StudentView.MaxLength}
		if p.content.Kind == kindPractical {
			scenario, err := s.ports.Questions.Scenario(ctx, p.content.ID)
			if err != nil {
				return nil, err
			}
			view.Scenario = scenario
		}
		raw, err := json.Marshal(view)
		if err != nil {
			return nil, err
		}
		key := p.content.GradingKey
		if len(key) == 0 {
			key = json.RawMessage(`null`)
		}
		items[i] = domain.AttemptItem{Position: i + 1, QuestionID: p.content.ID, Kind: p.content.Kind, Weight: p.weight, StudentView: raw, AnswerKey: key}
	}
	return items, nil
}

// studentAttempt is the attempt as the student reads it, without the key nor the points (RN-10).
func (s *Service) studentAttempt(ctx context.Context, attempt domain.Attempt) (StudentAttempt, error) {
	items, err := s.repo.AttemptItems(ctx, attempt.ID)
	if err != nil {
		return StudentAttempt{}, err
	}
	out := StudentAttempt{ID: attempt.ID, Status: attempt.Status, StartedAt: attempt.StartedAt, DeadlineAt: attempt.DeadlineAt, SubmittedAt: attempt.SubmittedAt,
		Items: make([]AttemptItemView, len(items))}
	for i, it := range items {
		out.Items[i] = AttemptItemView{Position: it.Position, Kind: it.Kind, Weight: it.Weight, StudentView: it.StudentView, Answer: it.Answer}
		if it.Kind == kindPractical {
			solved := it.CheckedSolved != nil && *it.CheckedSolved
			out.Items[i].CheckedSolved = &solved
		}
	}
	return out, nil
}

// refusalOf turns a reason of the access into the error of the entry (RN-01).
func refusalOf(access domain.Access) error {
	switch access {
	case domain.AccessAllowed:
		return nil
	case domain.AccessNotEligible:
		return domain.ErrNotEligible
	case domain.AccessCanceled:
		return domain.ErrAssessmentCanceled
	case domain.AccessNotOpenYet:
		return domain.ErrAssessmentNotOpenYet
	case domain.AccessEnded:
		return domain.ErrAssessmentEnded
	case domain.AccessNotStarted:
		return domain.ErrAssessmentNotStarted
	default:
		return domain.ErrNotCleared
	}
}
