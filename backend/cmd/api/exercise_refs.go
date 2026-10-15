package main

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	classroomdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	classroomservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/service"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	practiceservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/practice/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// moduleContent is the part of the content reader that the live exercise uses.
type moduleContent interface {
	Content(ctx context.Context, moduleID uuid.UUID, v contentservice.Viewer) (contentservice.ModuleContent, error)
}

// classroomExercises lets the live classroom read the exercise of a block of a module and grade the state of a student against its conditions,
// through the content reader and the corrector of the machine, and never through the repository or the code of another module (SPEC-065 section
// 3.2). The conditions are read from the module each time, so what the client sends decides nothing.
type classroomExercises struct{ content moduleContent }

// exerciseOfBlock is the exercise `index` of the block of exercises of the module, with the catalog its conditions translate to. It is
// unavailable when the block is not of the module or is of another type, the index does not exist, the exercise is not practical, or it has no
// condition (or one that cannot be graded).
func (e classroomExercises) exerciseOfBlock(ctx context.Context, moduleID, blockID uuid.UUID, index int) (title, difficulty string, catalog []contentdomain.Condition, err error) {
	// The room reads the module as an administrator would: the module is the one of the lesson, and a student has no access of his own to a
	// module that is private to another class (the same as classroomModules.Read).
	content, err := e.content.Content(ctx, moduleID, contentservice.Viewer{Role: authn.RoleAdmin})
	if err != nil {
		return "", "", nil, notFound(err)
	}
	for _, block := range content.Blocks {
		if block.ID != blockID || block.BlockType != contentdomain.BlockExercises {
			continue
		}
		var payload struct {
			Items []struct {
				Title      string          `json:"title"`
				Difficulty string          `json:"difficulty"`
				Kind       string          `json:"kind"`
				Conditions json.RawMessage `json:"conditions"`
			} `json:"items"`
		}
		if err := json.Unmarshal(block.Payload, &payload); err != nil || index < 0 || index >= len(payload.Items) {
			return "", "", nil, classroomdomain.ErrExerciseUnavailable
		}
		item := payload.Items[index]
		if item.Kind != "" && item.Kind != contentdomain.KindPractical {
			return "", "", nil, classroomdomain.ErrExerciseUnavailable
		}
		catalog, err := contentdomain.CatalogFromConditions(item.Conditions)
		if err != nil || len(catalog) == 0 {
			return "", "", nil, classroomdomain.ErrExerciseUnavailable
		}
		return item.Title, item.Difficulty, catalog, nil
	}
	return "", "", nil, classroomdomain.ErrExerciseUnavailable
}

// Exercise gives the title and the level of the exercise, if it can be graded.
func (e classroomExercises) Exercise(ctx context.Context, moduleID, blockID uuid.UUID, index int) (classroomservice.ExerciseSpec, error) {
	title, difficulty, _, err := e.exerciseOfBlock(ctx, moduleID, blockID, index)
	if err != nil {
		return classroomservice.ExerciseSpec{}, err
	}
	return classroomservice.ExerciseSpec{Title: title, Difficulty: difficulty}, nil
}

// Grade tells whether the state of the machine meets the conditions of the exercise. A state that is not a machine of the simulator is an
// invalid state, whatever the exercise.
func (e classroomExercises) Grade(ctx context.Context, moduleID, blockID uuid.UUID, index int, snapshot json.RawMessage) (bool, error) {
	machine, err := practiceservice.ParseMachine(snapshot)
	if errors.Is(err, practiceservice.ErrInvalidSnapshot) {
		return false, classroomdomain.ErrInvalidExerciseState
	}
	if err != nil {
		return false, err
	}
	_, _, catalog, err := e.exerciseOfBlock(ctx, moduleID, blockID, index)
	if err != nil {
		return false, err
	}
	verdict, err := contentdomain.Grade(machine, catalog)
	if err != nil {
		return false, err
	}
	return verdict.Passed, nil
}
