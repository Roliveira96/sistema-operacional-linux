package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsLoopbackRedirect(t *testing.T) {
	for _, uri := range []string{"http://localhost:53682/callback", "http://127.0.0.1/cb", "http://[::1]:9/cb", "http://LOCALHOST/cb"} {
		assert.True(t, IsLoopbackRedirect(uri), uri)
	}
	for _, uri := range []string{"", "https://localhost/cb", "http://localhost.evil.com/cb", "http://evil.com/localhost", "ftp://localhost/cb", "http://localhost/cb#x", "://bad"} {
		assert.False(t, IsLoopbackRedirect(uri), uri)
	}
}

func TestOAuthClientAllowsRedirect(t *testing.T) {
	c := OAuthClient{RedirectURIs: []string{"http://localhost:1/cb"}}
	assert.True(t, c.AllowsRedirect("http://localhost:1/cb"))
	assert.False(t, c.AllowsRedirect("http://localhost:2/cb"), "exact match only")
	assert.False(t, c.AllowsRedirect(""))
}

func TestOAuthTableNames(t *testing.T) {
	assert.Equal(t, "oauth_clients", OAuthClient{}.TableName())
	assert.Equal(t, "oauth_authorization_codes", OAuthCode{}.TableName())
}
