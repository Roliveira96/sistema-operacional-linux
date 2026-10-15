package main

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	classroomdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
)

// ---- SPEC-065: the exercises of the blocks of a module, for the live classroom ----

// fakeModuleContent is the content reader: the blocks of the modules it knows, and the viewers it was asked for.
type fakeModuleContent struct {
	blocks  map[uuid.UUID][]contentdomain.ContentBlock
	err     error
	viewers []contentservice.Viewer
}

func (f *fakeModuleContent) Content(_ context.Context, module uuid.UUID, v contentservice.Viewer) (contentservice.ModuleContent, error) {
	f.viewers = append(f.viewers, v)
	if f.err != nil {
		return contentservice.ModuleContent{}, f.err
	}
	blocks, ok := f.blocks[module]
	if !ok {
		return contentservice.ModuleContent{}, contentservice.ErrModuleNotFound
	}
	return contentservice.ModuleContent{Blocks: blocks}, nil
}

const machineWithTheFolder = `{"formato":"exame-so/maquina","versao":1,"hostname":"h","contas":{"usuarios":[],"grupos":[]},` +
	`"raiz":{"nome":"","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[` +
	`{"nome":"srv","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[` +
	`{"nome":"x","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[]}]}]}}`

const emptyMachineJSON = `{"formato":"exame-so/maquina","versao":1,"hostname":"h","contas":{"usuarios":[],"grupos":[]},` +
	`"raiz":{"nome":"","tipo":"diretorio","dono":0,"grupo":0,"permissoes":"755","filhos":[]}}`

// exercisesPayload is the payload of a block EXERCISES as the content stores it (SPEC-022 section 5): the items with their conditions in the
// form of finalization.
const exercisesPayload = `{"items":[
	{"title":"Criar a pasta","difficulty":"HARD","description":"<p>Crie</p>","conditions":[{"kind":"DIR_EXISTS","path":"/srv/x"}],"hints":[{"text":"mkdir"}]},
	{"title":"Sem condição","difficulty":"EASY"},
	{"title":"Verdadeiro ou falso","difficulty":"EASY","kind":"THEORETICAL_BOOLEAN","correctAnswer":true},
	{"title":"Explícito","difficulty":"MEDIUM","kind":"PRACTICAL","conditions":[{"kind":"USER_EXISTS","name":"ana"}]},
	{"title":"Condição que não existe","difficulty":"EASY","conditions":[{"kind":"TELEPORT","path":"/a"}]},
	{"title":"Dono e grupo","difficulty":"EASY","conditions":[{"kind":"OWNER","path":"/srv","owner":"ana","group":"dev"}]}
]}`

func moduleWith(t *testing.T) (classroomExercises, *fakeModuleContent, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	module, block, text := uuid.New(), uuid.New(), uuid.New()
	content := &fakeModuleContent{blocks: map[uuid.UUID][]contentdomain.ContentBlock{module: {
		{ID: text, BlockType: contentdomain.BlockText, Payload: json.RawMessage(exercisesPayload)}, // the same payload, but not a block of exercises
		{ID: block, BlockType: contentdomain.BlockExercises, Payload: json.RawMessage(exercisesPayload)},
	}}}
	return classroomExercises{content: content}, content, module, block, text
}

// Covers SPEC-065 section 3.1 (live:exercise:start): the exercise of a block of the module of the lesson is read with its title and level, as the
// block stores them.
func TestClassroomExercises_ReadsTheExerciseOfTheBlock(t *testing.T) {
	ex, content, module, block, _ := moduleWith(t)
	spec, err := ex.Exercise(context.Background(), module, block, 0)
	require.NoError(t, err)
	assert.Equal(t, "Criar a pasta", spec.Title)
	assert.Equal(t, "HARD", spec.Difficulty)

	spec, err = ex.Exercise(context.Background(), module, block, 3)
	require.NoError(t, err)
	assert.Equal(t, "Explícito", spec.Title, "a practical exercise that says so")
	assert.Equal(t, "MEDIUM", spec.Difficulty)

	spec, err = ex.Exercise(context.Background(), module, block, 5)
	require.NoError(t, err)
	assert.Equal(t, "Dono e grupo", spec.Title)

	require.NotEmpty(t, content.viewers)
	assert.Equal(t, authn.RoleAdmin, content.viewers[0].Role, "the room reads the module as an administrator would: the module is the lesson's, and the student has no access of his own")
}

// Covers SPEC-065 CA-01 and section 3.1: what cannot be started is unavailable: a block that is not of the module or is of another type, an index
// that does not exist, an exercise with no condition, one that is not practical, one with a condition of a kind that does not exist, and a payload
// that is not a group of exercises.
func TestClassroomExercises_Unavailable(t *testing.T) {
	ex, content, module, block, text := moduleWith(t)
	ctx := context.Background()
	other := uuid.New()
	content.blocks[other] = []contentdomain.ContentBlock{{ID: uuid.New(), BlockType: contentdomain.BlockExercises, Payload: json.RawMessage(exercisesPayload)}}
	for name, tc := range map[string]struct {
		module, block uuid.UUID
		index         int
	}{
		"a block of another module":             {other, block, 0},
		"a block that does not exist":           {module, uuid.New(), 0},
		"a block that is not of exercises":      {module, text, 0},
		"an index that does not exist":          {module, block, 6},
		"a negative index":                      {module, block, -1},
		"an exercise with no condition":         {module, block, 1},
		"an exercise that is not practical":     {module, block, 2},
		"an exercise with an unknown condition": {module, block, 4},
	} {
		_, err := ex.Exercise(ctx, tc.module, tc.block, tc.index)
		assert.ErrorIs(t, err, classroomdomain.ErrExerciseUnavailable, name)
	}

	broken := uuid.New()
	content.blocks[broken] = []contentdomain.ContentBlock{{ID: block, BlockType: contentdomain.BlockExercises, Payload: json.RawMessage(`{"items":"x"}`)}}
	_, err := ex.Exercise(ctx, broken, block, 0)
	assert.ErrorIs(t, err, classroomdomain.ErrExerciseUnavailable, "a payload that is not a group of exercises")
}

// Covers SPEC-065 section 3.1: a module that is not found is the one error the room knows; any other failure of the reader goes up as it is.
func TestClassroomExercises_ModuleErrors(t *testing.T) {
	ex, content, _, block, _ := moduleWith(t)
	ctx := context.Background()
	_, err := ex.Exercise(ctx, uuid.New(), block, 0)
	assert.ErrorIs(t, err, classroomdomain.ErrModuleNotFound)
	_, err = ex.Grade(ctx, uuid.New(), block, 0, json.RawMessage(machineWithTheFolder))
	assert.ErrorIs(t, err, classroomdomain.ErrModuleNotFound)

	content.err = errors.New("database is down")
	_, err = ex.Exercise(ctx, uuid.New(), block, 0)
	assert.ErrorContains(t, err, "database is down")
	assert.NotErrorIs(t, err, classroomdomain.ErrExerciseUnavailable)
}

// Covers SPEC-065 CA-04 and section 3.1 (Conferência): the state of the student is graded with the conditions of the exercise that the module has:
// it passes when they hold and not when they do not, whatever the way the student got there; the conditions come from the module, so the answer
// does not depend on anything the client says.
func TestClassroomExercises_GradesTheMachine(t *testing.T) {
	ex, _, module, block, _ := moduleWith(t)
	ctx := context.Background()
	passed, err := ex.Grade(ctx, module, block, 0, json.RawMessage(machineWithTheFolder))
	require.NoError(t, err)
	assert.True(t, passed)

	passed, err = ex.Grade(ctx, module, block, 0, json.RawMessage(emptyMachineJSON))
	require.NoError(t, err)
	assert.False(t, passed)

	passed, err = ex.Grade(ctx, module, block, 3, json.RawMessage(machineWithTheFolder))
	require.NoError(t, err)
	assert.False(t, passed, "another exercise has other conditions: the user ana does not exist in this machine")

	passed, err = ex.Grade(ctx, module, block, 5, json.RawMessage(machineWithTheFolder))
	require.NoError(t, err)
	assert.False(t, passed, "an owner with a group is two conditions, and this machine meets neither")
}

// Covers SPEC-065 CA-04 and section 3.1 (Erros): what is not a machine of the simulator is an invalid state, whatever the exercise; an exercise
// that cannot be graded is unavailable, and nothing passes.
func TestClassroomExercises_RefusesWhatCannotBeGraded(t *testing.T) {
	ex, _, module, block, text := moduleWith(t)
	ctx := context.Background()
	for _, snapshot := range []string{`{`, `"pass"`, `{"formato":"outro","versao":1}`, `{"formato":"exame-so/maquina","versao":2}`, ``} {
		passed, err := ex.Grade(ctx, module, block, 0, json.RawMessage(snapshot))
		assert.ErrorIs(t, err, classroomdomain.ErrInvalidExerciseState, snapshot)
		assert.False(t, passed)
	}
	for name, index := range map[string]int{"no condition": 1, "not practical": 2, "unknown condition": 4, "no such index": 9} {
		passed, err := ex.Grade(ctx, module, block, index, json.RawMessage(machineWithTheFolder))
		assert.ErrorIs(t, err, classroomdomain.ErrExerciseUnavailable, name)
		assert.False(t, passed, name)
	}
	_, err := ex.Grade(ctx, module, text, 0, json.RawMessage(machineWithTheFolder))
	assert.ErrorIs(t, err, classroomdomain.ErrExerciseUnavailable, "a block that is not of exercises")
}
