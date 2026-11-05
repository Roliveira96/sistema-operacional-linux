package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// RoomEntry is how a connection enters the room of an exam: the teacher and the administrator control it; a student waits until the start (SPEC-091
// RN-01, RN-02).
type RoomEntry struct {
	Controller bool
	// Waiting is the student before the start or, after it, asking to enter until the teacher admits her (SPEC-096 RN-02); Started says which.
	Waiting bool
	Started bool
}

// RoomCard is a student in the room (RN-04): the attempt (ABSENT while there is none), the progress, the deadline and the open hand. Whether the
// student is connected, and waiting, is the realtime's to add.
type RoomCard struct {
	StudentID  uuid.UUID
	AttemptID  *uuid.UUID // the room ends the attempt by it (RN-08)
	Name       string
	AcademicID string
	Status     string
	Answered   int
	Total      int
	Solved     int
	DeadlineAt *time.Time
	Help       *domain.HelpRequest
}

// RoomState is the whole room for the teacher (RN-04).
type RoomState struct {
	StartedAt     *time.Time
	StartedByName string
	EndsAt        time.Time
	Cards         []RoomCard
	Queue         []domain.HelpRequest
}

// CommandInput is a command the student ran, with the original instant when it is sent again after a fall of the connection (RN-06, D-05).
type CommandInput struct {
	Position int
	Command  string
	Output   string
	At       *time.Time
}

// statusAbsent is the card of a student who has no attempt yet.
const statusAbsent = "ABSENT"

// EnterRoom says how the actor enters the room of the exam, or why not (RN-01, RN-02). The room is open from the start time to the end plus the
// tolerance of the attempts.
func (s *Service) EnterRoom(ctx context.Context, actor Actor, classID, id uuid.UUID) (RoomEntry, error) {
	var entry RoomEntry
	if actor.Role == authn.RoleStudent {
		if _, err := s.ports.Classes.Class(ctx, classID); err != nil {
			return RoomEntry{}, err
		}
	} else {
		if _, err := s.writableClass(ctx, actor, classID); err != nil {
			return RoomEntry{}, err
		}
		entry.Controller = true
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return RoomEntry{}, err
	}
	now := s.now()
	switch {
	case a.Type != domain.TypeExam:
		return RoomEntry{}, domain.ErrInvalidAssessment
	case a.Status == domain.StatusCanceled:
		return RoomEntry{}, domain.ErrAssessmentCanceled
	case now.Before(a.StartsAt.Add(-domain.EarlyStartWindow)): // the room opens an hour before the time set (SPEC-099 D-04)
		return RoomEntry{}, domain.ErrAssessmentNotOpenYet
	case now.After(a.EndsAt.Add(domain.AttemptTolerance)):
		return RoomEntry{}, domain.ErrAssessmentEnded
	}
	entry.Started = a.StartedAt != nil
	if entry.Controller {
		return entry, nil
	}
	if a.FinishedAt != nil {
		return RoomEntry{}, domain.ErrAssessmentFinished
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return RoomEntry{}, err
	}
	if !eligible[actor.UserID] {
		return RoomEntry{}, domain.ErrNotEligible
	}
	entry.Waiting, err = s.waiting(ctx, a, actor.UserID)
	return entry, err
}

// RoomState is the room for the teacher: the start, a card for each eligible student and the queue of the help (RN-04, RN-07).
func (s *Service) RoomState(ctx context.Context, id uuid.UUID) (RoomState, error) {
	a, err := s.repo.Find(ctx, id)
	if err != nil {
		return RoomState{}, err
	}
	state := RoomState{StartedAt: a.StartedAt, EndsAt: a.EndsAt}
	if a.StartedBy != nil {
		names, err := s.ports.Users.Names(ctx, []uuid.UUID{*a.StartedBy})
		if err != nil {
			return RoomState{}, err
		}
		state.StartedByName = names[*a.StartedBy]
	}
	students, err := s.roomStudents(ctx, a)
	if err != nil {
		return RoomState{}, err
	}
	for _, st := range students {
		card, err := s.cardOf(ctx, a.ID, st)
		if err != nil {
			return RoomState{}, err
		}
		state.Cards = append(state.Cards, card)
	}
	if state.Queue, err = s.repo.OpenHelps(ctx, a.ID); err != nil {
		return RoomState{}, err
	}
	return state, nil
}

// RoomCard is the card of one student, for the changes the teacher receives (RN-04).
func (s *Service) RoomCard(ctx context.Context, id, studentID uuid.UUID) (RoomCard, error) {
	a, err := s.repo.Find(ctx, id)
	if err != nil {
		return RoomCard{}, err
	}
	students, err := s.roomStudents(ctx, a)
	if err != nil {
		return RoomCard{}, err
	}
	for _, st := range students {
		if st.ID == studentID {
			return s.cardOf(ctx, a.ID, st)
		}
	}
	return RoomCard{}, domain.ErrNotEligible
}

// RecordCommand stores a command of the attempt in progress of the student, cut to the limits, at the clock of the server or, sent again, at its
// original instant when that is within the attempt (RN-06, D-05).
func (s *Service) RecordCommand(ctx context.Context, id, studentID uuid.UUID, in CommandInput) (domain.AttemptCommand, error) {
	attempt, err := s.runningAttempt(ctx, id, studentID)
	if err != nil {
		return domain.AttemptCommand{}, err
	}
	now := s.now()
	at := now
	if in.At != nil && !in.At.Before(attempt.StartedAt) && !in.At.After(now) {
		at = *in.At
	}
	c := domain.AttemptCommand{AttemptID: attempt.ID, Position: in.Position, Command: cut(in.Command, domain.MaxCommandLength),
		Output: cut(in.Output, domain.MaxOutputLength), ExecutedAt: at}
	return c, s.repo.SaveCommand(ctx, &c)
}

// StudentCommands gives the commands of the attempt of the student in the order they ran (RN-06).
func (s *Service) StudentCommands(ctx context.Context, id, studentID uuid.UUID) ([]domain.AttemptCommand, error) {
	attempt, err := s.repo.FindAttempt(ctx, id, studentID)
	if errors.Is(err, domain.ErrAttemptNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.repo.Commands(ctx, attempt.ID)
}

// RaiseHand opens the request for help of the student who is doing the exam, or gives back the one already open (RN-07).
func (s *Service) RaiseHand(ctx context.Context, id, studentID uuid.UUID, position *int, question string) (domain.HelpRequest, error) {
	text, ok := helpText(question)
	if !ok {
		return domain.HelpRequest{}, domain.ErrInvalidHelp
	}
	attempt, err := s.runningAttempt(ctx, id, studentID)
	if err != nil {
		return domain.HelpRequest{}, err
	}
	if last, err := s.repo.LatestHelp(ctx, attempt.ID); err != nil {
		return domain.HelpRequest{}, err
	} else if last != nil && last.Status == domain.HelpOpen {
		return *last, nil
	}
	h := domain.HelpRequest{AttemptID: attempt.ID, AssessmentID: id, StudentID: studentID, Position: position, Question: text, Status: domain.HelpOpen, CreatedAt: s.now()}
	return h, s.repo.CreateHelp(ctx, &h)
}

// LowerHand cancels the open request of the student, if there is one (RN-07).
func (s *Service) LowerHand(ctx context.Context, id, studentID uuid.UUID) error {
	attempt, err := s.repo.FindAttempt(ctx, id, studentID)
	if err != nil {
		return err
	}
	last, err := s.repo.LatestHelp(ctx, attempt.ID)
	if err != nil || last == nil || last.Status != domain.HelpOpen {
		return err
	}
	return s.repo.CloseHelp(ctx, last.ID, domain.HelpCanceled, s.now(), nil, "")
}

// AnswerHelp closes an open request of the exam as answered, with the optional answer the student reads (RN-07, D-03). The handler already checked
// that the actor controls the room.
func (s *Service) AnswerHelp(ctx context.Context, id, teacherID, requestID uuid.UUID, answer string) (domain.HelpRequest, error) {
	text, ok := helpText(answer)
	if !ok {
		return domain.HelpRequest{}, domain.ErrInvalidHelp
	}
	h, err := s.repo.FindHelp(ctx, requestID)
	if err != nil {
		return domain.HelpRequest{}, err
	}
	if h.AssessmentID != id || h.Status != domain.HelpOpen {
		return domain.HelpRequest{}, domain.ErrHelpNotFound
	}
	now := s.now()
	if err := s.repo.CloseHelp(ctx, h.ID, domain.HelpAnswered, now, &teacherID, text); err != nil {
		return domain.HelpRequest{}, err
	}
	h.Status, h.ClosedAt, h.ClosedBy, h.Answer = domain.HelpAnswered, &now, &teacherID, text
	return h, nil
}

// HelpQueue gives the open requests of the exam, the oldest first (RN-07).
func (s *Service) HelpQueue(ctx context.Context, id uuid.UUID) ([]domain.HelpRequest, error) {
	return s.repo.OpenHelps(ctx, id)
}

// MyHelp gives the last request of the student, open or closed, or nil (RN-07).
func (s *Service) MyHelp(ctx context.Context, id, studentID uuid.UUID) (*domain.HelpRequest, error) {
	attempt, err := s.repo.FindAttempt(ctx, id, studentID)
	if errors.Is(err, domain.ErrAttemptNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.repo.LatestHelp(ctx, attempt.ID)
}

// EndAttempt is the teacher ending the attempt in progress of a student, with the reason; it is graded like a delivery (RN-08).
func (s *Service) EndAttempt(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID, reason string) (AttemptRow, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > domain.MaxEndReason {
		return AttemptRow{}, domain.ErrInvalidReason
	}
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return AttemptRow{}, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return AttemptRow{}, err
	}
	attempt, err := s.repo.FindAttemptByID(ctx, attemptID)
	if err != nil {
		return AttemptRow{}, err
	}
	if attempt.AssessmentID != a.ID {
		return AttemptRow{}, domain.ErrAttemptNotFound
	}
	if attempt.Status != domain.AttemptInProgress {
		return AttemptRow{}, domain.ErrAttemptAlreadySubmitted
	}
	attempt.EndedBy, attempt.EndReason = &actor.UserID, &reason
	if err := s.close(ctx, &attempt, domain.AttemptEndedByTeacher); err != nil {
		return AttemptRow{}, err
	}
	rows, err := s.Attempts(ctx, actor, classID, id)
	if err != nil {
		return AttemptRow{}, err
	}
	for _, r := range rows {
		if r.AttemptID == attemptID {
			return r, nil
		}
	}
	return AttemptRow{}, domain.ErrAttemptNotFound
}

// runningAttempt is the attempt in progress of the student; an overdue one is closed first (SPEC-090 RN-07).
func (s *Service) runningAttempt(ctx context.Context, id, studentID uuid.UUID) (domain.Attempt, error) {
	attempt, err := s.openAttempt(ctx, id, studentID)
	if err != nil {
		return domain.Attempt{}, err
	}
	if attempt.Status != domain.AttemptInProgress {
		return domain.Attempt{}, domain.ErrAttemptAlreadySubmitted
	}
	return attempt, nil
}

// roomStudents are the eligible students of the exam, by name.
func (s *Service) roomStudents(ctx context.Context, a domain.Assessment) ([]Student, error) {
	students, err := s.ports.Students.ActiveStudents(ctx, a.ClassID)
	if err != nil {
		return nil, err
	}
	eligible, err := s.eligible(ctx, a)
	if err != nil {
		return nil, err
	}
	var out []Student
	for _, st := range students {
		if eligible[st.ID] {
			out = append(out, st)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (s *Service) cardOf(ctx context.Context, id uuid.UUID, st Student) (RoomCard, error) {
	card := RoomCard{StudentID: st.ID, Name: st.Name, AcademicID: st.AcademicID, Status: statusAbsent}
	attempt, err := s.openAttempt(ctx, id, st.ID)
	if errors.Is(err, domain.ErrAttemptNotFound) {
		return card, nil
	}
	if err != nil {
		return RoomCard{}, err
	}
	items, err := s.repo.AttemptItems(ctx, attempt.ID)
	if err != nil {
		return RoomCard{}, err
	}
	card.Status, card.Total, card.DeadlineAt, card.AttemptID = string(attempt.Status), len(items), &attempt.DeadlineAt, &attempt.ID
	for _, it := range items {
		if len(it.Answer) > 0 {
			card.Answered++
		}
		if it.CheckedSolved != nil && *it.CheckedSolved {
			card.Solved++
		}
	}
	last, err := s.repo.LatestHelp(ctx, attempt.ID)
	if err != nil {
		return RoomCard{}, err
	}
	if last != nil && last.Status == domain.HelpOpen {
		card.Help = last
	}
	return card, nil
}

// helpText is the text of a question or an answer of the help: trimmed, without control characters, up to 300 characters (RN-07).
func helpText(text string) (string, bool) {
	clean := strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' {
			return -1
		}
		return r
	}, text))
	return clean, utf8.RuneCountInString(clean) <= domain.MaxHelpLength
}

// cut keeps the first n characters of the text.
func cut(text string, n int) string {
	if utf8.RuneCountInString(text) <= n {
		return text
	}
	return string([]rune(text)[:n])
}
