package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmrepository "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/repository"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
)

// The interfaces below are the public service operations this module consumes. The services of the
// content and coursemodule modules satisfy them; the MCP module never touches their repositories.

// Modules is the course module use case (SPEC-010).
type Modules interface {
	CreateModule(ctx context.Context, input cmservice.CreateModuleInput) (cmdomain.CourseModule, error)
	UpdateModule(ctx context.Context, input cmservice.UpdateModuleInput) (cmdomain.CourseModule, error)
	GetModuleByID(ctx context.Context, moduleID uuid.UUID, userCtx cmservice.UserAccessContext) (cmrepository.ModuleDetails, error)
	ListModules(ctx context.Context, userCtx cmservice.UserAccessContext, filter cmrepository.ListFilter) (cmrepository.ListResult, error)
}

// Authoring is the block and snapshot authoring use case (SPEC-019, SPEC-021). Every operation
// authorizes the actor against the module (ADMIN any, TEACHER the owner).
type Authoring interface {
	List(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID) ([]contentdomain.ContentBlock, error)
	Update(ctx context.Context, who contentservice.Actor, blockID uuid.UUID, payload json.RawMessage, expected time.Time, force bool) (contentdomain.ContentBlock, error)
	Delete(ctx context.Context, who contentservice.Actor, blockID uuid.UUID) error
	SetActive(ctx context.Context, who contentservice.Actor, blockID uuid.UUID, active bool) (contentdomain.ContentBlock, error)
	Setup(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID) (json.RawMessage, error)
	SetSetup(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, setup json.RawMessage) (json.RawMessage, error)
	// SaveCard validates and applies a set of blocks in one transaction (SPEC-019 RN-13).
	SaveCard(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, in contentservice.SaveCardInput) ([]contentdomain.ContentBlock, error)
}

// Exercises is the exercise bank use case of a module (SPEC-023).
type Exercises interface {
	List(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID) (contentservice.ExerciseBank, error)
	Get(ctx context.Context, who contentservice.Actor, moduleID, id uuid.UUID) (contentservice.ExerciseRecord, error)
	Create(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, in contentdomain.ExerciseInput, dependsOn *uuid.UUID, links contentservice.ExerciseLinks) (contentservice.ExerciseRecord, error)
	Update(ctx context.Context, who contentservice.Actor, moduleID, id uuid.UUID, in contentdomain.ExerciseInput, dependsOn *uuid.UUID, expected time.Time, force bool) (contentservice.ExerciseRecord, error)
	SetLinks(ctx context.Context, who contentservice.Actor, moduleID, id uuid.UUID, links contentservice.ExerciseLinks, status string) (contentservice.ExerciseRecord, error)
	Delete(ctx context.Context, who contentservice.Actor, moduleID, id uuid.UUID) error
	Reorder(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, items []contentservice.OrderItem) error
	SetBankSetup(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID, setup json.RawMessage) (json.RawMessage, error)
}

// Versions is the read side of the versions of a module (SPEC-021). Publishing and restoring are
// deliberately not part of this interface (SPEC-024 RN-08).
type Versions interface {
	List(ctx context.Context, who contentservice.Actor, moduleID uuid.UUID) (contentservice.VersionList, error)
}

// Limiter limits the writes per user, shared with the REST layer (SPEC-024 RN-10).
type Limiter interface {
	Allow(key string) (bool, time.Duration)
}
