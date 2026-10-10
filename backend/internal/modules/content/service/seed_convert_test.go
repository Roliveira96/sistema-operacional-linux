package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/content/domain"
)

// converted is the manifest after SPEC-005 turned the concepts of "diretorios" into cards: the
// first block keeps its key (and becomes a TEXT), and more blocks follow.
func converted() Manifest {
	m := testManifest()
	m.Modules[0].Blocks = []ManifestBlock{
		{SourceKey: "diretorios/concepts", Type: domain.BlockText, Payload: json.RawMessage(`{"title":"Antes dos comandos","html":"<p>a</p>"}`)},
		{SourceKey: "diretorios/concepts/2", Type: domain.BlockTip, Payload: json.RawMessage(`{"variant":"DEFAULT","html":"<p>dica</p>"}`)},
		{SourceKey: "diretorios/demo-card", Type: domain.BlockText, Payload: json.RawMessage(`{"title":"Veja na prática","html":""}`)},
		{SourceKey: "diretorios/demo", Type: domain.BlockCommand, Payload: json.RawMessage(`{"steps":[{"command":"ls","terminal":1}]}`)},
	}
	return m
}

// Covers SPEC-005 RN-02: the legacy block is converted in place and the new ones are loaded after it.
func TestSeedConvertsALegacyBlockInPlace(t *testing.T) {
	h := newHarness(true)
	_, err := h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)
	before := h.store.blocks["diretorios/concepts"]
	require.Equal(t, domain.BlockLegacyHTML, before.BlockType)

	r, err := h.seeder.Run(context.Background(), converted(), "a")
	require.NoError(t, err)
	assert.Equal(t, Counts{Inserted: 2, Updated: 2}, r.Blocks)

	after := h.store.blocks["diretorios/concepts"]
	assert.Equal(t, before.ID, after.ID, "the same row, so the reading progress stays")
	assert.Equal(t, domain.BlockText, after.BlockType)
	assert.Equal(t, []int{1, 2, 3, 4}, []int{after.Position, h.store.blocks["diretorios/concepts/2"].Position, h.store.blocks["diretorios/demo-card"].Position, h.store.blocks["diretorios/demo"].Position})
}

// Covers SPEC-011 RN-04a: an edited module is not given new blocks, which would collide with its order.
func TestSeedLeavesAnEditedModuleAlone(t *testing.T) {
	h := newHarness(true)
	_, err := h.seeder.Run(context.Background(), testManifest(), "a")
	require.NoError(t, err)

	edited := time.Now()
	b := h.store.blocks["diretorios/demo"]
	b.EditedByTeacherAt = &edited
	h.store.blocks["diretorios/demo"] = b

	r, err := h.seeder.Run(context.Background(), converted(), "a")
	require.NoError(t, err)
	assert.Equal(t, Counts{Preserved: 4}, r.Blocks)
	assert.Equal(t, domain.BlockLegacyHTML, h.store.blocks["diretorios/concepts"].BlockType, "still the old content")
	_, found := h.store.blocks["diretorios/concepts/2"]
	assert.False(t, found, "no new block was loaded")
}
