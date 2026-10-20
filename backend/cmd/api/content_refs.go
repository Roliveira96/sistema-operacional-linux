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

// classroomMaterials lets the live classroom read the file of a material of a lesson, through the schedule service and never its repository
// (SPEC-074 RN-08).
type classroomMaterials struct{ schedule *scheduleservice.Service }

func (m classroomMaterials) MaterialFile(ctx context.Context, classID, materialID uuid.UUID) (classroomservice.LessonMaterial, error) {
	file, err := m.schedule.ProjectableFile(ctx, classID, materialID)
	switch {
	case errors.Is(err, scheduledomain.ErrMaterialNotFound):
		return classroomservice.LessonMaterial{}, classroomdomain.ErrMaterialNotFound
	case errors.Is(err, scheduledomain.ErrNotAFile):
		return classroomservice.LessonMaterial{}, classroomdomain.ErrMaterialNotProjectable
	case err != nil:
		return classroomservice.LessonMaterial{}, err
	}
	return classroomservice.LessonMaterial{Title: file.Title, ObjectKey: file.ObjectKey, ContentType: file.ContentType, PageCount: file.PageCount}, nil
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
