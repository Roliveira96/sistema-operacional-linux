package domain_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
)

func TestCanUse(t *testing.T) {
	assert.True(t, domain.CanUse("ADMIN"))
	assert.True(t, domain.CanUse("TEACHER"))
	assert.False(t, domain.CanUse("STUDENT"))
	assert.False(t, domain.CanUse(""))
}

func TestCatalogIsWellFormedAndHasNoPublishTool(t *testing.T) { // CA-12, CA-20
	specs := domain.Catalog()
	assert.Len(t, specs, 18)
	seen := map[string]bool{}
	writes := 0
	for _, s := range specs {
		assert.False(t, seen[s.Name], "duplicate tool %s", s.Name)
		seen[s.Name] = true
		assert.Equal(t, "object", s.InputSchema["type"], s.Name)
		_, err := json.Marshal(s.InputSchema)
		require.NoError(t, err, s.Name)
		assert.NotEmpty(t, s.Description, s.Name)
		lower := strings.ToLower(s.Name)
		assert.False(t, strings.Contains(lower, "publish") || strings.Contains(lower, "restore") || strings.Contains(lower, "test_result"), s.Name)
		if s.Write {
			writes++
		}
		if s.Write && s.Name != domain.ToolArchiveModule && s.Name != domain.ToolUpdateModuleMetadata && s.Name != domain.ToolCreateStudents {
			assert.Contains(t, s.Description, "web app", "content tools say publishing is in the web app: %s", s.Name)
		}
	}
	assert.Equal(t, 12, writes)
	assert.Equal(t, 18, len(domain.Names()))
}

func TestToolErrors(t *testing.T) {
	e := domain.Validation("bad", domain.FieldProblem{Field: "a.b", Received: "1", Expected: "2"})
	assert.Equal(t, 400, e.Status)
	assert.Equal(t, "validation-error", e.Type)
	assert.Equal(t, "Bad Request", e.Title)
	assert.Equal(t, "validation-error: bad", e.Error())
	b, err := json.Marshal(e)
	require.NoError(t, err)
	assert.JSONEq(t, `{"type":"validation-error","title":"Bad Request","status":400,"detail":"bad","fields":[{"field":"a.b","received":"1","expected":"2"}]}`, string(b))

	nf := domain.ModuleNotFound()
	assert.Equal(t, 404, nf.Status)
	assert.Equal(t, domain.TypeModuleNotFound, nf.Type)
	assert.Equal(t, 404, domain.NotFound(domain.TypeBlockNotFound, "x").Status)
}

// Covers SPEC-088 CA-05 (RN-04): the tool that creates an exercise says what links it gets when none are given.
func TestCreateModuleExerciseToolSaysTheDefaultLinks(t *testing.T) {
	for _, s := range domain.Catalog() {
		if s.Name != domain.ToolCreateModuleExercise {
			continue
		}
		raw, err := json.Marshal(s.InputSchema)
		require.NoError(t, err)
		var schema struct {
			Properties struct {
				Links struct {
					Description string `json:"description"`
				} `json:"links"`
			} `json:"properties"`
		}
		require.NoError(t, json.Unmarshal(raw, &schema))
		assert.Contains(t, schema.Properties.Links.Description, "practice and assessment", "the links field says its default")
		assert.Contains(t, s.Description, "practice and assessment", "the tool says the default too")
		return
	}
	t.Fatal("create_module_exercise is not in the catalog")
}
