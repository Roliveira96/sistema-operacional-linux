package main

import (
	"context"
	"errors"

	"github.com/google/uuid"

	classroomdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	classroomservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	coursemoduledomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	coursemoduleservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// classroomModules lets the live classroom check and read the teaching module of a lesson, through the services of the modules and of the
// content (SPEC-054 RN-06, RN-07).
type classroomModules struct {
	modules *coursemoduleservice.Service
	content *contentservice.Reader
}

// notFound turns what keeps a module from being used into the one error the room knows.
func notFound(err error) error {
	if errors.Is(err, coursemoduledomain.ErrModuleNotFound) || errors.Is(err, coursemoduledomain.ErrForbidden) ||
		errors.Is(err, coursemoduledomain.ErrModuleInactive) || errors.Is(err, coursemoduledomain.ErrModuleExpired) ||
		errors.Is(err, contentservice.ErrModuleNotFound) || errors.Is(err, contentservice.ErrForbidden) {
		return classroomdomain.ErrModuleNotFound
	}
	return err
}

// Available says whether the actor may use the module in a lesson: the same visibility rules of the study screen.
func (m classroomModules) Available(ctx context.Context, actor classroomservice.Actor, moduleID uuid.UUID) error {
	id := actor.UserID
	_, err := m.modules.GetModuleByID(ctx, moduleID, coursemoduleservice.UserAccessContext{
		UserID: &id, Role: actor.Role,
		IsAdmin: actor.Role == authn.RoleAdmin, IsTeacher: actor.Role == authn.RoleTeacher, IsStudent: actor.Role == authn.RoleStudent,
	})
	return notFound(err)
}

// Read gives the module of the room as an administrator would read it: the room already checked that the module is the one of the
// lesson and that the reader is admitted, and the student has no access of his own to a module that is private to another class.
func (m classroomModules) Read(ctx context.Context, moduleID uuid.UUID) (classroomservice.ModuleView, error) {
	admin := contentservice.Viewer{Role: authn.RoleAdmin}
	details, err := m.modules.GetModuleByID(ctx, moduleID, coursemoduleservice.UserAccessContext{Role: authn.RoleAdmin, IsAdmin: true})
	if err != nil {
		return classroomservice.ModuleView{}, notFound(err)
	}
	content, err := m.content.Content(ctx, moduleID, admin)
	if err != nil {
		return classroomservice.ModuleView{}, notFound(err)
	}
	scenario, err := m.content.TopicScenario(ctx, moduleID, admin)
	if err != nil {
		return classroomservice.ModuleView{}, notFound(err)
	}
	blocks := make([]classroomservice.ModuleBlock, 0, len(content.Blocks))
	for _, b := range content.Blocks {
		blocks = append(blocks, classroomservice.ModuleBlock{ID: b.ID.String(), Type: string(b.BlockType), Position: b.Position, Payload: b.Payload})
	}
	return classroomservice.ModuleView{ID: moduleID, Title: details.Module.Title, Blocks: blocks, Scenario: scenario, Setup: content.Setup}, nil
}
