package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Limits of the authored fields (SPEC-019 RN-03, RN-05).
const (
	MaxHTMLLength        = 50000
	MaxTitleLength       = 200
	MaxCommandLength     = 500
	MaxExplanationLength = 1000
	MaxCommandSteps      = 50
	MaxStepTexts         = 50
	MaxCards             = 30
	MaxSetupSummary      = 500
	MaxSetupSteps        = 200
	MaxSetupAnswers      = 20
	// A snapshot also carries files as data (SPEC-021 RN-12): logs, pages and the like, as large as these limits.
	MaxSetupFiles      = 200
	MaxSetupFileBytes  = 1 << 20
	MaxSetupFilesBytes = 4 << 20
	MaxSetupFilePath   = 500
)

// Widget components a block may show (SPEC-019 RN-03).
var widgetComponents = map[string]bool{"PERMISSION_CALCULATOR": true, "LS_ANATOMY": true}

// FieldError names a payload field that failed validation.
type FieldError struct {
	Field  string
	Reason string
}

// PayloadError lists everything wrong with a payload, so the editor can mark each field.
type PayloadError struct {
	Fields []FieldError
}

// Error implements the error interface.
func (e *PayloadError) Error() string {
	parts := make([]string, len(e.Fields))
	for i, f := range e.Fields {
		parts[i] = f.Field + ": " + f.Reason
	}
	return "invalid block payload: " + strings.Join(parts, "; ")
}

type checker struct {
	s      *HTMLSanitizer
	errs   []FieldError
	failed map[string]bool
}

func (c *checker) fail(field, reason string) {
	if c.failed[field] {
		return
	}
	if c.failed == nil {
		c.failed = map[string]bool{}
	}
	c.failed[field] = true
	c.errs = append(c.errs, FieldError{field, reason})
}

func (c *checker) text(field, value string, max int, required bool) string {
	value = strings.TrimSpace(value)
	if required && value == "" {
		c.fail(field, "required")
	}
	if utf8.RuneCountInString(value) > max {
		c.fail(field, fmt.Sprintf("must have at most %d characters", max))
	}
	return value
}

var tags = regexp.MustCompile(`<[^>]*>`)

// html filters the markup (RN-04) and requires visible content after the filter.
func (c *checker) html(field, value string, required bool) string {
	if utf8.RuneCountInString(value) > MaxHTMLLength {
		c.fail(field, fmt.Sprintf("must have at most %d characters", MaxHTMLLength))
		return ""
	}
	clean := strings.TrimSpace(c.s.Sanitize(value))
	if required && strings.TrimSpace(tags.ReplaceAllString(clean, "")) == "" {
		c.fail(field, "required")
	}
	return clean
}

// setupStep is one command of a snapshot: the same step as a practical command (SPEC-021 3.1).
type setupStep struct {
	Command  string        `json:"command"`
	Terminal *int          `json:"terminal,omitempty"`
	Login    *loginPayload `json:"login,omitempty"`
	Answers  []string      `json:"answers,omitempty"`
}

// setupFile is a file the machine of the student gets as it is, after the commands of the snapshot ran (SPEC-021 RN-12).
// The content is kept exactly as written; mode, owner and group are optional.
type setupFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Mode    string `json:"mode,omitempty"`
	Owner   string `json:"owner,omitempty"`
	Group   string `json:"group,omitempty"`
}

// setupPayload is a snapshot: a script of commands and a set of files the machine of the student is prepared with.
type setupPayload struct {
	Summary string      `json:"summary,omitempty"`
	Steps   []setupStep `json:"steps"`
	Files   []setupFile `json:"files,omitempty"`
}

type textPayload struct {
	Title   string        `json:"title,omitempty"`
	Command string        `json:"command,omitempty"`
	HTML    string        `json:"html"`
	Setup   *setupPayload `json:"setup,omitempty"`
}

type tipPayload struct {
	Title   string `json:"title,omitempty"`
	Variant string `json:"variant"`
	HTML    string `json:"html"`
}

type titledHTMLPayload struct {
	Title string `json:"title,omitempty"`
	HTML  string `json:"html"`
}

type htmlPayload struct {
	HTML string `json:"html"`
}

type loginPayload struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

type commandStep struct {
	Command           string `json:"command"`
	Explanation       string `json:"explanation,omitempty"`
	OutputExplanation string `json:"outputExplanation,omitempty"`
	// ExpectError marks a command that must fail on purpose (SPEC-020 RN-06).
	ExpectError bool          `json:"expectError,omitempty"`
	Terminal    *int          `json:"terminal,omitempty"`
	Login       *loginPayload `json:"login,omitempty"`
	Answers     []string      `json:"answers,omitempty"`
}

type commandPayload struct {
	Steps []commandStep `json:"steps"`
}

type stepsPayload struct {
	Steps []string `json:"steps"`
}

type card struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

type cardsPayload struct {
	Cards []card `json:"cards"`
}

type widgetPayload struct {
	Component string         `json:"component"`
	Params    map[string]any `json:"params"`
}

// setup checks a snapshot: the commands, their terminals and logins, and the answers (SPEC-021 RN-01).
func (c *checker) setup(prefix string, p *setupPayload) {
	p.Summary = c.text(prefix+".summary", p.Summary, MaxSetupSummary, false)
	if len(p.Steps) > MaxSetupSteps {
		c.fail(prefix+".steps", fmt.Sprintf("must have at most %d steps", MaxSetupSteps))
		return
	}
	if p.Steps == nil {
		p.Steps = []setupStep{}
	}
	for i := range p.Steps {
		st := &p.Steps[i]
		at := func(name string) string { return fmt.Sprintf("%s.steps[%d].%s", prefix, i, name) }
		st.Command = c.text(at("command"), st.Command, MaxCommandLength, true)
		if st.Terminal != nil && (*st.Terminal < 1 || *st.Terminal > 3) {
			c.fail(at("terminal"), "must be from 1 to 3")
		}
		if st.Login != nil {
			st.Login.User = strings.TrimSpace(st.Login.User)
			if st.Login.User == "" || st.Login.Password == "" {
				c.fail(at("login"), "user and password must be given together")
			}
		}
		if len(st.Answers) > MaxSetupAnswers {
			c.fail(at("answers"), fmt.Sprintf("must have at most %d answers", MaxSetupAnswers))
			continue
		}
		for j := range st.Answers {
			st.Answers[j] = c.text(fmt.Sprintf("%s.steps[%d].answers[%d]", prefix, i, j), st.Answers[j], MaxCommandLength, false)
		}
	}
	c.setupFiles(prefix, p)
}

var (
	fileMode = regexp.MustCompile(`^[0-7]{3,4}$`)
	accName  = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)
)

// setupFiles checks the files of a snapshot: absolute paths, text without NUL, bounded sizes (SPEC-021 RN-12).
func (c *checker) setupFiles(prefix string, p *setupPayload) {
	if len(p.Files) > MaxSetupFiles {
		c.fail(prefix+".files", fmt.Sprintf("must have at most %d files", MaxSetupFiles))
		return
	}
	seen := map[string]bool{}
	total := 0
	for i := range p.Files {
		f := &p.Files[i]
		at := func(name string) string { return fmt.Sprintf("%s.files[%d].%s", prefix, i, name) }
		f.Path = strings.TrimSpace(f.Path)
		switch {
		case !strings.HasPrefix(f.Path, "/") || f.Path == "/" || strings.HasSuffix(f.Path, "/"):
			c.fail(at("path"), "must be the absolute path of a file")
		case utf8.RuneCountInString(f.Path) > MaxSetupFilePath:
			c.fail(at("path"), fmt.Sprintf("must have at most %d characters", MaxSetupFilePath))
		case strings.ContainsRune(f.Path, 0) || hasDotDot(f.Path):
			c.fail(at("path"), "must not contain .. or NUL")
		case seen[f.Path]:
			c.fail(at("path"), "must not repeat")
		}
		seen[f.Path] = true
		if strings.ContainsRune(f.Content, 0) {
			c.fail(at("content"), "must be text, without NUL")
		}
		if len(f.Content) > MaxSetupFileBytes {
			c.fail(at("content"), fmt.Sprintf("must have at most %d bytes", MaxSetupFileBytes))
		}
		total += len(f.Content)
		if f.Mode != "" && !fileMode.MatchString(f.Mode) {
			c.fail(at("mode"), "must be octal, like 644")
		}
		if f.Owner != "" && !accName.MatchString(f.Owner) {
			c.fail(at("owner"), "must be a user name")
		}
		if f.Group != "" && !accName.MatchString(f.Group) {
			c.fail(at("group"), "must be a group name")
		}
	}
	if total > MaxSetupFilesBytes {
		c.fail(prefix+".files", fmt.Sprintf("must have at most %d bytes in total", MaxSetupFilesBytes))
	}
}

func hasDotDot(path string) bool {
	for _, part := range strings.Split(path, "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

// NormalizeSetup checks a snapshot and returns it trimmed, ready to be stored. A *PayloadError
// lists the invalid fields, named under "setup".
func NormalizeSetup(raw json.RawMessage) (json.RawMessage, error) {
	var p setupPayload
	if err := decode(raw, &p); err != nil {
		return nil, &PayloadError{Fields: []FieldError{{"setup", "must be an object with a list of steps"}}}
	}
	c := &checker{}
	c.setup("setup", &p)
	if len(c.errs) > 0 {
		return nil, &PayloadError{Fields: c.errs}
	}
	return marshalNoEscape(p)
}

func decode(raw json.RawMessage, into any) error {
	return json.NewDecoder(bytes.NewReader(raw)).Decode(into)
}

// NormalizePayload checks the payload against the structure of its block type
// and returns it filtered and trimmed, ready to be stored (SPEC-019 RN-03 to RN-05).
// A *PayloadError lists the invalid fields.
func NormalizePayload(t BlockType, raw json.RawMessage, s *HTMLSanitizer) (json.RawMessage, error) {
	if !ValidBlockType(t) {
		return nil, &PayloadError{Fields: []FieldError{{"type", "unknown block type"}}}
	}
	c := &checker{s: s}
	var out any
	if err := decodeFor(t, raw, c, &out); err != nil {
		return nil, &PayloadError{Fields: []FieldError{{"payload", "must be a JSON object with the fields of the block type"}}}
	}
	if len(c.errs) > 0 {
		return nil, &PayloadError{Fields: c.errs}
	}
	return marshalNoEscape(out)
}

// marshalNoEscape writes JSON with the markup as written, not as \u003c escapes.
func marshalNoEscape(v any) (json.RawMessage, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return json.RawMessage(bytes.TrimSpace(buf.Bytes())), nil
}

func decodeFor(t BlockType, raw json.RawMessage, c *checker, out *any) error {
	switch t {
	case BlockText:
		var p textPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		p.Title = c.text("title", p.Title, MaxTitleLength, false)
		p.Command = c.text("command", p.Command, MaxCommandLength, false)
		// A text with a title opens a card and may carry no text of its own (SPEC-019).
		p.HTML = c.html("html", p.HTML, p.Title == "")
		if p.Setup != nil {
			if p.Title == "" {
				c.fail("setup", "only a card with a title can have a snapshot")
			} else {
				c.setup("setup", p.Setup)
			}
		}
		*out = p
	case BlockTip:
		var p tipPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		if p.Variant == "" {
			p.Variant = "DEFAULT"
		}
		if p.Variant != "DEFAULT" && p.Variant != "WARNING" {
			c.fail("variant", "must be DEFAULT or WARNING")
		}
		p.Title = c.text("title", p.Title, MaxTitleLength, false)
		p.HTML = c.html("html", p.HTML, true)
		*out = p
	case BlockCuriosity:
		var p titledHTMLPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		p.Title = c.text("title", p.Title, MaxTitleLength, false)
		p.HTML = c.html("html", p.HTML, true)
		*out = p
	case BlockLegacyHTML:
		var p htmlPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		p.HTML = c.html("html", p.HTML, true)
		*out = p
	case BlockCommand:
		return commandFor(raw, c, out)
	case BlockStepByStep:
		var p stepsPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		if len(p.Steps) < 1 || len(p.Steps) > MaxStepTexts {
			c.fail("steps", fmt.Sprintf("must have from 1 to %d steps", MaxStepTexts))
		}
		for i := range p.Steps {
			p.Steps[i] = c.text(fmt.Sprintf("steps[%d]", i), p.Steps[i], MaxExplanationLength, true)
		}
		*out = p
	case BlockCards:
		var p cardsPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		if len(p.Cards) < 1 || len(p.Cards) > MaxCards {
			c.fail("cards", fmt.Sprintf("must have from 1 to %d cards", MaxCards))
		}
		for i := range p.Cards {
			p.Cards[i].Title = c.text(fmt.Sprintf("cards[%d].title", i), p.Cards[i].Title, MaxTitleLength, true)
			p.Cards[i].Text = c.text(fmt.Sprintf("cards[%d].text", i), p.Cards[i].Text, MaxExplanationLength, true)
		}
		*out = p
	case BlockWidget:
		var p widgetPayload
		if err := decode(raw, &p); err != nil {
			return err
		}
		if !widgetComponents[p.Component] {
			c.fail("component", "must be PERMISSION_CALCULATOR or LS_ANATOMY")
		}
		if p.Params == nil {
			p.Params = map[string]any{}
		}
		*out = p
	}
	return nil
}

func commandFor(raw json.RawMessage, c *checker, out *any) error {
	var p commandPayload
	if err := decode(raw, &p); err != nil {
		return err
	}
	if len(p.Steps) < 1 || len(p.Steps) > MaxCommandSteps {
		c.fail("steps", fmt.Sprintf("must have from 1 to %d steps", MaxCommandSteps))
	}
	for i := range p.Steps {
		st := &p.Steps[i]
		at := func(name string) string { return fmt.Sprintf("steps[%d].%s", i, name) }
		st.Command = c.text(at("command"), st.Command, MaxCommandLength, true)
		st.Explanation = c.text(at("explanation"), st.Explanation, MaxExplanationLength, false)
		st.OutputExplanation = c.text(at("outputExplanation"), st.OutputExplanation, MaxExplanationLength, false)
		if st.Terminal != nil && (*st.Terminal < 1 || *st.Terminal > 3) {
			c.fail(at("terminal"), "must be from 1 to 3")
		}
		if st.Login != nil {
			st.Login.User = strings.TrimSpace(st.Login.User)
			if st.Login.User == "" || st.Login.Password == "" {
				c.fail(at("login"), "user and password must be given together")
			}
		}
		for j := range st.Answers {
			st.Answers[j] = c.text(fmt.Sprintf("steps[%d].answers[%d]", i, j), st.Answers[j], MaxCommandLength, false)
		}
	}
	*out = p
	return nil
}
