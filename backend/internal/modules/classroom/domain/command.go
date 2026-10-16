package domain

import (
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/database"
)

// The commands of the teacher in the live classroom (SPEC-071 RN-05, RN-06).
const (
	MinTerminal = 1
	MaxTerminal = 3

	MaxCommandLength       = 2000 // characters, not bytes
	MaxCommandOutputLength = 4000
	MaxCommandsPerSession  = 2000
)

// Errors of the commands.
var (
	ErrInvalidCommand = errors.New("the command needs a terminal from 1 to 3, a line of 1 to 2000 characters with no control characters, and a valid output")
	ErrCommandLimit   = errors.New("the live classroom already has 2000 commands")
)

// LiveTerminalCommand is a line the teacher ran in the presentation window: the terminal, the line as typed, the exit status (nil when the
// command was interrupted and had none), what it printed (cut at MaxCommandOutputLength, and marked) and the moment of the server.
type LiveTerminalCommand struct {
	database.Model
	SessionID       uuid.UUID
	Terminal        int
	Command         string
	ExitStatus      *int
	Output          string
	OutputTruncated bool
	RanAt           time.Time
}

// TableName maps LiveTerminalCommand to its table.
func (LiveTerminalCommand) TableName() string { return "live_terminal_commands" }

// NewTerminalCommand checks a command the presentation window sent and makes the row of it, with now as the moment it ran (SPEC-071 RN-05):
// the terminal is one of the three; the line is trimmed, has from 1 to MaxCommandLength characters and no control character; the output is
// valid text, cut at MaxCommandOutputLength characters when longer, which marks it as truncated, like the client does when it cut it itself.
func NewTerminalCommand(sessionID uuid.UUID, terminal int, command string, exitStatus *int, output string, truncated bool, now time.Time) (LiveTerminalCommand, error) {
	if terminal < MinTerminal || terminal > MaxTerminal {
		return LiveTerminalCommand{}, &FieldError{Field: "terminal", Err: ErrInvalidCommand}
	}
	line := strings.TrimSpace(command)
	if !utf8.ValidString(line) || line == "" || utf8.RuneCountInString(line) > MaxCommandLength {
		return LiveTerminalCommand{}, &FieldError{Field: "command", Err: ErrInvalidCommand}
	}
	for _, r := range line {
		if unicode.IsControl(r) {
			return LiveTerminalCommand{}, &FieldError{Field: "command", Err: ErrInvalidCommand}
		}
	}
	if !utf8.ValidString(output) {
		return LiveTerminalCommand{}, &FieldError{Field: "output", Err: ErrInvalidCommand}
	}
	if utf8.RuneCountInString(output) > MaxCommandOutputLength {
		runes := []rune(output)
		output, truncated = string(runes[:MaxCommandOutputLength]), true
	}
	return LiveTerminalCommand{SessionID: sessionID, Terminal: terminal, Command: line, ExitStatus: exitStatus, Output: output,
		OutputTruncated: truncated, RanAt: now}, nil
}
