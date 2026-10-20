// Package domain holds the vocabulary of the MCP server for module authoring (SPEC-024): the tool
// names, the structured tool error (RN-06) and the catalog of tools with their descriptions (RN-12).
package domain

import (
	"net/http"
	"slices"
)

// Roles allowed to use the MCP server (SPEC-024 RN-03).
const (
	RoleAdmin   = "ADMIN"
	RoleTeacher = "TEACHER"
)

// CanUse reports whether a user with the role may use the MCP server.
func CanUse(role string) bool { return role == RoleAdmin || role == RoleTeacher }

// Tool names (SPEC-024 3.2). There is no tool to publish or restore a version, nor to record a test
// result: those stay in the web application (RN-08, CA-12, CA-20).
const (
	ToolListModules          = "list_modules"
	ToolGetModule            = "get_module"
	ToolCreateModule         = "create_module"
	ToolUpdateModuleMetadata = "update_module_metadata"
	ToolArchiveModule        = "archive_module"
	ToolAppendContentBlocks  = "append_content_blocks"
	ToolUpdateContentBlock   = "update_content_block"
	ToolReplaceContentBlocks = "replace_content_blocks"
	ToolSetModuleSetup       = "set_module_setup"
	ToolCreateModuleExercise = "create_module_exercise"
	ToolUpdateModuleExercise = "update_module_exercise"
	ToolSetExerciseSetup     = "set_exercise_setup"
	ToolValidateModule       = "validate_module"
	ToolListModuleVersions   = "list_module_versions"
	// The correction of descriptive answers (SPEC-039 RN-04): the agent suggests, the teacher confirms in the web app.
	ToolListPendingAnswers = "list_pending_answers"
	ToolGetAnswer          = "get_answer"
	ToolSuggestGrade       = "suggest_grade"
	// The registration of students (SPEC-045): the agent creates students and enrolls them in a class.
	ToolCreateStudents = "create_students"
)

// Error types (the same slugs the REST layer uses in its RFC 7807 problems).
const (
	TypeValidation         = "validation-error"
	TypeModuleNotFound     = "module-not-found"
	TypeBlockNotFound      = "block-not-found"
	TypeExerciseNotFound   = "exercise-not-found"
	TypeAnswerNotFound     = "answer-not-found"
	TypeBlockConflict      = "block-conflict"
	TypeQuestionInUse      = "question-in-use"
	TypeForbidden          = "forbidden"
	TypeRateLimited        = "rate-limited"
	TypeInternal           = "internal-error"
	TypeInvalidAccessToken = "invalid-access-token"
)

// FieldProblem is one invalid field: where it is, what was received and what is expected (RN-06).
type FieldProblem struct {
	Field    string `json:"field"`
	Received string `json:"received"`
	Expected string `json:"expected"`
	// Ref identifies the block or exercise the problem belongs to, when it came from a stored draft.
	Ref string `json:"ref,omitempty"`
}

// ToolError is the structured error of a tool, returned as a tool result with the error flag set so the
// agent can read it and correct itself (RN-06).
type ToolError struct {
	Type   string         `json:"type"`
	Title  string         `json:"title"`
	Status int            `json:"status"`
	Detail string         `json:"detail"`
	Fields []FieldProblem `json:"fields,omitempty"`
	// Cause is the underlying error of an internal failure. It is never sent to the agent; the handler logs it.
	Cause error `json:"-"`
}

// Error implements the error interface.
func (e *ToolError) Error() string { return e.Type + ": " + e.Detail }

// NewToolError builds an error with the standard HTTP title of the status.
func NewToolError(status int, errType, detail string, fields ...FieldProblem) *ToolError {
	return &ToolError{Type: errType, Title: http.StatusText(status), Status: status, Detail: detail, Fields: fields}
}

// Validation builds a validation-error listing the invalid fields.
func Validation(detail string, fields ...FieldProblem) *ToolError {
	return NewToolError(http.StatusBadRequest, TypeValidation, detail, fields...)
}

// NotFound builds a 404 error of the given type.
func NotFound(errType, detail string) *ToolError {
	return NewToolError(http.StatusNotFound, errType, detail)
}

// ModuleNotFound is what a missing module and a module of someone else both look like (RN-05).
func ModuleNotFound() *ToolError {
	return NotFound(TypeModuleNotFound, "The module does not exist.")
}

// ToolSpec describes one tool of the server.
type ToolSpec struct {
	Name        string
	Description string
	// Write tells the tool changes data: it is rate limited and audited (RN-10, RN-11).
	Write       bool
	InputSchema map[string]any
}

// Names lists the tool names of the catalog, in order.
func Names() []string {
	specs := Catalog()
	out := make([]string, len(specs))
	for i, s := range specs {
		out[i] = s.Name
	}
	return out
}

// IsWrite reports whether the named tool changes data.
func IsWrite(name string) bool {
	i := slices.IndexFunc(Catalog(), func(s ToolSpec) bool { return s.Name == name })
	return i >= 0 && Catalog()[i].Write
}
