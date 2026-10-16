package domain_test

import (
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/classroom/domain"
)

// ---- SPEC-071: the commands of the teacher in the live classroom ----

func commandField(err error) string {
	var fe *domain.FieldError
	if errors.As(err, &fe) {
		return fe.Field
	}
	return ""
}

// Covers SPEC-071 CA-05 and RN-05: a command is the terminal (1 to 3), the line as typed (trimmed, 1 to 2,000 characters, no control
// characters), the exit status (or none, when it was interrupted), the output and the moment of the server.
func TestNewTerminalCommand(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	session := uuid.New()
	zero := 0
	cmd, err := domain.NewTerminalCommand(session, 2, "  ls -la /etc  ", &zero, "total 1\n-rw-r--r-- 1 root root 0 passwd\n", false, now)
	require.NoError(t, err)
	assert.Equal(t, session, cmd.SessionID)
	assert.Equal(t, 2, cmd.Terminal)
	assert.Equal(t, "ls -la /etc", cmd.Command)
	require.NotNil(t, cmd.ExitStatus)
	assert.Equal(t, 0, *cmd.ExitStatus)
	assert.Equal(t, "total 1\n-rw-r--r-- 1 root root 0 passwd\n", cmd.Output)
	assert.False(t, cmd.OutputTruncated)
	assert.Equal(t, now, cmd.RanAt)

	interrupted, err := domain.NewTerminalCommand(session, 1, "sleep 100", nil, "", false, now)
	require.NoError(t, err)
	assert.Nil(t, interrupted.ExitStatus)
	assert.Equal(t, "", interrupted.Output)

	// the exact limits pass
	edge, err := domain.NewTerminalCommand(session, 3, strings.Repeat("x", domain.MaxCommandLength), &zero, strings.Repeat("é", domain.MaxCommandOutputLength), false, now)
	require.NoError(t, err)
	assert.False(t, edge.OutputTruncated)
	assert.Equal(t, domain.MaxCommandOutputLength, utf8.RuneCountInString(edge.Output))
}

// Covers SPEC-071 CA-05 and RN-05: the output is cut by the server at 4,000 characters (characters, not bytes) and marked; what the client
// already cut stays marked.
func TestNewTerminalCommand_OutputCut(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	zero := 0
	long := strings.Repeat("é", domain.MaxCommandOutputLength+5)
	cmd, err := domain.NewTerminalCommand(uuid.New(), 1, "yes", &zero, long, false, now)
	require.NoError(t, err)
	assert.Equal(t, domain.MaxCommandOutputLength, utf8.RuneCountInString(cmd.Output))
	assert.True(t, utf8.ValidString(cmd.Output), "cut between characters")
	assert.True(t, cmd.OutputTruncated)

	byClient, err := domain.NewTerminalCommand(uuid.New(), 1, "yes", &zero, "y\ny\n", true, now)
	require.NoError(t, err)
	assert.True(t, byClient.OutputTruncated)
}

// Covers SPEC-071 CA-05: what is refused, and which field broke.
func TestNewTerminalCommand_Invalid(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	zero := 0
	cases := []struct {
		name     string
		terminal int
		command  string
		output   string
		field    string
	}{
		{"terminal 0", 0, "ls", "", "terminal"},
		{"terminal 4", 4, "ls", "", "terminal"},
		{"empty command", 1, "", "", "command"},
		{"blank command", 1, "   ", "", "command"},
		{"command too long", 1, strings.Repeat("x", domain.MaxCommandLength+1), "", "command"},
		{"control character in the command", 1, "ls\x07", "", "command"},
		{"line break in the command", 1, "ls\nrm -rf /", "", "command"},
		{"invalid utf-8 in the command", 1, "ls \xff", "", "command"},
		{"invalid utf-8 in the output", 1, "ls", "\xff\xfe", "output"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := domain.NewTerminalCommand(uuid.New(), tc.terminal, tc.command, &zero, tc.output, false, now)
			require.ErrorIs(t, err, domain.ErrInvalidCommand)
			assert.Equal(t, tc.field, commandField(err))
		})
	}
}
