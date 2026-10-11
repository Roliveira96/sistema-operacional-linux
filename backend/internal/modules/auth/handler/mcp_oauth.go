package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/domain"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/modules/auth/service"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/authn"
	"github.com/Roliveira96/sistema-operacional-linux/backend/internal/platform/problem"
)

// MCPOAuthService is the use-case port of the OAuth login of MCP clients (SPEC-024 RN-14).
type MCPOAuthService interface {
	RegisterOAuthClient(ctx context.Context, name string, redirectURIs []string) (domain.OAuthClient, error)
	GetOAuthClient(ctx context.Context, id uuid.UUID) (domain.OAuthClient, error)
	OAuthAuthorize(ctx context.Context, p authn.Principal, in service.OAuthAuthorizeInput) (string, error)
	OAuthExchange(ctx context.Context, in service.OAuthExchangeInput) (string, time.Duration, error)
}

// MCPOAuthURLs are the public addresses used in the discovery metadata.
type MCPOAuthURLs struct {
	// Backend is the public address of this service (the issuer and the resource).
	Backend string
	// Frontend is the address of the consent screen.
	Frontend string
}

// ProtectedResourceMetadataPath is advertised in the WWW-Authenticate header of the /mcp 401.
const ProtectedResourceMetadataPath = "/.well-known/oauth-protected-resource"

// MCPOAuthHandler serves the OAuth login of MCP clients: the discovery metadata, client registration and
// token exchange at the root (OAuth wire format), and the consent API under /api/v1 (session cookie).
type MCPOAuthHandler struct {
	svc      MCPOAuthService
	sessions authn.Validator
	urls     MCPOAuthURLs
	// authorizeLim limits codes per user; clientLim limits the public endpoints per client IP.
	authorizeLim CreateLimiter
	clientLim    CreateLimiter
}

// NewMCPOAuth creates the handler.
func NewMCPOAuth(svc MCPOAuthService, sessions authn.Validator, urls MCPOAuthURLs, authorizeLim, clientLim CreateLimiter) *MCPOAuthHandler {
	return &MCPOAuthHandler{svc: svc, sessions: sessions, urls: urls, authorizeLim: authorizeLim, clientLim: clientLim}
}

// Register mounts the consent API under the given group (expected: /api/v1). Session cookie only.
func (h *MCPOAuthHandler) Register(r gin.IRouter) {
	g := r.Group("/oauth", authn.Required(h.sessions), authn.PasswordChanged(),
		authn.Roles(authn.RoleTeacher, authn.RoleAdmin))
	g.GET("/clients/:id", h.client)
	g.POST("/authorize", h.authorize)
}

// RegisterRoot mounts the discovery, registration and token routes at the root of the router.
func (h *MCPOAuthHandler) RegisterRoot(r gin.IRouter) {
	r.GET(ProtectedResourceMetadataPath, h.protectedResource)
	r.GET(ProtectedResourceMetadataPath+"/mcp", h.protectedResource)
	r.GET("/.well-known/oauth-authorization-server", h.authorizationServer)
	r.POST("/oauth/register", h.register)
	r.POST("/oauth/token", h.token)
}

func (h *MCPOAuthHandler) protectedResource(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"resource":                 h.urls.Backend + "/mcp",
		"authorization_servers":    []string{h.urls.Backend},
		"bearer_methods_supported": []string{"header"},
	})
}

func (h *MCPOAuthHandler) authorizationServer(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"issuer":                                h.urls.Backend,
		"authorization_endpoint":                h.urls.Frontend + "/oauth/authorize",
		"token_endpoint":                        h.urls.Backend + "/oauth/token",
		"registration_endpoint":                 h.urls.Backend + "/oauth/register",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
	})
}

type registerClientRequest struct {
	ClientName   string   `json:"client_name"`
	RedirectURIs []string `json:"redirect_uris"`
}

func (h *MCPOAuthHandler) register(c *gin.Context) {
	if ok, _ := h.clientLim.Allow(c.ClientIP()); !ok {
		oauthError(c, http.StatusTooManyRequests, "invalid_request", "Too many requests.")
		return
	}
	var body registerClientRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		oauthError(c, http.StatusBadRequest, "invalid_client_metadata", "The body must be a JSON object.")
		return
	}
	client, err := h.svc.RegisterOAuthClient(c.Request.Context(), body.ClientName, body.RedirectURIs)
	if err != nil {
		h.oauthFailure(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"client_id":                  client.ID.String(),
		"client_name":                client.ClientName,
		"redirect_uris":              client.RedirectURIs,
		"grant_types":                []string{"authorization_code"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
	})
}

func (h *MCPOAuthHandler) token(c *gin.Context) {
	if ok, _ := h.clientLim.Allow(c.ClientIP()); !ok {
		oauthError(c, http.StatusTooManyRequests, "invalid_request", "Too many requests.")
		return
	}
	if c.PostForm("grant_type") != "authorization_code" {
		oauthError(c, http.StatusBadRequest, "unsupported_grant_type", "Only authorization_code is supported.")
		return
	}
	clientID, err := uuid.Parse(c.PostForm("client_id"))
	code, verifier := c.PostForm("code"), c.PostForm("code_verifier")
	if err != nil || code == "" || verifier == "" {
		oauthError(c, http.StatusBadRequest, "invalid_request", "client_id, code and code_verifier are required.")
		return
	}
	raw, validity, err := h.svc.OAuthExchange(c.Request.Context(), service.OAuthExchangeInput{
		ClientID: clientID, Code: code, CodeVerifier: verifier, RedirectURI: c.PostForm("redirect_uri"),
	})
	if err != nil {
		h.oauthFailure(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"access_token": raw, "token_type": "Bearer", "expires_in": int(validity.Seconds())})
}

// oauthFailure writes a domain error in the OAuth wire format; anything else is a 500.
func (h *MCPOAuthHandler) oauthFailure(c *gin.Context, err error) {
	switch {
	case errors.Is(err, domain.ErrOAuthInvalidRedirect):
		oauthError(c, http.StatusBadRequest, "invalid_redirect_uri", "Only loopback http redirect URIs are accepted.")
	case errors.Is(err, domain.ErrOAuthInvalidGrant):
		oauthError(c, http.StatusBadRequest, "invalid_grant", "The code is invalid, expired or already used.")
	case errors.Is(err, domain.ErrOAuthInvalidClient):
		oauthError(c, http.StatusBadRequest, "invalid_client", "The client is not registered.")
	case errors.Is(err, domain.ErrOAuthInvalidRequest):
		oauthError(c, http.StatusBadRequest, "invalid_request", "The request is invalid.")
	default:
		_ = c.Error(err)
		c.Abort()
	}
}

func oauthError(c *gin.Context, status int, code, description string) {
	c.Header("Cache-Control", "no-store")
	c.AbortWithStatusJSON(status, gin.H{"error": code, "error_description": description})
}

func (h *MCPOAuthHandler) client(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		fail(c, oauthClientNotFound())
		return
	}
	client, err := h.svc.GetOAuthClient(c.Request.Context(), id)
	if err != nil {
		fail(c, oauthProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": client.ID, "name": client.ClientName})
}

type authorizeRequest struct {
	ClientID      uuid.UUID `json:"clientId"`
	RedirectURI   string    `json:"redirectUri"`
	CodeChallenge string    `json:"codeChallenge"`
	State         string    `json:"state"`
	Allow         bool      `json:"allow"`
}

func (h *MCPOAuthHandler) authorize(c *gin.Context) {
	p, _ := authn.FromContext(c.Request.Context())
	if ok, retry := h.authorizeLim.Allow(p.UserID.String()); !ok {
		fail(c, rateLimited(retry))
		return
	}
	var body authorizeRequest
	if !bind(c, &body) {
		return
	}
	redirect, err := h.svc.OAuthAuthorize(c.Request.Context(), p, service.OAuthAuthorizeInput{
		ClientID: body.ClientID, RedirectURI: body.RedirectURI, CodeChallenge: body.CodeChallenge,
		State: body.State, Allow: body.Allow,
	})
	if err != nil {
		fail(c, oauthProblem(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"redirectUrl": redirect})
}

func oauthClientNotFound() *problem.Problem {
	return problem.NotFound("oauth-client-not-found", "The client is not registered.")
}

// oauthProblem maps the consent API errors to RFC 7807 problems.
func oauthProblem(err error) error {
	switch {
	case errors.Is(err, domain.ErrOAuthInvalidClient):
		return oauthClientNotFound()
	case errors.Is(err, domain.ErrOAuthInvalidRedirect):
		return problem.Validation("The redirect URI is not registered for this client.",
			problem.InvalidParam{Name: "redirectUri", Reason: "not registered"})
	case errors.Is(err, domain.ErrOAuthInvalidRequest):
		return problem.Validation("The code challenge must be a PKCE S256 challenge.",
			problem.InvalidParam{Name: "codeChallenge", Reason: "invalid"})
	case errors.Is(err, domain.ErrAccessTokenForbidden):
		return problem.Forbidden("forbidden", "This action is not allowed for the current user.")
	}
	return err
}
