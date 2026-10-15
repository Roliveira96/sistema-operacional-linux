package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

// Deck is a presentation of a class, with a signed address to read it (SPEC-053 RN-06).
type Deck struct {
	ID          uuid.UUID
	Title       string
	PageCount   int
	DownloadURL string
}

// Module is a teaching module.
type Module struct {
	ID    uuid.UUID
	Title string
}

// Decks is what the schedule needs from the presentations of the live classroom. It answers domain.ErrDeckNotFound for a presentation that does
// not exist or is of another class (SPEC-053 RN-04); the classroom service implements it.
type Decks interface {
	Deck(ctx context.Context, classID, deckID uuid.UUID) (Deck, error)
}

// Modules is what the schedule needs from the teaching modules. It answers domain.ErrModuleNotFound for a module that does not exist or that the
// actor cannot use (SPEC-053 RN-04); the course module service implements it.
type Modules interface {
	Module(ctx context.Context, actor Actor, moduleID uuid.UUID) (Module, error)
}

// WithContentRefs plugs in the presentations and the teaching modules a lesson can point to.
func (s *Service) WithContentRefs(decks Decks, modules Modules) *Service {
	s.decks, s.modules = decks, modules
	return s
}

// ContentInput is the content of a lesson as the teacher sent it. An empty field clears the value (SPEC-053 RN-02).
type ContentInput struct {
	Topic       string
	Description string
	ModuleID    *uuid.UUID
	DeckID      *uuid.UUID
	Links       []domain.LinkInput
}

// SessionContent is the content of a lesson, with the module and the presentation resolved.
type SessionContent struct {
	Topic       string
	Description string
	Module      *Module
	Deck        *Deck
	Links       []domain.SessionLink
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
	var deck *Deck
	if in.DeckID != nil {
		found, err := s.deck(ctx, classID, *in.DeckID)
		if err != nil {
			return SessionContent{}, err
		}
		deck = &found
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
	session.DeckID, session.ModuleID = in.DeckID, in.ModuleID
	session.HasContent = topic != nil || description != "" || in.DeckID != nil || in.ModuleID != nil || len(links) > 0
	if err := s.repo.SaveContent(ctx, &session, links); err != nil {
		return SessionContent{}, err
	}
	return SessionContent{Topic: derefString(topic), Description: description, Module: module, Deck: deck, Links: links}, nil
}

// Content reads the content of a lesson. A module the reader cannot use, or a presentation that is gone, is left out (SPEC-053 RN-06).
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
	out := SessionContent{Topic: derefString(session.Topic), Description: derefString(session.Description), Links: links}
	if session.DeckID != nil {
		if deck, err := s.deck(ctx, classID, *session.DeckID); err == nil {
			out.Deck = &deck
		} else if !errors.Is(err, domain.ErrDeckNotFound) {
			return SessionContent{}, err
		}
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

func (s *Service) deck(ctx context.Context, classID, deckID uuid.UUID) (Deck, error) {
	if s.decks == nil {
		return Deck{}, domain.ErrDeckNotFound
	}
	return s.decks.Deck(ctx, classID, deckID)
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
