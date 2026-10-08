// Package problem implements RFC 7807 Problem Details responses. A *Problem is
// an error, so services and handlers can return it and the error middleware
// serializes it.
package problem

import (
	"encoding/json"
	"net/http"
)

// ContentType is the media type of every error response.
const ContentType = "application/problem+json"

// Problem is an RFC 7807 problem detail. Type is a stable kebab-case slug.
type Problem struct {
	Type              string
	Title             string
	Status            int
	Detail            string
	Instance          string
	InvalidParams     []InvalidParam
	RetryAfterSeconds int
	// Extensions holds additional members serialized at the top level.
	Extensions map[string]any
}

// InvalidParam describes one field that failed validation.
type InvalidParam struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}

// Error implements the error interface.
func (p *Problem) Error() string {
	if p.Detail != "" {
		return p.Type + ": " + p.Detail
	}
	return p.Type
}

// MarshalJSON writes the standard members, the optional ones when set and the
// extensions at the top level, as RFC 7807 requires.
func (p *Problem) MarshalJSON() ([]byte, error) {
	body := make(map[string]any, 6+len(p.Extensions))
	for k, v := range p.Extensions {
		body[k] = v
	}
	body["type"] = p.Type
	body["title"] = p.Title
	body["status"] = p.Status
	if p.Detail != "" {
		body["detail"] = p.Detail
	}
	if p.Instance != "" {
		body["instance"] = p.Instance
	}
	if len(p.InvalidParams) > 0 {
		body["invalidParams"] = p.InvalidParams
	}
	if p.RetryAfterSeconds > 0 {
		body["retryAfterSeconds"] = p.RetryAfterSeconds
	}
	return json.Marshal(body)
}

// WithExtension returns the problem with an extra top-level member.
func (p *Problem) WithExtension(key string, value any) *Problem {
	if p.Extensions == nil {
		p.Extensions = map[string]any{}
	}
	p.Extensions[key] = value
	return p
}

// New builds a problem with the standard HTTP title for status.
func New(status int, problemType, detail string) *Problem {
	return &Problem{
		Type:   problemType,
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
	}
}

// Validation builds a 400 validation-error listing the invalid fields.
func Validation(detail string, params ...InvalidParam) *Problem {
	p := New(http.StatusBadRequest, "validation-error", detail)
	p.InvalidParams = params
	return p
}

// BadRequest builds a 400 problem with a specific type.
func BadRequest(problemType, detail string) *Problem {
	return New(http.StatusBadRequest, problemType, detail)
}

// Unauthorized builds a 401 problem.
func Unauthorized(problemType, detail string) *Problem {
	return New(http.StatusUnauthorized, problemType, detail)
}

// Forbidden builds a 403 problem.
func Forbidden(problemType, detail string) *Problem {
	return New(http.StatusForbidden, problemType, detail)
}

// NotFound builds a 404 problem.
func NotFound(problemType, detail string) *Problem {
	return New(http.StatusNotFound, problemType, detail)
}

// Conflict builds a 409 problem.
func Conflict(problemType, detail string) *Problem {
	return New(http.StatusConflict, problemType, detail)
}

// Gone builds a 410 problem.
func Gone(problemType, detail string) *Problem {
	return New(http.StatusGone, problemType, detail)
}

// PayloadTooLarge builds a 413 file-too-large problem.
func PayloadTooLarge(detail string) *Problem {
	return New(http.StatusRequestEntityTooLarge, "file-too-large", detail)
}

// TooManyRequests builds a 429 rate-limited problem. The error middleware also
// sets the Retry-After header from RetryAfterSeconds.
func TooManyRequests(detail string, retryAfterSeconds int) *Problem {
	p := New(http.StatusTooManyRequests, "rate-limited", detail)
	p.RetryAfterSeconds = retryAfterSeconds
	return p
}

// Internal builds a generic 500 problem without internal details.
func Internal() *Problem {
	return New(http.StatusInternalServerError, "internal-error", "An unexpected error occurred.")
}

// ServiceUnavailable builds a 503 service-unavailable problem.
func ServiceUnavailable(detail string) *Problem {
	return New(http.StatusServiceUnavailable, "service-unavailable", detail)
}
