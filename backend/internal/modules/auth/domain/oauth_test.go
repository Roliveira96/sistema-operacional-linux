package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

func TestGenerateRandomState(t *testing.T) {
	s1, err := domain.GenerateRandomState()
	require.NoError(t, err)
	assert.Len(t, s1, 64) // 32 bytes hex encoded = 64 hex chars

	s2, err := domain.GenerateRandomState()
	require.NoError(t, err)
	assert.NotEqual(t, s1, s2)
}
