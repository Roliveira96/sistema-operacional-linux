package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// Module is a teaching module.
type Module struct {
	ID    uuid.UUID
	Title string
}

// Modules is what the schedule needs from the teaching modules. It answers domain.ErrModuleNotFound for a module that does not exist or that the
// actor cannot use (SPEC-053 RN-04); the course module service implements it.
type Modules interface {
	Module(ctx context.Context, actor Actor, moduleID uuid.UUID) (Module, error)
}

// WithContentRefs plugs in the teaching modules a lesson can point to. (The presentation left the content of the lesson: SPEC-074 RN-09.)
func (s *Service) WithContentRefs(modules Modules) *Service {
	s.modules = modules
	return s
}

// ContentInput is the content of a lesson as the teacher sent it. An empty field clears the value (SPEC-053 RN-02).
type ContentInput struct {
	Topic       string
	Description string
	ModuleID    *uuid.UUID
	Links       []domain.LinkInput
	// The notes of the teacher (SPEC-073 RN-03), as rich text.
	TeacherNotes        string
	TeacherPrivateNotes string
}

// SessionContent is the content of a lesson, with the module resolved. TeacherPrivateNotes is nil for a reader who may
// not see the private notes (a student); for the teacher it is the text, empty when there is none (SPEC-073 RN-03).
type SessionContent struct {
	Topic               string
	Description         string
	Module              *Module
	Links               []domain.SessionLink
	TeacherNotes        string
	TeacherPrivateNotes *string
}

// SaveContent saves the content of a lesson as a whole (SPEC-053 RN-01 to RN-04). It is not a change of the lesson: no change mark, no reason and
// no e-mail (RN-03).
func (s *Service) SaveContent(ctx context.Context, actor Actor, classID, sessionID uuid.UUID, in ContentInput) (SessionContent, error) {
	if _, err := s.writableClass(ctx, actor, classID); err != nil {
		return SessionContent{}, err
	}
	session, err := s.sessionOfClass(ctx, classID, sessionID)
	if err != nil {
		return SessionContent{}, err
	}
	topic, err := domain.NormalizeTopic(in.Topic)
	if err != nil {
		return SessionContent{}, err
	}
	description := strings.TrimSpace(s.richText.Sanitize(in.Description))
	if utf8.RuneCountInString(description) > domain.MaxContentDescLength {
		return SessionContent{}, &domain.FieldError{Field: "description", Err: domain.ErrContentTooLong}
	}
	links, err := domain.BuildSessionLinks(sessionID, in.Links)
	if err != nil {
		return SessionContent{}, err
	}
	notes, err := domain.NormalizeTeacherNotes("teacherNotes", s.richText.Sanitize(in.TeacherNotes))
	if err != nil {
		return SessionContent{}, err
	}
	private, err := domain.NormalizeTeacherNotes("teacherPrivateNotes", s.richText.Sanitize(in.TeacherPrivateNotes))
	if err != nil {
		return SessionContent{}, err
	}
	var module *Module
	if in.ModuleID != nil {
		found, err := s.module(ctx, actor, *in.ModuleID)
		if err != nil {
			return SessionContent{}, err
		}
		module = &found
	}

	session.Topic = topic
	session.Description = nil
	if description != "" {
		session.Description = &description
	}
	session.ModuleID = in.ModuleID
	session.TeacherNotes, session.TeacherPrivateNotes = notes, private
	// the materials are saved apart (SPEC-074), but a lesson that has one has content (RN-07)
	materials, err := s.materialsOf(ctx, sessionID)
	if err != nil {
		return SessionContent{}, err
	}
	session.HasContent = topic != nil || description != "" || in.ModuleID != nil || len(links) > 0 || notes != nil || private != nil || len(materials) > 0
	if err := s.repo.SaveContent(ctx, &session, links); err != nil {
		return SessionContent{}, err
	}
	privateText := derefString(private)
	return SessionContent{Topic: derefString(topic), Description: description, Module: module, Links: links,
		TeacherNotes: derefString(notes), TeacherPrivateNotes: &privateText}, nil
}

// Content reads the content of a lesson. A module the reader cannot use is left out (SPEC-053 RN-06).
func (s *Service) Content(ctx context.Context, actor Actor, classID, sessionID uuid.UUID) (SessionContent, error) {
	if _, err := s.readableClass(ctx, actor, classID); err != nil {
		return SessionContent{}, err
	}
	session, err := s.sessionOfClass(ctx, classID, sessionID)
	if err != nil {
		return SessionContent{}, err
	}
	links, err := s.repo.ListSessionLinks(ctx, sessionID)
	if err != nil {
		return SessionContent{}, err
	}
	out := SessionContent{Topic: derefString(session.Topic), Description: derefString(session.Description), Links: links, TeacherNotes: derefString(session.TeacherNotes)}
	// the private notes are the teacher's and the administrator's; a student never gets them, not even empty (SPEC-073 RN-03)
	if actor.Role != authn.RoleStudent {
		private := derefString(session.TeacherPrivateNotes)
		out.TeacherPrivateNotes = &private
	}
	if session.ModuleID != nil {
		if module, err := s.module(ctx, actor, *session.ModuleID); err == nil {
			out.Module = &module
		} else if !errors.Is(err, domain.ErrModuleNotFound) {
			return SessionContent{}, err
		}
	}
	return out, nil
}

func (s *Service) module(ctx context.Context, actor Actor, moduleID uuid.UUID) (Module, error) {
	if s.modules == nil {
		return Module{}, domain.ErrModuleNotFound
	}
	return s.modules.Module(ctx, actor, moduleID)
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
