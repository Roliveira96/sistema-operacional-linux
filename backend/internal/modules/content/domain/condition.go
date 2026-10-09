package domain

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// ConditionType is a type of the closed validation catalog (SPEC-011).
type ConditionType string

// Condition types.
const (
	CondFileExists       ConditionType = "FILE_EXISTS"
	CondDirectoryExists  ConditionType = "DIRECTORY_EXISTS"
	CondNodeExists       ConditionType = "NODE_EXISTS"
	CondSymlink          ConditionType = "SYMLINK"
	CondPathAbsent       ConditionType = "PATH_ABSENT"
	CondContentEquals    ConditionType = "CONTENT_EQUALS"
	CondContentContains  ConditionType = "CONTENT_CONTAINS"
	CondContentNotEmpty  ConditionType = "CONTENT_NOT_EMPTY"
	CondDirectoryEmpty   ConditionType = "DIRECTORY_EMPTY"
	CondPermissionMode   ConditionType = "PERMISSION_MODE"
	CondOwner            ConditionType = "OWNER"
	CondGroupOwner       ConditionType = "GROUP_OWNER"
	CondUserExists       ConditionType = "USER_EXISTS"
	CondUserAbsent       ConditionType = "USER_ABSENT"
	CondUserAttribute    ConditionType = "USER_ATTRIBUTE"
	CondUserPasswordSet  ConditionType = "USER_PASSWORD_SET"
	CondUserLocked       ConditionType = "USER_LOCKED"
	CondGroupExists      ConditionType = "GROUP_EXISTS"
	CondGroupAbsent      ConditionType = "GROUP_ABSENT"
	CondUserInGroup      ConditionType = "USER_IN_GROUP"
	CondPackageInstalled ConditionType = "PACKAGE_INSTALLED"
	CondServiceState     ConditionType = "SERVICE_STATE"
	CondAptListsUpdated  ConditionType = "APT_LISTS_UPDATED"

	// SPEC-013 additions.
	CondContentNotContains ConditionType = "CONTENT_NOT_CONTAINS"
	CondContentLineCount   ConditionType = "CONTENT_LINE_COUNT"
	CondAnyOf              ConditionType = "ANY_OF"
	CondPackagesAtVersions ConditionType = "PACKAGES_AT_VERSIONS"
)

// Comparisons of CONTENT_LINE_COUNT.
const (
	CompareEqual   = "EQUAL"
	CompareAtLeast = "AT_LEAST"
)

// PackageVersion is an expected version for PACKAGES_AT_VERSIONS.
type PackageVersion struct {
	Package string `json:"package"`
	Version string `json:"version"`
}

// User attribute fields of USER_ATTRIBUTE.
const (
	FieldHome         = "HOME"
	FieldShell        = "SHELL"
	FieldComment      = "COMMENT"
	FieldUID          = "UID"
	FieldPrimaryGroup = "PRIMARY_GROUP"
)

// Paths kept by the legacy package manager and simplified systemd.
const (
	aptListsPath   = "/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease"
	serviceWants   = "/etc/systemd/system/multi-user.target.wants"
	serviceActives = "/run/systemd/ativos"
)

// Condition is one declarative validation rule. Only the parameters of its
// type are used; optional ones are pointers.
type Condition struct {
	Type               ConditionType    `json:"type"`
	Path               string           `json:"path,omitempty"`
	Target             *string          `json:"target,omitempty"`
	Value              string           `json:"value,omitempty"`
	TrimWhitespace     bool             `json:"trimWhitespace,omitempty"`
	Mode               string           `json:"mode,omitempty"`
	IncludeSpecialBits bool             `json:"includeSpecialBits,omitempty"`
	User               string           `json:"user,omitempty"`
	Group              *string          `json:"group,omitempty"`
	Field              string           `json:"field,omitempty"`
	Locked             *bool            `json:"locked,omitempty"`
	Package            string           `json:"package,omitempty"`
	Installed          *bool            `json:"installed,omitempty"`
	Service            string           `json:"service,omitempty"`
	Active             *bool            `json:"active,omitempty"`
	Enabled            *bool            `json:"enabled,omitempty"`
	CaseSensitive      bool             `json:"caseSensitive,omitempty"`
	Comparison         string           `json:"comparison,omitempty"`
	Count              *int             `json:"count,omitempty"`
	Conditions         []Condition      `json:"conditions,omitempty"`
	Packages           []PackageVersion `json:"packages,omitempty"`
}

// ErrInvalidConditions is returned for lists that cannot be evaluated.
var ErrInvalidConditions = errors.New("invalid validation conditions")

var octalMode = regexp.MustCompile(`^[0-7]{3,4}$`)

var userFields = []string{FieldHome, FieldShell, FieldComment, FieldUID, FieldPrimaryGroup}

// Validate checks that the condition has the parameters its type requires
// (SPEC-011 RN-03).
func (c Condition) Validate() error {
	return c.validate(false)
}

func (c Condition) validate(nested bool) error {
	missing := func(name string) error {
		return fmt.Errorf("%w: %s requires %s", ErrInvalidConditions, c.Type, name)
	}
	switch c.Type {
	case CondFileExists, CondDirectoryExists, CondNodeExists, CondSymlink, CondPathAbsent,
		CondContentNotEmpty, CondDirectoryEmpty:
		if c.Path == "" {
			return missing("path")
		}
	case CondContentEquals, CondContentContains:
		if c.Path == "" {
			return missing("path")
		}
	case CondPermissionMode:
		if c.Path == "" {
			return missing("path")
		}
		if !octalMode.MatchString(c.Mode) {
			return fmt.Errorf("%w: mode %q is not octal", ErrInvalidConditions, c.Mode)
		}
	case CondOwner:
		if c.Path == "" || c.User == "" {
			return missing("path and user")
		}
	case CondGroupOwner:
		if c.Path == "" || c.Group == nil || *c.Group == "" {
			return missing("path and group")
		}
	case CondUserExists, CondUserAbsent, CondUserPasswordSet:
		if c.User == "" {
			return missing("user")
		}
	case CondUserAttribute:
		if c.User == "" || !slices.Contains(userFields, c.Field) {
			return missing("user and a valid field")
		}
	case CondUserLocked:
		if c.User == "" || c.Locked == nil {
			return missing("user and locked")
		}
	case CondGroupExists, CondGroupAbsent:
		if c.Group == nil || *c.Group == "" {
			return missing("group")
		}
	case CondUserInGroup:
		if c.User == "" || c.Group == nil || *c.Group == "" {
			return missing("user and group")
		}
	case CondPackageInstalled:
		if c.Package == "" || c.Installed == nil {
			return missing("package and installed")
		}
	case CondServiceState:
		if c.Service == "" {
			return missing("service")
		}
	case CondAptListsUpdated:
	case CondContentNotContains:
		if c.Path == "" {
			return missing("path")
		}
	case CondContentLineCount:
		if c.Path == "" || c.Count == nil || *c.Count < 0 || (c.Comparison != CompareEqual && c.Comparison != CompareAtLeast) {
			return missing("path, a valid comparison and a non-negative count")
		}
	case CondAnyOf:
		if nested || len(c.Conditions) == 0 {
			return fmt.Errorf("%w: ANY_OF must be non-empty and cannot be nested", ErrInvalidConditions)
		}
		for _, inner := range c.Conditions {
			if err := inner.validate(true); err != nil {
				return err
			}
		}
	case CondPackagesAtVersions:
		if len(c.Packages) == 0 {
			return missing("packages")
		}
	default:
		return fmt.Errorf("%w: unknown type %q", ErrInvalidConditions, c.Type)
	}
	return nil
}

// ValidateConditions checks a whole list; an empty list is invalid.
func ValidateConditions(list []Condition) error {
	if len(list) == 0 {
		return fmt.Errorf("%w: empty list", ErrInvalidConditions)
	}
	for _, c := range list {
		if err := c.Validate(); err != nil {
			return err
		}
	}
	return nil
}

// Verdict is the result of grading a machine state.
type Verdict struct {
	Passed  bool
	Results []bool
}

// Grade evaluates every condition over the machine (SPEC-011 RN-01). It is a
// pure function: no database, network or clock. Invalid lists never pass.
func Grade(m *Machine, list []Condition) (Verdict, error) {
	if err := ValidateConditions(list); err != nil {
		return Verdict{}, err
	}
	results := make([]bool, len(list))
	passed := true
	for i, c := range list {
		results[i] = c.Holds(m)
		passed = passed && results[i]
	}
	return Verdict{Passed: passed, Results: results}, nil
}

// Holds evaluates one valid condition. Semantics follow the legacy
// Verificar helpers, through the TypeScript evaluator of SPEC-005.
func (c Condition) Holds(m *Machine) bool {
	switch c.Type {
	case CondFileExists:
		n := m.Lookup(c.Path, true)
		return n != nil && n.IsFile()
	case CondDirectoryExists:
		n := m.Lookup(c.Path, true)
		return n != nil && n.Type == NodeDirectory
	case CondNodeExists:
		return m.Lookup(c.Path, true) != nil
	case CondSymlink:
		n := m.Lookup(c.Path, false)
		if n == nil || n.Type != NodeLink {
			return false
		}
		return c.Target == nil || (n.Target != nil && *n.Target == *c.Target)
	case CondPathAbsent:
		return m.Lookup(c.Path, true) == nil
	case CondContentEquals:
		text, ok := m.Content(c.Path)
		if !ok {
			return false
		}
		if c.TrimWhitespace {
			return trimJS(text) == trimJS(c.Value)
		}
		return text == c.Value
	case CondContentContains:
		text, _ := m.Content(c.Path)
		return strings.Contains(strings.ToLower(text), strings.ToLower(c.Value))
	case CondContentNotEmpty:
		text, _ := m.Content(c.Path)
		return len(trimJS(text)) > 0
	case CondDirectoryEmpty:
		n := m.Lookup(c.Path, true)
		return n != nil && n.Type == NodeDirectory && len(n.Children) == 0
	case CondPermissionMode:
		n := m.Lookup(c.Path, true)
		if n == nil {
			return false
		}
		mask := 0o777
		if c.IncludeSpecialBits {
			mask = 0o7777
		}
		want, _ := strconv.ParseInt(c.Mode, 8, 32)
		return n.Mode()&mask == int(want)
	case CondOwner:
		n := m.Lookup(c.Path, true)
		if n == nil || m.UserName(n.Owner) != c.User {
			return false
		}
		return c.Group == nil || m.GroupName(n.Group) == *c.Group
	case CondGroupOwner:
		n := m.Lookup(c.Path, true)
		return n != nil && m.GroupName(n.Group) == *c.Group
	case CondUserExists:
		return m.User(c.User) != nil
	case CondUserAbsent:
		return m.User(c.User) == nil
	case CondUserAttribute:
		return c.userAttribute(m)
	case CondUserPasswordSet:
		u := m.User(c.User)
		return u != nil && u.Password != nil && *u.Password != ""
	case CondUserLocked:
		u := m.User(c.User)
		return u != nil && u.Locked == *c.Locked
	case CondGroupExists:
		return m.GroupByName(*c.Group) != nil
	case CondGroupAbsent:
		return m.GroupByName(*c.Group) == nil
	case CondUserInGroup:
		u := m.User(c.User)
		g := m.GroupByName(*c.Group)
		return u != nil && g != nil && (slices.Contains(g.Members, c.User) || u.GID == g.GID)
	case CondPackageInstalled:
		return m.PackageInstalled(c.Package) == *c.Installed
	case CondServiceState:
		if c.Active != nil && (m.Lookup(serviceActives+"/"+c.Service, true) != nil) != *c.Active {
			return false
		}
		if c.Enabled != nil && (m.Lookup(serviceWants+"/"+c.Service+".service", false) != nil) != *c.Enabled {
			return false
		}
		return c.Active != nil || c.Enabled != nil
	case CondAptListsUpdated:
		return m.Lookup(aptListsPath, true) != nil
	case CondContentNotContains:
		// A missing file reads as empty, like !Verificar.contem.
		text, _ := m.Content(c.Path)
		if c.CaseSensitive {
			return !strings.Contains(text, c.Value)
		}
		return !strings.Contains(strings.ToLower(text), strings.ToLower(c.Value))
	case CondContentLineCount:
		text, ok := m.Content(c.Path)
		if !ok {
			return false
		}
		lines := len(strings.Split(trimJS(text), "\n"))
		if c.Comparison == CompareEqual {
			return lines == *c.Count
		}
		return lines >= *c.Count
	case CondAnyOf:
		for _, inner := range c.Conditions {
			if inner.Holds(m) {
				return true
			}
		}
		return false
	case CondPackagesAtVersions:
		for _, p := range c.Packages {
			status, version, ok := m.PackageState(p.Package)
			if ok && status == "ii" && version != p.Version {
				return false
			}
		}
		return true
	}
	return false
}

func (c Condition) userAttribute(m *Machine) bool {
	u := m.User(c.User)
	if u == nil {
		return false
	}
	switch c.Field {
	case FieldHome:
		return u.Home == c.Value
	case FieldShell:
		return u.Shell == c.Value
	case FieldComment:
		return u.Comment == c.Value
	case FieldUID:
		return strconv.Itoa(u.UID) == c.Value
	case FieldPrimaryGroup:
		return m.GroupName(u.GID) == c.Value
	}
	return false
}

// trimJS mirrors String.prototype.trim, which strips Unicode white space and
// line terminators (including U+FEFF).
func trimJS(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\v', '\f', '\r', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
			return true
		}
		return r >= 0x2000 && r <= 0x200a
	})
}
