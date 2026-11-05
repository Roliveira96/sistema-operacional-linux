package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// roomChatLimit is how many of the last messages of the exam the teacher gets in the room; the rest she reads in the attempts (SPEC-093 RN-06).
const roomChatLimit = 500

// ChatLine is a message of a conversation with the name of who wrote it, for the teacher who reads it after (RN-07).
type ChatLine struct {
	domain.ChatMessage
	SenderName string
}

// SendStudentChat stores a message of the student who is doing the exam, to the teacher, with the question she is in (RN-01 to RN-03).
func (s *Service) SendStudentChat(ctx context.Context, id, studentID uuid.UUID, position *int, text string) (domain.ChatMessage, error) {
	body, err := domain.NormalizeChat(text)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	attempt, err := s.runningAttempt(ctx, id, studentID)
	if err != nil {
		return domain.ChatMessage{}, err
	}
	m := domain.ChatMessage{AssessmentID: id, AttemptID: &attempt.ID, SenderID: studentID, SenderRole: domain.ChatStudent, Position: position, Body: body, CreatedAt: s.now()}
	return m, s.repo.SaveChat(ctx, &m, nil)
}

// SendTeacherChat stores a message of the teacher to one student who is doing the exam or, with no student, to all of them, and gives the students
// who receive it (RN-01, RN-03, RN-05, D-01). The handler already checked that the actor controls the room.
func (s *Service) SendTeacherChat(ctx context.Context, id, teacherID uuid.UUID, studentID *uuid.UUID, position *int, text string) (domain.ChatMessage, []uuid.UUID, error) {
	body, err := domain.NormalizeChat(text)
	if err != nil {
		return domain.ChatMessage{}, nil, err
	}
	m := domain.ChatMessage{AssessmentID: id, SenderID: teacherID, SenderRole: domain.ChatTeacher, Body: body, CreatedAt: s.now()}
	if studentID != nil {
		attempt, err := s.runningAttempt(ctx, id, *studentID)
		if err != nil {
			return domain.ChatMessage{}, nil, err
		}
		m.AttemptID, m.Position = &attempt.ID, position
		return m, []uuid.UUID{*studentID}, s.repo.SaveChat(ctx, &m, nil)
	}
	list, err := s.repo.ListAttempts(ctx, id)
	if err != nil {
		return domain.ChatMessage{}, nil, err
	}
	var attempts, students []uuid.UUID
	for _, at := range list {
		if at.Status == domain.AttemptInProgress {
			attempts, students = append(attempts, at.ID), append(students, at.StudentID)
		}
	}
	return m, students, s.repo.SaveChat(ctx, &m, attempts)
}

// StudentChat gives the conversation of the student with the messages to all she received, for the room (RN-06).
func (s *Service) StudentChat(ctx context.Context, id, studentID uuid.UUID) ([]domain.ChatMessage, error) {
	attempt, err := s.repo.FindAttempt(ctx, id, studentID)
	if errors.Is(err, domain.ErrAttemptNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.repo.AttemptChat(ctx, attempt.ID)
}

// RoomChat gives the last messages of the exam, for the teacher in the room (RN-06).
func (s *Service) RoomChat(ctx context.Context, id uuid.UUID) ([]domain.ChatMessage, error) {
	return s.repo.AssessmentChat(ctx, id, roomChatLimit)
}

// AttemptChat gives the teacher of the class or the administrator the whole conversation of an attempt, in any status, with who wrote each message
// (RN-07, D-03).
func (s *Service) AttemptChat(ctx context.Context, actor Actor, classID, id, attemptID uuid.UUID) ([]ChatLine, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return nil, err
	}
	a, err := s.assessmentOf(ctx, classID, id)
	if err != nil {
		return nil, err
	}
	attempt, err := s.repo.FindAttemptByID(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	if attempt.AssessmentID != a.ID {
		return nil, domain.ErrAttemptNotFound
	}
	list, err := s.repo.AttemptChat(ctx, attempt.ID)
	if err != nil {
		return nil, err
	}
	senders := []uuid.UUID{}
	for _, m := range list {
		senders = append(senders, m.SenderID)
	}
	names, err := s.ports.Users.Names(ctx, senders)
	if err != nil {
		return nil, err
	}
	if _, ok := names[attempt.StudentID]; !ok {
		students, err := s.ports.Students.ActiveStudents(ctx, classID)
		if err != nil {
			return nil, err
		}
		for _, st := range students {
			if st.ID == attempt.StudentID {
				names[st.ID] = st.Name
			}
		}
	}
	out := make([]ChatLine, len(list))
	for i, m := range list {
		out[i] = ChatLine{ChatMessage: m, SenderName: names[m.SenderID]}
	}
	return out, nil
}
