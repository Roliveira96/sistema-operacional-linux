// Package domain holds the content entities, the closed catalogs of blocks
// and validation conditions, and the grader that evaluates conditions over a
// serialized machine (SPEC-011).
package domain

import (
	"strconv"
	"strings"
)

// MachineFormat and MachineVersion identify the serialized machine produced
// by the legacy Serializador.
const (
	MachineFormat  = "exame-so/maquina"
	MachineVersion = 1
)

// Machine is the serialized state of a simulated Linux machine. Field names
// follow the legacy JSON format.
type Machine struct {
	Format   string   `json:"formato"`
	Version  int      `json:"versao"`
	Hostname string   `json:"hostname"`
	Accounts Accounts `json:"contas"`
	Root     Node     `json:"raiz"`
}

// Accounts lists users and groups.
type Accounts struct {
	Users  []Account `json:"usuarios"`
	Groups []Group   `json:"grupos"`
}

// Account is a user account.
type Account struct {
	Name     string  `json:"nome"`
	UID      int     `json:"uid"`
	GID      int     `json:"gid"`
	Comment  string  `json:"comentario"`
	Home     string  `json:"home"`
	Shell    string  `json:"shell"`
	Password *string `json:"senha"`
	Locked   bool    `json:"bloqueado"`
}

// Group is a user group.
type Group struct {
	Name    string   `json:"nome"`
	GID     int      `json:"gid"`
	Members []string `json:"membros"`
}

// Node is a filesystem node.
type Node struct {
	Name        string  `json:"nome"`
	Type        string  `json:"tipo"`
	Owner       int     `json:"dono"`
	Group       int     `json:"grupo"`
	Permissions string  `json:"permissoes"`
	Content     *string `json:"conteudo,omitempty"`
	Children    []Node  `json:"filhos,omitempty"`
	Target      *string `json:"alvo,omitempty"`
}

// Node types of the legacy model.
const (
	NodeDirectory = "diretorio"
	NodeLink      = "link"
)

// fileTypes are the legacy subclasses of Arquivo.
var fileTypes = map[string]bool{
	"arquivo": true, "gerado": true, "binario": true, "compactado": true, "dispositivo": true, "nulo": true,
}

// IsFile reports whether the node is file-like.
func (n *Node) IsFile() bool { return fileTypes[n.Type] }

// Mode returns the numeric mode, including special bits.
func (n *Node) Mode() int {
	v, err := strconv.ParseInt(n.Permissions, 8, 32)
	if err != nil {
		return -1
	}
	return int(v)
}

const maxLinkDepth = 40

func splitPath(path string) []string {
	var parts []string
	for _, p := range strings.Split(path, "/") {
		if p != "" && p != "." {
			parts = append(parts, p)
		}
	}
	return parts
}

// Lookup resolves an absolute path. Intermediate links are always followed;
// the last one only when followLast is true. It mirrors the TypeScript
// evaluator of the extractor (SPEC-005).
func (m *Machine) Lookup(path string, followLast bool) *Node {
	return m.lookup(path, followLast, 0)
}

func (m *Machine) lookup(path string, followLast bool, depth int) *Node {
	if depth > maxLinkDepth || !strings.HasPrefix(path, "/") {
		return nil
	}
	parts := splitPath(path)
	node := &m.Root
	var walked []string
	for i, part := range parts {
		if part == ".." {
			if len(walked) > 0 {
				walked = walked[:len(walked)-1]
			}
			parent := m.lookup("/"+strings.Join(walked, "/"), true, depth+1)
			if parent == nil {
				return nil
			}
			node = parent
			continue
		}
		if node.Type != NodeDirectory {
			return nil
		}
		var child *Node
		for j := range node.Children {
			if node.Children[j].Name == part {
				child = &node.Children[j]
				break
			}
		}
		if child == nil {
			return nil
		}
		isLast := i == len(parts)-1
		if child.Type == NodeLink && (!isLast || followLast) {
			target := ""
			if child.Target != nil {
				target = *child.Target
			}
			base := target
			if !strings.HasPrefix(target, "/") {
				base = "/" + strings.Join(append(append([]string{}, walked...), target), "/")
			}
			rest := strings.Join(parts[i+1:], "/")
			if rest != "" {
				return m.lookup(strings.TrimSuffix(base, "/")+"/"+rest, followLast, depth+1)
			}
			return m.lookup(base, followLast, depth+1)
		}
		walked = append(walked, part)
		node = child
	}
	return node
}

// Content returns the text of a file-like node; ok is false otherwise.
func (m *Machine) Content(path string) (string, bool) {
	n := m.Lookup(path, true)
	if n == nil || !n.IsFile() {
		return "", false
	}
	if n.Content == nil {
		return "", true
	}
	return *n.Content, true
}

// User returns the account with the given name.
func (m *Machine) User(name string) *Account {
	for i := range m.Accounts.Users {
		if m.Accounts.Users[i].Name == name {
			return &m.Accounts.Users[i]
		}
	}
	return nil
}

// GroupByName returns the group with the given name.
func (m *Machine) GroupByName(name string) *Group {
	for i := range m.Accounts.Groups {
		if m.Accounts.Groups[i].Name == name {
			return &m.Accounts.Groups[i]
		}
	}
	return nil
}

// UserName returns the name of a uid, or "" when unknown.
func (m *Machine) UserName(uid int) string {
	for _, u := range m.Accounts.Users {
		if u.UID == uid {
			return u.Name
		}
	}
	return ""
}

// GroupName returns the name of a gid, or "" when unknown.
func (m *Machine) GroupName(gid int) string {
	for _, g := range m.Accounts.Groups {
		if g.GID == gid {
			return g.Name
		}
	}
	return ""
}

// PackageInstalled reports whether /var/lib/dpkg/status lists the package as
// installed ("ii"). Like the legacy package manager, which fills a map, the
// last block of a package wins.
func (m *Machine) PackageInstalled(name string) bool {
	text, _ := m.Content("/var/lib/dpkg/status")
	installed := false
	for _, block := range strings.Split(text, "\n\n") {
		fields := map[string]string{}
		for _, line := range strings.Split(block, "\n") {
			if i := strings.Index(line, ": "); i > 0 {
				fields[line[:i]] = line[i+2:]
			}
		}
		if pkg, ok := fields["Package"]; ok && pkg == name {
			installed = !strings.Contains(fields["Status"], "config-files")
		}
	}
	return installed
}
