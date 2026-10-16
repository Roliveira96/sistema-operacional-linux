package service

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-073: the commands of the teacher in the live classroom ----

// CommandInput is a command as the presentation window sent it.
type CommandInput struct {
	Terminal        int
	Command         string
	ExitStatus      *int
	Output          string
	OutputTruncated bool
}

// LinkedRoom is a room linked to a lesson of the schedule, with how many commands the teacher ran in it; what the schedule asks for its
// timeline and its diary.
type LinkedRoom struct {
	Session      domain.LiveClassroomSession
	CommandCount int
}

// RecordCommand keeps a command the presentation window of the open room sent, with the moment of the server (SPEC-073 RN-05); a room that
// is not open takes none, and a room with MaxCommandsPerSession commands takes no more (RN-06). The handler has already checked who sent it.
func (s *Service) RecordCommand(ctx context.Context, sessionID uuid.UUID, in CommandInput) (domain.LiveTerminalCommand, error) {
	session, err := s.activeSession(ctx, sessionID)
	if err != nil {
		return domain.LiveTerminalCommand{}, err
	}
	cmd, err := domain.NewTerminalCommand(session.ID, in.Terminal, in.Command, in.ExitStatus, in.Output, in.OutputTruncated, s.now())
	if err != nil {
		return domain.LiveTerminalCommand{}, err
	}
	n, err := s.repo.CountCommands(ctx, session.ID)
	if err != nil {
		return domain.LiveTerminalCommand{}, err
	}
	if n >= domain.MaxCommandsPerSession {
		return domain.LiveTerminalCommand{}, domain.ErrCommandLimit
	}
	if err := s.repo.CreateCommand(ctx, &cmd); err != nil {
		return domain.LiveTerminalCommand{}, err
	}
	return cmd, nil
}

// ListCommands gives the commands of a room of the class, in the order they ran, to who may see the room: the owner teacher, an
// administrator and a student with an active enrollment, while the room is open and after it ended (SPEC-073 RN-07).
func (s *Service) ListCommands(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) ([]domain.LiveTerminalCommand, error) {
	if _, err := s.readable(ctx, actor, classID); err != nil {
		return nil, err
	}
	session, err := s.repo.FindSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	if session.ClassID != classID {
		return nil, domain.ErrSessionNotFound
	}
	list, err := s.repo.ListCommands(ctx, session.ID)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []domain.LiveTerminalCommand{}
	}
	return list, nil
}

// LinkedRooms gives the rooms linked to any of the lessons of the schedule, oldest first, each with its commands; it is the reading the
// schedule makes through its port, so it has no actor: the schedule has already checked who reads.
func (s *Service) LinkedRooms(ctx context.Context, classSessionIDs []uuid.UUID) ([]LinkedRoom, error) {
	if len(classSessionIDs) == 0 {
		return []LinkedRoom{}, nil
	}
	rooms, err := s.repo.ListLinkedSessions(ctx, classSessionIDs)
	if err != nil {
		return nil, err
	}
	if rooms == nil {
		rooms = []LinkedRoom{}
	}
	return rooms, nil
}

// ActiveRoom gives the open room of the class, when there is one; the schedule asks it to know the lesson of the hour (SPEC-073 RN-02).
func (s *Service) ActiveRoom(ctx context.Context, classID uuid.UUID) (domain.LiveClassroomSession, bool, error) {
	session, err := s.repo.FindActiveSession(ctx, classID)
	if errors.Is(err, domain.ErrSessionNotFound) {
		return domain.LiveClassroomSession{}, false, nil
	}
	if err != nil {
		return domain.LiveClassroomSession{}, false, err
	}
	return session, true, nil
}
