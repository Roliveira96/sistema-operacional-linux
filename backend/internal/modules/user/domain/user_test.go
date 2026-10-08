package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Covers SPEC-003 CA-03 and CA-04 (RN-01).
func TestNormalizeAcademicID(t *testing.T) {
	for _, valid := range []string{"a1234567", "A1234567", "1234567", "  a1234567 "} {
		got, err := NormalizeAcademicID(valid)
		require.NoError(t, err, valid)
		assert.Equal(t, "1234567", got, valid)
	}
	for _, invalid := range []string{"123456", "a12345678", "12-34567", "aa1234567", "", "b1234567", "a123456x"} {
		_, err := NormalizeAcademicID(invalid)
		assert.ErrorIs(t, err, ErrInvalidAcademicID, invalid)
	}
}

// Covers RN-02.
func TestNormalizeEmail(t *testing.T) {
	got, err := NormalizeEmail("  Admin@RMO.dev.br ")
	require.NoError(t, err)
	assert.Equal(t, "admin@rmo.dev.br", got)

	for _, invalid := range []string{"no-at", "@rmo.dev.br", "admin@", "admin@localhost", "ad min@rmo.dev.br"} {
		_, err := NormalizeEmail(invalid)
		assert.ErrorIs(t, err, ErrInvalidEmail, invalid)
	}
}

func TestParseIdentifier(t *testing.T) {
	email, err := ParseIdentifier("Student@Example.com")
	require.NoError(t, err)
	assert.True(t, email.IsEmail())
	assert.Equal(t, "email:student@example.com", email.Key())

	ra, err := ParseIdentifier("a7654321")
	require.NoError(t, err)
	assert.False(t, ra.IsEmail())
	assert.Equal(t, "ra:7654321", ra.Key())

	_, err = ParseIdentifier("bad@")
	assert.ErrorIs(t, err, ErrInvalidEmail)
	_, err = ParseIdentifier("123")
	assert.ErrorIs(t, err, ErrInvalidAcademicID)
}

func TestHasPassword(t *testing.T) {
	empty := ""
	hash := "$argon2id$..."
	assert.False(t, User{}.HasPassword())
	assert.False(t, User{PasswordHash: &empty}.HasPassword())
	assert.True(t, User{PasswordHash: &hash}.HasPassword())
	assert.Equal(t, "users", User{}.TableName())
}
