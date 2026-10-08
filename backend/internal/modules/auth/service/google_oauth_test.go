package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestGoogleOAuthProvider_ConfiguredAndAuthURL(t *testing.T) {
	unconfigured := NewGoogleOAuthProvider("", "", "")
	assert.False(t, unconfigured.Configured())
	assert.Empty(t, unconfigured.AuthCodeURL("csrf-state-123"))

	provider := NewGoogleOAuthProvider("client-123", "secret-456", "http://localhost:8080/callback")
	assert.True(t, provider.Configured())
	authURL := provider.AuthCodeURL("csrf-state-123")
	assert.Contains(t, authURL, "client_id=client-123")
	assert.Contains(t, authURL, "state=csrf-state-123")
	assert.Contains(t, authURL, "scope=openid+email+profile")
}

func TestGoogleOAuthProvider_Exchange_Success(t *testing.T) {
	provider := NewGoogleOAuthProvider("client-123", "secret-456", "http://localhost:8080/callback")

	provider.HTTPClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			if req.URL.Host == "oauth2.googleapis.com" && req.URL.Path == "/token" {
				body := `{"access_token":"mock-token","token_type":"Bearer"}`
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(bytes.NewBufferString(body)),
					Header:     make(http.Header),
				}, nil
			}
			if req.URL.Host == "openidconnect.googleapis.com" && req.URL.Path == "/v1/userinfo" {
				assert.Equal(t, "Bearer mock-token", req.Header.Get("Authorization"))
				userInfo := domain.GoogleUserInfo{
					Sub:           "google-sub-123",
					Email:         "student@utfpr.edu.br",
					Name:          "Estudante Teste",
					EmailVerified: true,
				}
				bytesOut, _ := json.Marshal(userInfo)
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(bytes.NewReader(bytesOut)),
					Header:     make(http.Header),
				}, nil
			}
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(bytes.NewBufferString(""))}, nil
		}),
	}

	info, err := provider.Exchange(context.Background(), "auth-code-789")
	require.NoError(t, err)
	assert.Equal(t, "google-sub-123", info.Sub)
	assert.Equal(t, "student@utfpr.edu.br", info.Email)
	assert.Equal(t, "Estudante Teste", info.Name)
	assert.True(t, info.EmailVerified)
}

func TestGoogleOAuthProvider_Exchange_NotConfigured(t *testing.T) {
	provider := NewGoogleOAuthProvider("", "", "")
	_, err := provider.Exchange(context.Background(), "code")
	assert.ErrorIs(t, err, domain.ErrGoogleOAuthNotConfigured)
}

func TestGoogleOAuthProvider_Exchange_TokenError(t *testing.T) {
	provider := NewGoogleOAuthProvider("client", "secret", "http://localhost/callback")
	provider.HTTPClient = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Body:       io.NopCloser(bytes.NewBufferString(`{"error":"invalid_grant"}`)),
				Header:     make(http.Header),
			}, nil
		}),
	}
	_, err := provider.Exchange(context.Background(), "bad-code")
	assert.ErrorIs(t, err, domain.ErrOAuthExchangeFailed)
}
