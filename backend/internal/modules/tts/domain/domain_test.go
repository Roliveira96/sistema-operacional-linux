package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Covers SPEC-017 CA-09 (RN-03).
func TestIsAllowedVoice(t *testing.T) {
	assert.True(t, IsAllowedVoice(DefaultVoice))
	assert.True(t, IsAllowedVoice("pt-BR-AntonioNeural"))
	assert.False(t, IsAllowedVoice("en-US-JennyNeural"))
	assert.False(t, IsAllowedVoice("pt-BR-FranciscaNeural'/><voice name='x"))
	assert.False(t, IsAllowedVoice(""))
}
