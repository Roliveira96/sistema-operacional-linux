package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	contentdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
	contentservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/service"
	cmdomain "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/domain"
	cmservice "github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/coursemodule/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/mcp/domain"
)

// fieldContext tells how to name and read the fields of a payload error: root is the JSON the field
// paths are read from (to show the value received) and rewrite turns the path the service reports into
// the path of the tool input.
type fieldContext struct {
	root    json.RawMessage
	rewrite func(string) string
}

// maxReceived is the longest value shown as received, in characters.
const maxReceived = 200

// fail translates an error of the services into the structured error of a tool (RN-04, RN-06). It
// decides nothing: every refusal comes from the service and only changes shape here. A module of someone
// else is reported as missing (RN-05).
func fail(err error, fc fieldContext) *domain.ToolError {
	var te *domain.ToolError
	var pe *contentdomain.PayloadError
	switch {
	case errors.As(err, &te):
		return te
	case errors.As(err, &pe):
		return domain.Validation("The content is not valid.", problems(pe.Fields, fc)...)
	case errors.Is(err, contentservice.ErrModuleNotFound), errors.Is(err, contentservice.ErrForbidden),
		errors.Is(err, cmdomain.ErrModuleNotFound), errors.Is(err, cmdomain.ErrForbidden):
		return domain.ModuleNotFound()
	case errors.Is(err, contentservice.ErrBlockNotFound):
		return domain.NotFound(domain.TypeBlockNotFound, "The block does not exist in this module.")
	case errors.Is(err, contentservice.ErrBlockConflict):
		return domain.NewToolError(http.StatusConflict, domain.TypeBlockConflict, "The block was changed by someone else after you read it. Read it again with get_module.")
	case errors.Is(err, contentservice.ErrInvalidCard):
		return invalid("blocks", "the blocks to keep", "must be blocks of the module and afterBlockId a block of the module")
	case errors.Is(err, contentservice.ErrExerciseNotFound):
		return domain.NotFound(domain.TypeExerciseNotFound, "The exercise does not exist in this module.")
	case errors.Is(err, contentservice.ErrExerciseConflict):
		return domain.NewToolError(http.StatusConflict, domain.TypeBlockConflict, "The exercise was changed by someone else after you read it. Read it again with get_module.")
	case errors.Is(err, contentservice.ErrInvalidExerciseOrder):
		return invalid("order", "", "must be exactly the exercises of the practice, each once")
	case errors.Is(err, contentservice.ErrExerciseIncomplete):
		return invalid("conditions", "", "required: at least one condition of finalization")
	case errors.Is(err, contentservice.ErrInvalidLinks):
		return invalid("links", "", "an exclusive exercise needs assessment=true and practice=false")
	case errors.Is(err, contentservice.ErrInvalidStatus):
		return invalid("status", "", "must be DRAFT or PUBLISHED")
	case errors.Is(err, contentservice.ErrInvalidDependency):
		return invalid("dependsOn", "", "must be another exercise of the module that does not depend on this one")
	case errors.Is(err, cmservice.ErrTitleRequired):
		return badRequest("title-required", err, "title", "required")
	case errors.Is(err, cmservice.ErrDescriptionRequired):
		return badRequest("description-required", err, "description", "required")
	case errors.Is(err, cmservice.ErrDescriptionTooLong):
		return badRequest("description-too-long", err, "description", "must have at most 20000 characters")
	case errors.Is(err, cmdomain.ErrInvalidVisibility):
		return badRequest("invalid-visibility", err, "visibility", "must be PUBLIC, AUTHENTICATED or PRIVATE")
	case errors.Is(err, cmdomain.ErrInvalidStatus):
		return badRequest("invalid-status", err, "status", "must be ACTIVE, INACTIVE or ARCHIVED")
	case errors.Is(err, cmdomain.ErrInvalidDateRange):
		return badRequest("invalid-date-range", err, "activationEnd", "must not be before the start")
	case errors.Is(err, cmdomain.ErrInvalidSlug):
		return badRequest("invalid-slug", err, "slug", "lowercase letters, digits and single hyphens, 3 to 60 characters")
	case errors.Is(err, cmdomain.ErrSlugTaken):
		return domain.NewToolError(http.StatusConflict, "slug-taken", err.Error(), domain.FieldProblem{Field: "slug", Received: missing, Expected: "a slug not used by another module"})
	case errors.Is(err, cmdomain.ErrPrivateRequiresClass):
		return badRequest("private-requires-class", err, "classIds", "at least one class for a PRIVATE module")
	}
	te = domain.NewToolError(http.StatusInternalServerError, domain.TypeInternal, "An unexpected error occurred.")
	te.Cause = err
	return te
}

// invalid builds a validation error for one field.
func invalid(field, received, expected string) *domain.ToolError {
	if received == "" {
		received = missing
	}
	return domain.Validation("The "+field+" is not valid.", domain.FieldProblem{Field: field, Received: received, Expected: expected})
}

func badRequest(errType string, err error, field, expected string) *domain.ToolError {
	return domain.NewToolError(http.StatusBadRequest, errType, err.Error(), domain.FieldProblem{Field: field, Received: missing, Expected: expected})
}

const missing = "(missing)"

// problems turns the fields of a payload error into the list of the tool error.
func problems(fields []contentdomain.FieldError, fc fieldContext) []domain.FieldProblem {
	out := make([]domain.FieldProblem, len(fields))
	for i, f := range fields {
		path := f.Field
		if fc.rewrite != nil {
			path = fc.rewrite(path)
		}
		out[i] = domain.FieldProblem{Field: path, Received: receivedAt(fc.root, path), Expected: f.Reason}
	}
	return out
}

// receivedAt reads the value at a path such as blocks[2].payload.steps[0].command out of the JSON the
// agent sent, as short JSON text. A value that is not there reads as missing.
func receivedAt(root json.RawMessage, path string) string {
	if len(root) == 0 {
		return missing
	}
	var cur any
	if err := json.Unmarshal(root, &cur); err != nil {
		return missing
	}
	for _, seg := range strings.Split(path, ".") {
		name, idx := seg, []int(nil)
		if i := strings.IndexByte(seg, '['); i >= 0 {
			name = seg[:i]
			for _, part := range strings.Split(strings.TrimSuffix(seg[i+1:], "]"), "][") {
				n, err := strconv.Atoi(part)
				if err != nil {
					return missing
				}
				idx = append(idx, n)
			}
		}
		if name != "" {
			m, ok := cur.(map[string]any)
			if !ok {
				return missing
			}
			if cur, ok = m[name]; !ok {
				return missing
			}
		}
		for _, n := range idx {
			list, ok := cur.([]any)
			if !ok || n < 0 || n >= len(list) {
				return missing
			}
			cur = list[n]
		}
	}
	b, err := json.Marshal(cur)
	if err != nil {
		return missing
	}
	text := string(b)
	if utf8.RuneCountInString(text) > maxReceived {
		text = string([]rune(text)[:maxReceived]) + "..."
	}
	return text
}
