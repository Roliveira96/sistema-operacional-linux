// Package service implements Google OAuth2 / OIDC authentication (SPEC-008).
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
)

// GoogleOAuthProvider defines the interface for interacting with Google's OAuth2 endpoints.
type GoogleOAuthProvider interface {
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (domain.GoogleUserInfo, error)
	Configured() bool
}

// DefaultGoogleOAuthProvider implements GoogleOAuthProvider using standard HTTP requests.
type DefaultGoogleOAuthProvider struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	HTTPClient   *http.Client
}

// NewGoogleOAuthProvider creates a new provider.
func NewGoogleOAuthProvider(clientID, clientSecret, redirectURL string) *DefaultGoogleOAuthProvider {
	return &DefaultGoogleOAuthProvider{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		HTTPClient:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Configured reports whether the OAuth client has non-empty credentials.
func (p *DefaultGoogleOAuthProvider) Configured() bool {
	return p.ClientID != "" && p.ClientSecret != ""
}

// AuthCodeURL builds the Google authorization URL with required scopes.
func (p *DefaultGoogleOAuthProvider) AuthCodeURL(state string) string {
	if !p.Configured() {
		return ""
	}
	params := url.Values{}
	params.Set("client_id", p.ClientID)
	params.Set("redirect_uri", p.RedirectURL)
	params.Set("response_type", "code")
	params.Set("scope", "openid email profile")
	params.Set("state", state)
	params.Set("access_type", "online")
	params.Set("prompt", "select_account")
	return "https://accounts.google.com/o/oauth2/v2/auth?" + params.Encode()
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
	TokenType   string `json:"token_type"`
}

// Exchange swaps an authorization code for Google user claims.
func (p *DefaultGoogleOAuthProvider) Exchange(ctx context.Context, code string) (domain.GoogleUserInfo, error) {
	if !p.Configured() {
		return domain.GoogleUserInfo{}, domain.ErrGoogleOAuthNotConfigured
	}

	data := url.Values{}
	data.Set("code", code)
	data.Set("client_id", p.ClientID)
	data.Set("client_secret", p.ClientSecret)
	data.Set("redirect_uri", p.RedirectURL)
	data.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(data.Encode()))
	if err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.HTTPClient.Do(req)
	if err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("exchange code: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return domain.GoogleUserInfo{}, domain.ErrOAuthExchangeFailed
	}

	var tok tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("decode token: %w", err)
	}

	userReq, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("create userinfo request: %w", err)
	}
	userReq.Header.Set("Authorization", "Bearer "+tok.AccessToken)

	userResp, err := p.HTTPClient.Do(userReq)
	if err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("get userinfo: %w", err)
	}
	defer userResp.Body.Close()

	if userResp.StatusCode != http.StatusOK {
		return domain.GoogleUserInfo{}, domain.ErrOAuthExchangeFailed
	}

	bodyBytes, err := io.ReadAll(userResp.Body)
	if err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("read userinfo body: %w", err)
	}

	var userInfo domain.GoogleUserInfo
	if err := json.Unmarshal(bodyBytes, &userInfo); err != nil {
		return domain.GoogleUserInfo{}, fmt.Errorf("decode userinfo: %w", err)
	}

	return userInfo, nil
}
