package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classlink/domain"
)

func field(err error) string {
	var fe *domain.FieldError
	if errors.As(err, &fe) {
		return fe.Field
	}
	return ""
}

// Covers SPEC-048 RN-01 and RN-03: the links come trimmed, in the order sent, with their position.
func TestBuildLinks(t *testing.T) {
	class := uuid.New()
	links, err := domain.BuildLinks(class, []domain.Input{
		{Name: "  Link do Meet  ", URL: " https://meet.google.com/abc-defg-hij "},
		{Name: "Conteúdo da aula 3", URL: "https://example.com/aula-3?x=1#topo"},
	})
	require.NoError(t, err)
	require.Len(t, links, 2)
	assert.Equal(t, "Link do Meet", links[0].Name)
	assert.Equal(t, "https://meet.google.com/abc-defg-hij", links[0].URL)
	assert.Equal(t, 0, links[0].Position)
	assert.Equal(t, 1, links[1].Position)
	assert.Equal(t, class, links[0].ClassID)
	assert.NotEqual(t, uuid.Nil, links[0].ID)
	assert.NotEqual(t, links[0].ID, links[1].ID)
}

// Covers SPEC-048 CA-02: an empty list is valid and removes every link.
func TestBuildLinksEmpty(t *testing.T) {
	links, err := domain.BuildLinks(uuid.New(), nil)
	require.NoError(t, err)
	assert.Empty(t, links)
}

// Covers SPEC-048 CA-03 and RN-01: the item and the field that broke a rule.
func TestBuildLinksRejectsBadItems(t *testing.T) {
	cases := []struct {
		name  string
		input []domain.Input
		field string
	}{
		{"empty name", []domain.Input{{Name: "ok", URL: "https://a.com"}, {Name: "  ", URL: "https://a.com"}}, "links[1].name"},
		{"long name", []domain.Input{{Name: strings.Repeat("a", 81), URL: "https://a.com"}}, "links[0].name"},
		{"empty url", []domain.Input{{Name: "x", URL: ""}}, "links[0].url"},
		{"http", []domain.Input{{Name: "x", URL: "http://a.com"}}, "links[0].url"},
		{"javascript", []domain.Input{{Name: "x", URL: "javascript:alert(1)"}}, "links[0].url"},
		{"data", []domain.Input{{Name: "x", URL: "data:text/html;base64,AAAA"}}, "links[0].url"},
		{"no scheme", []domain.Input{{Name: "x", URL: "meet.google.com/abc"}}, "links[0].url"},
		{"no host", []domain.Input{{Name: "x", URL: "https://"}}, "links[0].url"},
		{"space inside", []domain.Input{{Name: "x", URL: "https://a b.com"}}, "links[0].url"},
		{"long url", []domain.Input{{Name: "x", URL: "https://a.com/" + strings.Repeat("a", 2000)}}, "links[0].url"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := domain.BuildLinks(uuid.New(), tc.input)
			require.Error(t, err)
			assert.ErrorIs(t, err, domain.ErrInvalidLink)
			assert.Equal(t, tc.field, field(err))
		})
	}
	// The limits are inclusive: 80 characters of name and 2000 of address are fine.
	_, err := domain.BuildLinks(uuid.New(), []domain.Input{{Name: strings.Repeat("a", 80), URL: "https://a.com/" + strings.Repeat("b", 1986)}})
	assert.NoError(t, err)
}

// Covers SPEC-048 CA-04 and RN-02: at most 20 links.
func TestBuildLinksLimit(t *testing.T) {
	make20 := func(n int) []domain.Input {
		in := make([]domain.Input, n)
		for i := range in {
			in[i] = domain.Input{Name: "link", URL: "https://a.com"}
		}
		return in
	}
	links, err := domain.BuildLinks(uuid.New(), make20(20))
	require.NoError(t, err)
	assert.Len(t, links, 20)
	_, err = domain.BuildLinks(uuid.New(), make20(21))
	assert.ErrorIs(t, err, domain.ErrTooManyLinks)
}
