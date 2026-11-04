package domain_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/assessment/domain"
)

// Covers SPEC-093 CA-03 (RN-02): the text is trimmed, from 1 to 500 characters, without control characters but the new line and with at most 3 new
// lines in a row.
func TestNormalizeChatText_TrimsLimitsAndRefusesControlCharacters(t *testing.T) {
	got, err := domain.NormalizeChat("  Posso usar o man?\n ")
	require.NoError(t, err)
	assert.Equal(t, "Posso usar o man?", got)
	got, err = domain.NormalizeChat("a\n\n\nb")
	require.NoError(t, err)
	assert.Equal(t, "a\n\n\nb", got)
	got, err = domain.NormalizeChat(strings.Repeat("é", 500))
	require.NoError(t, err, "500 characters, not bytes")
	assert.Len(t, []rune(got), 500)

	for name, bad := range map[string]string{
		"empty": "", "only spaces": "   ", "too long": strings.Repeat("é", 501), "four new lines": "a\n\n\n\nb", "a control character": "a\x00b", "a tab": "a\tb",
	} {
		_, err := domain.NormalizeChat(bad)
		assert.ErrorIs(t, err, domain.ErrInvalidChat, name)
	}
}

// Covers SPEC-093 RN-03: a message with an attempt is of its conversation; without one it is for everybody.
func TestChatMessage_Scope(t *testing.T) {
	assert.Equal(t, domain.ChatAll, domain.ChatMessage{}.Scope())
	id := domain.ChatMessage{}.ID
	assert.Equal(t, domain.ChatPrivate, domain.ChatMessage{AttemptID: &id}.Scope())
}
