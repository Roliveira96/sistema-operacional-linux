package problem

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestConstructorsSetStatusAndTitle(t *testing.T) {
	cases := []struct {
		p      *Problem
		status int
		typ    string
	}{
		{Validation("bad"), http.StatusBadRequest, "validation-error"},
		{BadRequest("weak-password", "x"), http.StatusBadRequest, "weak-password"},
		{Unauthorized("invalid-credentials", "x"), http.StatusUnauthorized, "invalid-credentials"},
		{Forbidden("forbidden", "x"), http.StatusForbidden, "forbidden"},
		{NotFound("invite-not-found", "x"), http.StatusNotFound, "invite-not-found"},
		{Conflict("email-already-registered", "x"), http.StatusConflict, "email-already-registered"},
		{Gone("reset-token-invalid", "x"), http.StatusGone, "reset-token-invalid"},
		{PayloadTooLarge("x"), http.StatusRequestEntityTooLarge, "file-too-large"},
		{TooManyRequests("x", 30), http.StatusTooManyRequests, "rate-limited"},
		{Internal(), http.StatusInternalServerError, "internal-error"},
		{ServiceUnavailable("x"), http.StatusServiceUnavailable, "service-unavailable"},
	}
	for _, tc := range cases {
		if tc.p.Status != tc.status || tc.p.Type != tc.typ || tc.p.Title != http.StatusText(tc.status) {
			t.Errorf("got %+v, want status %d type %s", tc.p, tc.status, tc.typ)
		}
	}
}

func TestMarshalIncludesOptionalMembersAndExtensions(t *testing.T) {
	p := Validation("Invalid fields.", InvalidParam{Name: "email", Reason: "invalid format"})
	p.Instance = "/api/v1/students"
	p.WithExtension("components", []string{"postgres"})

	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"type", "title", "status", "detail", "instance", "invalidParams", "components"} {
		if _, ok := body[key]; !ok {
			t.Errorf("missing member %s in %s", key, raw)
		}
	}
	if _, ok := body["retryAfterSeconds"]; ok {
		t.Error("retryAfterSeconds must be omitted when zero")
	}
}

func TestProblemIsAnError(t *testing.T) {
	var err error = Conflict("email-already-registered", "taken")
	var p *Problem
	if !errors.As(err, &p) || p.Status != http.StatusConflict {
		t.Fatalf("errors.As failed: %v", err)
	}
}
