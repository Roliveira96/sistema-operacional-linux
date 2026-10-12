// Package service implements exercise practice: scenario delivery, server-side
// grading and progress (SPEC-014).
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/domain"
)

// ErrInvalidSnapshot means the submitted state is not a serialized machine.
var ErrInvalidSnapshot = errors.New("snapshot is not a valid serialized machine")

// ErrNotFound must be returned by the store for missing progress.
var ErrNotFound = errors.New("progress not found")

// ErrSnapshotRequired means a practical exercise was checked without the state of the machine.
var ErrSnapshotRequired = errors.New("the snapshot is required")

// ErrResponseRequired means a question without a terminal was checked without the response of the student (SPEC-035 5.2).
var ErrResponseRequired = errors.New("the response is required")

// ErrAlreadyAnswered means the student already gave the single answer of a true or false question (SPEC-035 RN-08). The store
// returns it too when a concurrent request recorded the answer first.
var ErrAlreadyAnswered = errors.New("the question was already answered")

// Content is the part of the content module this service uses.
type Content interface {
	PracticeItem(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (contentservice.PracticeItem, error)
	TopicScenario(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error)
	ModulePracticeItems(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) ([]contentservice.PracticeItem, error)
	ExerciseQuestion(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (contentdomain.Question, error)
}

// Store persists progress.
type Store interface {
	FindProgress(ctx context.Context, userID, questionID uuid.UUID) (domain.Progress, error)
	SaveProgress(ctx context.Context, p *domain.Progress) error
	ListModuleProgress(ctx context.Context, userID, moduleID uuid.UUID) ([]domain.Progress, error)
	// SaveResponse stores the single answer of a question without a terminal; ErrAlreadyAnswered when one is already stored.
	SaveResponse(ctx context.Context, p *domain.Progress) error
}

// Service is the practice use-case layer.
type Service struct {
	content Content
	store   Store
	now     func() time.Time
}

// New creates the service.
func New(content Content, store Store) *Service {
	return &Service{content: content, store: store, now: time.Now}
}

// Scenario returns the starting state of a practice exercise (RN-01).
func (s *Service) Scenario(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error) {
	item, err := s.content.PracticeItem(ctx, questionID, v)
	if err != nil {
		return nil, err
	}
	return item.Snapshot, nil
}

// CheckResult is what the student learns from a check: no conditions. A question without a terminal also reveals, after the
// answer, the correct answer and the justification (SPEC-035 RN-06, D-06).
type CheckResult struct {
	Passed      bool
	CompletedAt *time.Time
	// Correct is the answer key revealed after the answer, and CorrectField the name of its field (correctAnswer for true or false,
	// correctChoice for single choice).
	Correct      json.RawMessage
	CorrectField string
	// Details is the result of each part of the answer (each link of a matching question, SPEC-037 RN-06).
	Details     json.RawMessage
	Explanation *string
}

// Submission is the body of a check: the state of the machine for a practical exercise, or the response of the student for a
// question without a terminal (SPEC-035 5.2).
type Submission struct {
	Snapshot json.RawMessage
	Response json.RawMessage
}

func present(raw json.RawMessage) bool { return len(raw) > 0 && string(raw) != "null" }

// Submit checks an exercise of the practice of any kind of the bank: the machine for a practical one (Check), the response for
// one without a terminal (Respond).
func (s *Service) Submit(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer, sub Submission) (CheckResult, error) {
	if v.UserID == nil {
		return CheckResult{}, contentservice.ErrAuthRequired
	}
	q, err := s.content.ExerciseQuestion(ctx, questionID, v)
	if err != nil {
		return CheckResult{}, err
	}
	if contentdomain.UsesTerminal(q.Kind) {
		if !present(sub.Snapshot) {
			return CheckResult{}, ErrSnapshotRequired
		}
		return s.Check(ctx, questionID, v, sub.Snapshot)
	}
	if !present(sub.Response) {
		return CheckResult{}, ErrResponseRequired
	}
	return s.respond(ctx, q, *v.UserID, sub.Response)
}

// respond grades the single answer of the student on the server and records it (SPEC-035 RN-06, RN-08): a second answer is
// refused and the first one stays.
func (s *Service) respond(ctx context.Context, q contentdomain.Question, userID uuid.UUID, response json.RawMessage) (CheckResult, error) {
	kind, ok := contentdomain.TypeOf(q.Kind)
	if !ok {
		return CheckResult{}, contentservice.ErrQuestionNotFound
	}
	progress, err := s.progressOf(ctx, userID, q.ID)
	if err != nil {
		return CheckResult{}, err
	}
	if progress.Response != nil {
		return CheckResult{}, ErrAlreadyAnswered
	}
	verdict, err := kind.Grade(q, response)
	if err != nil {
		return CheckResult{}, err
	}
	stored, err := json.Marshal(json.RawMessage(response))
	if err != nil {
		return CheckResult{}, contentdomain.ErrInvalidResponse
	}
	progress.Answer(stored, verdict.Passed, s.now().UTC())
	if err := s.store.SaveResponse(ctx, &progress); err != nil {
		return CheckResult{}, err
	}
	field, _ := kind.Revealed(q)
	return CheckResult{Passed: verdict.Passed, CompletedAt: progress.CompletedAt, Correct: verdict.Correct, CorrectField: field, Details: verdict.Details, Explanation: q.Explanation}, nil
}

// Check grades the submitted final state on the server and records the
// result for the student (RN-02, RN-03). v.UserID must be set.
func (s *Service) Check(ctx context.Context, questionID uuid.UUID, v contentservice.Viewer, snapshot json.RawMessage) (CheckResult, error) {
	if v.UserID == nil {
		return CheckResult{}, contentservice.ErrAuthRequired
	}
	item, err := s.content.PracticeItem(ctx, questionID, v)
	if err != nil {
		return CheckResult{}, err
	}
	machine, err := parseMachine(snapshot)
	if err != nil {
		return CheckResult{}, err
	}
	verdict, err := contentdomain.Grade(machine, item.Conditions)
	if err != nil {
		return CheckResult{}, fmt.Errorf("grade question %s: %w", questionID, err)
	}

	progress, err := s.progressOf(ctx, *v.UserID, questionID)
	if err != nil {
		return CheckResult{}, err
	}
	progress.Record(verdict.Passed, s.now().UTC())
	if err := s.store.SaveProgress(ctx, &progress); err != nil {
		return CheckResult{}, fmt.Errorf("save progress: %w", err)
	}
	return CheckResult{Passed: verdict.Passed, CompletedAt: progress.CompletedAt}, nil
}

// ProgressEntry is the progress of the student in one question; an answered question without a terminal also has the correct
// answer and the justification, so the screen shows it locked with its result (SPEC-035 5.2).
type ProgressEntry struct {
	domain.Progress
	Correct      json.RawMessage
	CorrectField string
	Details      json.RawMessage
	Explanation  *string
}

// ModuleProgress lists the student's progress in a module.
func (s *Service) ModuleProgress(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) ([]ProgressEntry, error) {
	rows, err := s.store.ListModuleProgress(ctx, *v.UserID, moduleID)
	if err != nil {
		return nil, err
	}
	return s.entries(ctx, v, rows)
}

// entries adds to each answered question its correct answer and justification. A question that left the practice keeps its
// progress without them.
func (s *Service) entries(ctx context.Context, v contentservice.Viewer, rows []domain.Progress) ([]ProgressEntry, error) {
	out := make([]ProgressEntry, len(rows))
	for i, p := range rows {
		out[i] = ProgressEntry{Progress: p}
		if p.Response == nil {
			continue
		}
		q, err := s.content.ExerciseQuestion(ctx, p.QuestionID, v)
		if errors.Is(err, contentservice.ErrQuestionNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if kind, ok := contentdomain.TypeOf(q.Kind); ok {
			out[i].CorrectField, out[i].Correct = kind.Revealed(q)
			// The result of each part is graded again from the answer kept (each link of a matching question).
			if verdict, err := kind.Grade(q, p.Response); err == nil {
				out[i].Details = verdict.Details
			}
		}
		out[i].Explanation = q.Explanation
	}
	return out, nil
}

func parseMachine(snapshot json.RawMessage) (*contentdomain.Machine, error) {
	var machine contentdomain.Machine
	if err := json.Unmarshal(snapshot, &machine); err != nil ||
		machine.Format != contentdomain.MachineFormat || machine.Version != contentdomain.MachineVersion {
		return nil, ErrInvalidSnapshot
	}
	// The processes only help to grade (SPEC-029): a snapshot with more than the simulator can have is not one of its machines.
	if len(machine.Processes) > contentdomain.MaxProcessEntries || len(machine.Ended) > contentdomain.MaxProcessEntries {
		return nil, ErrInvalidSnapshot
	}
	return &machine, nil
}

// progressOf loads the student's progress on a question, or starts a new one.
func (s *Service) progressOf(ctx context.Context, userID, questionID uuid.UUID) (domain.Progress, error) {
	progress, err := s.store.FindProgress(ctx, userID, questionID)
	if errors.Is(err, ErrNotFound) {
		id, idErr := uuid.NewV7()
		if idErr != nil {
			return domain.Progress{}, idErr
		}
		return domain.Progress{ID: id, UserID: userID, QuestionID: questionID}, nil
	}
	return progress, err
}

// TopicScenario returns the prepared machine of the module topic, or nil for
// the default machine (SPEC-016 5.1).
func (s *Service) TopicScenario(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) (json.RawMessage, error) {
	return s.content.TopicScenario(ctx, moduleID, v)
}

// ModuleCheckResult lists the exercises the submitted machine satisfies and
// the student's completions in the module.
type ModuleCheckResult struct {
	Passed   []uuid.UUID
	Progress []ProgressEntry
}

// CheckModule grades every practical exercise of the module against the
// student's machine and records the approvals (SPEC-016 5.2, RN-01): failures
// are not recorded, so the automatic check never counts attempts.
func (s *Service) CheckModule(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer, snapshot json.RawMessage) (ModuleCheckResult, error) {
	if v.UserID == nil {
		return ModuleCheckResult{}, contentservice.ErrAuthRequired
	}
	items, err := s.content.ModulePracticeItems(ctx, moduleID, v)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	machine, err := parseMachine(snapshot)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	passed := []uuid.UUID{}
	for _, item := range items {
		verdict, err := contentdomain.Grade(machine, item.Conditions)
		if err != nil {
			return ModuleCheckResult{}, fmt.Errorf("grade question %s: %w", item.QuestionID, err)
		}
		if !verdict.Passed {
			continue
		}
		passed = append(passed, item.QuestionID)
		progress, err := s.progressOf(ctx, *v.UserID, item.QuestionID)
		if err != nil {
			return ModuleCheckResult{}, err
		}
		if progress.CompletedAt != nil {
			continue
		}
		progress.Complete(s.now().UTC())
		if err := s.store.SaveProgress(ctx, &progress); err != nil {
			return ModuleCheckResult{}, fmt.Errorf("save progress: %w", err)
		}
	}
	all, err := s.store.ListModuleProgress(ctx, *v.UserID, moduleID)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	entries, err := s.entries(ctx, v, all)
	if err != nil {
		return ModuleCheckResult{}, err
	}
	return ModuleCheckResult{Passed: passed, Progress: entries}, nil
}
