package domain

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func str(s string) *string { return &s }
func boolp(b bool) *bool   { return &b }

func file(name, content, perm string, owner, group int) Node {
	return Node{Name: name, Type: "arquivo", Owner: owner, Group: group, Permissions: perm, Content: str(content)}
}

func dir(name, perm string, owner, group int, children ...Node) Node {
	return Node{Name: name, Type: NodeDirectory, Owner: owner, Group: group, Permissions: perm, Children: children}
}

func link(name, target string) Node {
	return Node{Name: name, Type: NodeLink, Permissions: "777", Target: str(target)}
}

// sample mirrors legacy/scripts/extract/fixtures.helper.ts.
func sample() *Machine {
	return &Machine{
		Format: MachineFormat, Version: MachineVersion, Hostname: "test",
		Accounts: Accounts{
			Users: []Account{
				{Name: "root", UID: 0, GID: 0, Comment: "root", Home: "/root", Shell: "/bin/bash", Password: str("x")},
				{Name: "ana", UID: 1001, GID: 1001, Comment: "Ana", Home: "/home/ana", Shell: "/bin/sh", Locked: true},
			},
			Groups: []Group{{Name: "root", GID: 0}, {Name: "ana", GID: 1001}, {Name: "dev", GID: 2000, Members: []string{"ana"}}},
		},
		Root: dir("", "755", 0, 0,
			dir("home", "755", 0, 0, dir("ana", "750", 1001, 1001, file("notas.txt", "Linux é demais\n", "640", 1001, 2000), dir("vazia", "755", 0, 0))),
			dir("srv", "755", 0, 0, dir("uploads", "1777", 0, 0)),
			dir("etc", "755", 0, 0, dir("systemd", "755", 0, 0, dir("system", "755", 0, 0,
				dir("multi-user.target.wants", "755", 0, 0, link("nginx.service", "/usr/lib/systemd/system/nginx.service"))))),
			dir("run", "755", 0, 0, dir("systemd", "755", 0, 0, dir("ativos", "755", 0, 0, file("nginx", "", "644", 0, 0)))),
			dir("var", "755", 0, 0, dir("lib", "755", 0, 0,
				dir("dpkg", "755", 0, 0, file("status", "Package: htop\nStatus: install ok installed\n\nPackage: vim\nStatus: deinstall ok config-files\n", "644", 0, 0)),
				dir("apt", "755", 0, 0, dir("lists", "755", 0, 0, file("br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease", "", "644", 0, 0))))),
			link("atalho", "/home/ana"),
		),
	}
}

// Covers SPEC-011 CA-03: one positive and one negative per condition type.
func TestEveryConditionTypeHasPositiveAndNegative(t *testing.T) {
	m := sample()
	cases := []struct{ pos, neg Condition }{
		{Condition{Type: CondFileExists, Path: "/home/ana/notas.txt"}, Condition{Type: CondFileExists, Path: "/home/ana"}},
		{Condition{Type: CondDirectoryExists, Path: "/srv/uploads"}, Condition{Type: CondDirectoryExists, Path: "/home/ana/notas.txt"}},
		{Condition{Type: CondNodeExists, Path: "/atalho/notas.txt"}, Condition{Type: CondNodeExists, Path: "/nada"}},
		{Condition{Type: CondSymlink, Path: "/atalho", Target: str("/home/ana")}, Condition{Type: CondSymlink, Path: "/atalho", Target: str("/root")}},
		{Condition{Type: CondPathAbsent, Path: "/home/bob"}, Condition{Type: CondPathAbsent, Path: "/home/ana"}},
		{Condition{Type: CondContentEquals, Path: "/home/ana/notas.txt", Value: "Linux é demais", TrimWhitespace: true},
			Condition{Type: CondContentEquals, Path: "/home/ana/notas.txt", Value: "Linux é demais"}},
		{Condition{Type: CondContentContains, Path: "/home/ana/notas.txt", Value: "LINUX"}, Condition{Type: CondContentContains, Path: "/home/ana/notas.txt", Value: "windows"}},
		{Condition{Type: CondContentNotEmpty, Path: "/home/ana/notas.txt"}, Condition{Type: CondContentNotEmpty, Path: "/run/systemd/ativos/nginx"}},
		{Condition{Type: CondDirectoryEmpty, Path: "/home/ana/vazia"}, Condition{Type: CondDirectoryEmpty, Path: "/home/ana"}},
		{Condition{Type: CondPermissionMode, Path: "/srv/uploads", Mode: "777"}, Condition{Type: CondPermissionMode, Path: "/srv/uploads", Mode: "777", IncludeSpecialBits: true}},
		{Condition{Type: CondOwner, Path: "/home/ana/notas.txt", User: "ana", Group: str("dev")}, Condition{Type: CondOwner, Path: "/home/ana/notas.txt", User: "root"}},
		{Condition{Type: CondGroupOwner, Path: "/home/ana/notas.txt", Group: str("dev")}, Condition{Type: CondGroupOwner, Path: "/home/ana/notas.txt", Group: str("ana")}},
		{Condition{Type: CondUserExists, User: "ana"}, Condition{Type: CondUserExists, User: "bob"}},
		{Condition{Type: CondUserAbsent, User: "bob"}, Condition{Type: CondUserAbsent, User: "ana"}},
		{Condition{Type: CondUserAttribute, User: "ana", Field: FieldShell, Value: "/bin/sh"}, Condition{Type: CondUserAttribute, User: "ana", Field: FieldHome, Value: "/root"}},
		{Condition{Type: CondUserPasswordSet, User: "root"}, Condition{Type: CondUserPasswordSet, User: "ana"}},
		{Condition{Type: CondUserLocked, User: "ana", Locked: boolp(true)}, Condition{Type: CondUserLocked, User: "root", Locked: boolp(true)}},
		{Condition{Type: CondGroupExists, Group: str("dev")}, Condition{Type: CondGroupExists, Group: str("ops")}},
		{Condition{Type: CondGroupAbsent, Group: str("ops")}, Condition{Type: CondGroupAbsent, Group: str("dev")}},
		{Condition{Type: CondUserInGroup, User: "ana", Group: str("dev")}, Condition{Type: CondUserInGroup, User: "root", Group: str("dev")}},
		{Condition{Type: CondPackageInstalled, Package: "htop", Installed: boolp(true)}, Condition{Type: CondPackageInstalled, Package: "vim", Installed: boolp(true)}},
		{Condition{Type: CondServiceState, Service: "nginx", Active: boolp(true), Enabled: boolp(true)}, Condition{Type: CondServiceState, Service: "mysql", Active: boolp(true)}},
		{Condition{Type: CondAptListsUpdated}, Condition{Type: CondPathAbsent, Path: "/var/lib/apt/lists/br.archive.ubuntu.com_ubuntu_dists_noble-updates_InRelease"}},
	}
	seen := map[ConditionType]bool{}
	for _, tc := range cases {
		require.NoError(t, tc.pos.Validate(), tc.pos.Type)
		assert.True(t, tc.pos.Holds(m), "positive %s", tc.pos.Type)
		assert.False(t, tc.neg.Holds(m), "negative %s", tc.neg.Type)
		seen[tc.pos.Type] = true
	}
	assert.Len(t, seen, 23, "every catalog type is exercised")
}

func TestUserAttributesPackagesAndServices(t *testing.T) {
	m := sample()
	assert.True(t, Condition{Type: CondUserAttribute, User: "ana", Field: FieldComment, Value: "Ana"}.Holds(m))
	assert.True(t, Condition{Type: CondUserAttribute, User: "ana", Field: FieldUID, Value: "1001"}.Holds(m))
	assert.True(t, Condition{Type: CondUserAttribute, User: "ana", Field: FieldPrimaryGroup, Value: "ana"}.Holds(m))
	assert.False(t, Condition{Type: CondUserAttribute, User: "bob", Field: FieldUID, Value: "1"}.Holds(m))
	assert.True(t, Condition{Type: CondPackageInstalled, Package: "vim", Installed: boolp(false)}.Holds(m))
	assert.True(t, Condition{Type: CondPackageInstalled, Package: "nano", Installed: boolp(false)}.Holds(m))
	assert.True(t, Condition{Type: CondServiceState, Service: "mysql", Active: boolp(false), Enabled: boolp(false)}.Holds(m))
	assert.False(t, Condition{Type: CondServiceState, Service: "nginx"}.Holds(m))
	assert.Nil(t, m.Lookup("relative", true))
	assert.Equal(t, "notas.txt", m.Lookup("/home/ana/../ana/notas.txt", true).Name)
	assert.Nil(t, m.Lookup("/home/ana/notas.txt/x", true))
}

// Covers SPEC-011 CA-04.
func TestInvalidListsNeverPass(t *testing.T) {
	m := sample()
	invalid := [][]Condition{
		nil,
		{{Type: "NOPE"}},
		{{Type: CondPermissionMode, Path: "/x", Mode: "9z9"}},
		{{Type: CondFileExists}},
		{{Type: CondOwner, Path: "/x"}},
		{{Type: CondGroupOwner, Path: "/x"}},
		{{Type: CondUserExists}},
		{{Type: CondUserAttribute, User: "ana", Field: "EMAIL"}},
		{{Type: CondUserLocked, User: "ana"}},
		{{Type: CondGroupExists}},
		{{Type: CondUserInGroup, User: "ana"}},
		{{Type: CondPackageInstalled, Package: "htop"}},
		{{Type: CondServiceState}},
		{{Type: CondContentEquals}},
	}
	for _, list := range invalid {
		v, err := Grade(m, list)
		assert.ErrorIs(t, err, ErrInvalidConditions, "%v", list)
		assert.False(t, v.Passed)
	}
	v, err := Grade(m, []Condition{{Type: CondUserExists, User: "ana"}, {Type: CondUserExists, User: "bob"}})
	require.NoError(t, err)
	assert.Equal(t, Verdict{Passed: false, Results: []bool{true, false}}, v)
}

func TestTrimMatchesJavaScript(t *testing.T) {
	assert.Equal(t, "a b", trimJS("\ufeff\u00a0 a b\u2003\n"))
}

type fixtureFile struct {
	Snapshots map[string]Machine `json:"snapshots"`
	Questions []struct {
		SourceKey  string      `json:"sourceKey"`
		Conditions []Condition `json:"conditions"`
		Cases      []struct {
			Label        string `json:"label"`
			SnapshotHash string `json:"snapshotHash"`
			Expected     bool   `json:"expected"`
		} `json:"cases"`
	} `json:"questions"`
}

// Covers SPEC-011 CA-02 and RN-02: the Go grader reaches the verdict of the
// TypeScript evaluator on every state exported by the extractor (SPEC-005).
func TestGraderMatchesExtractorFixtures(t *testing.T) {
	f, err := os.Open("../seed/data/equivalence_fixtures.json.gz")
	require.NoError(t, err)
	defer f.Close()
	gz, err := gzip.NewReader(f)
	require.NoError(t, err)
	var fx fixtureFile
	require.NoError(t, json.NewDecoder(gz).Decode(&fx))
	require.NotEmpty(t, fx.Questions)

	checked := 0
	for _, q := range fx.Questions {
		for _, c := range q.Cases {
			snap, ok := fx.Snapshots[c.SnapshotHash]
			require.True(t, ok, "%s: missing snapshot", q.SourceKey)
			v, err := Grade(&snap, q.Conditions)
			if err != nil {
				assert.False(t, c.Expected, "%s/%s: invalid list must not pass", q.SourceKey, c.Label)
				continue
			}
			assert.Equal(t, c.Expected, v.Passed, "%s/%s", q.SourceKey, c.Label)
			checked++
		}
	}
	t.Logf("graded %d states of %d questions", checked, len(fx.Questions))
}

func intp(i int) *int { return &i }

// Covers SPEC-013 CA-01 on the Go side.
func TestSpec013ConditionTypes(t *testing.T) {
	m := sample()
	notes := "/home/ana/notas.txt"
	yes := Condition{Type: CondUserExists, User: "ana"}
	no := Condition{Type: CondUserExists, User: "bob"}
	cases := []struct {
		c    Condition
		want bool
	}{
		{Condition{Type: CondContentNotContains, Path: notes, Value: "windows"}, true},
		{Condition{Type: CondContentNotContains, Path: notes, Value: "LINUX"}, false},
		{Condition{Type: CondContentNotContains, Path: notes, Value: "LINUX", CaseSensitive: true}, true},
		{Condition{Type: CondContentNotContains, Path: "/missing", Value: "x"}, true},
		{Condition{Type: CondContentLineCount, Path: notes, Comparison: CompareEqual, Count: intp(1)}, true},
		{Condition{Type: CondContentLineCount, Path: notes, Comparison: CompareAtLeast, Count: intp(2)}, false},
		{Condition{Type: CondContentLineCount, Path: "/missing", Comparison: CompareAtLeast, Count: intp(0)}, false},
		{Condition{Type: CondAnyOf, Conditions: []Condition{no, yes}}, true},
		{Condition{Type: CondAnyOf, Conditions: []Condition{no, no}}, false},
		{Condition{Type: CondPackagesAtVersions, Packages: []PackageVersion{{"htop", ""}, {"vim", "9"}, {"nano", "1"}}}, true},
		{Condition{Type: CondPackagesAtVersions, Packages: []PackageVersion{{"htop", "3.0"}}}, false},
	}
	for _, tc := range cases {
		require.NoError(t, tc.c.Validate(), tc.c.Type)
		assert.Equal(t, tc.want, tc.c.Holds(m), "%s %+v", tc.c.Type, tc.c)
	}
}

// Covers SPEC-013 CA-03.
func TestSpec013InvalidConditions(t *testing.T) {
	yes := Condition{Type: CondUserExists, User: "ana"}
	for _, c := range []Condition{
		{Type: CondAnyOf},
		{Type: CondAnyOf, Conditions: []Condition{{Type: CondAnyOf, Conditions: []Condition{yes}}}},
		{Type: CondAnyOf, Conditions: []Condition{{Type: "NOPE"}}},
		{Type: CondContentLineCount, Path: "/a", Comparison: "MORE", Count: intp(1)},
		{Type: CondContentLineCount, Path: "/a", Comparison: CompareEqual, Count: intp(-1)},
		{Type: CondContentLineCount, Path: "/a", Comparison: CompareEqual},
		{Type: CondContentNotContains},
		{Type: CondPackagesAtVersions},
	} {
		assert.ErrorIs(t, c.Validate(), ErrInvalidConditions, "%+v", c)
	}
	installed, version, ok := sample().PackageState("vim")
	assert.Equal(t, []any{"rc", "", true}, []any{installed, version, ok})
}
