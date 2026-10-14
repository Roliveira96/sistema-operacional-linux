package main

import (
	"context"
	"errors"

	"github.com/google/uuid"

	classroomdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	classroomservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	coursemoduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	scheduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
	scheduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// scheduleDecks lets the schedule read the presentations of the live classroom, through its service and never its repository (SPEC-053 RN-04).
type scheduleDecks struct{ classroom *classroomservice.Service }

func (d scheduleDecks) Deck(ctx context.Context, classID, deckID uuid.UUID) (scheduleservice.Deck, error) {
	view, err := d.classroom.DeckOfClass(ctx, classID, deckID)
	if errors.Is(err, classroomdomain.ErrDeckNotFound) {
		return scheduleservice.Deck{}, scheduledomain.ErrDeckNotFound
	}
	if err != nil {
		return scheduleservice.Deck{}, err
	}
	return scheduleservice.Deck{ID: view.Deck.ID, Title: view.Deck.Title, PageCount: view.Deck.PageCount, DownloadURL: view.DownloadURL}, nil
}

// scheduleModules lets the schedule check a teaching module as the actor would see it, through the course module service.
type scheduleModules struct{ modules *coursemoduleservice.Service }

func (m scheduleModules) Module(ctx context.Context, actor scheduleservice.Actor, moduleID uuid.UUID) (scheduleservice.Module, error) {
	id := actor.UserID
	access := coursemoduleservice.UserAccessContext{
		UserID: &id, Role: actor.Role,
		IsAdmin: actor.Role == authn.RoleAdmin, IsTeacher: actor.Role == authn.RoleTeacher, IsStudent: actor.Role == authn.RoleStudent,
	}
	details, err := m.modules.GetModuleByID(ctx, moduleID, access)
	switch {
	case errors.Is(err, coursemoduledomain.ErrModuleNotFound), errors.Is(err, coursemoduledomain.ErrForbidden),
		errors.Is(err, coursemoduledomain.ErrModuleInactive), errors.Is(err, coursemoduledomain.ErrModuleExpired):
		return scheduleservice.Module{}, scheduledomain.ErrModuleNotFound
	case err != nil:
		return scheduleservice.Module{}, err
	}
	return scheduleservice.Module{ID: details.Module.ID, Title: details.Module.Title}, nil
}
