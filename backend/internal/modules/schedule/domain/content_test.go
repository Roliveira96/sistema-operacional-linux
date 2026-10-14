package domain_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/schedule/domain"
)

func contentField(err error) string {
	var fe *domain.FieldError
	if errors.As(err, &fe) {
		return fe.Field
	}
	return ""
}

// Covers SPEC-053 RN-01 and CA-03: the topic is trimmed, empty means none, and it has at most 120 characters.
func TestNormalizeTopic(t *testing.T) {
	got, err := domain.NormalizeTopic("  Permissões de arquivos  ")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "Permissões de arquivos", *got)

	for _, empty := range []string{"", "   "} {
		got, err = domain.NormalizeTopic(empty)
		require.NoError(t, err)
		assert.Nil(t, got, "empty means no topic")
	}

	got, err = domain.NormalizeTopic(strings.Repeat("a", 120))
	require.NoError(t, err)
	assert.NotNil(t, got)

	_, err = domain.NormalizeTopic(strings.Repeat("a", 121))
	assert.ErrorIs(t, err, domain.ErrInvalidSessionContent)
	assert.Equal(t, "topic", contentField(err))
}

// Covers SPEC-053 RN-01: the links come trimmed, in the order sent, with their position and the session.
func TestBuildSessionLinks(t *testing.T) {
	session := uuid.New()
	links, err := domain.BuildSessionLinks(session, []domain.LinkInput{
		{Name: "  Meet  ", URL: " https://meet.google.com/abc "},
		{Name: "Slides", URL: "https://example.com/slides?x=1#a"},
	})
	require.NoError(t, err)
	require.Len(t, links, 2)
	assert.Equal(t, "Meet", links[0].Name)
	assert.Equal(t, "https://meet.google.com/abc", links[0].URL)
	assert.Equal(t, []int{0, 1}, []int{links[0].Position, links[1].Position})
	assert.Equal(t, session, links[0].SessionID)
	assert.NotEqual(t, uuid.Nil, links[0].ID)
	assert.NotEqual(t, links[0].ID, links[1].ID)

	none, err := domain.BuildSessionLinks(session, nil)
	require.NoError(t, err)
	assert.Empty(t, none)
}

// Covers SPEC-053 CA-03: the item and the field that broke a rule, and the limit of 10 links.
func TestBuildSessionLinksRejects(t *testing.T) {
	cases := []struct {
		name  string
		in    []domain.LinkInput
		field string
	}{
		{"empty name", []domain.LinkInput{{Name: "ok", URL: "https://a.com"}, {Name: " ", URL: "https://a.com"}}, "links[1].name"},
		{"long name", []domain.LinkInput{{Name: strings.Repeat("a", 81), URL: "https://a.com"}}, "links[0].name"},
		{"http", []domain.LinkInput{{Name: "x", URL: "http://a.com"}}, "links[0].url"},
		{"javascript", []domain.LinkInput{{Name: "x", URL: "javascript:alert(1)"}}, "links[0].url"},
		{"no host", []domain.LinkInput{{Name: "x", URL: "https://"}}, "links[0].url"},
		{"space", []domain.LinkInput{{Name: "x", URL: "https://a b.com"}}, "links[0].url"},
		{"long url", []domain.LinkInput{{Name: "x", URL: "https://a.com/" + strings.Repeat("a", 2000)}}, "links[0].url"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := domain.BuildSessionLinks(uuid.New(), tc.in)
			assert.ErrorIs(t, err, domain.ErrInvalidSessionContent)
			assert.Equal(t, tc.field, contentField(err))
		})
	}

	ten := make([]domain.LinkInput, 10)
	eleven := make([]domain.LinkInput, 11)
	for i := range eleven {
		eleven[i] = domain.LinkInput{Name: "link", URL: "https://a.com"}
		if i < 10 {
			ten[i] = eleven[i]
		}
	}
	links, err := domain.BuildSessionLinks(uuid.New(), ten)
	require.NoError(t, err)
	assert.Len(t, links, 10)
	_, err = domain.BuildSessionLinks(uuid.New(), eleven)
	assert.ErrorIs(t, err, domain.ErrInvalidSessionContent)
	assert.Equal(t, "links", contentField(err))
}
