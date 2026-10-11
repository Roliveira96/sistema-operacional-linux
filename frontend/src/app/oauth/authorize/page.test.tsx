import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OAuthAuthorizePage from "./page";
import { messages } from "@/messages/pt-BR";
import { ApiProblemError } from "@/services/httpClient";

const replace = vi.fn();
let query = "client_id=c1&redirect_uri=http%3A%2F%2Flocalhost%3A9%2Fcb&code_challenge=ch&state=st&response_type=code";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));

const me = vi.fn();
const getClient = vi.fn();
const authorize = vi.fn();
vi.mock("@/services/authService", () => ({ authService: { me: () => me() } }));
vi.mock("@/services/oauthService", () => ({
  oauthService: { getClient: (id: string) => getClient(id), authorize: (r: unknown) => authorize(r) },
}));

const m = messages.oauthConsent;
const assign = vi.fn();
const problem = (type: string, status: number) => new ApiProblemError({ type, title: "t", status }, status);

beforeEach(() => {
  query = "client_id=c1&redirect_uri=http%3A%2F%2Flocalhost%3A9%2Fcb&code_challenge=ch&state=st&response_type=code";
  me.mockResolvedValue({ role: "TEACHER" });
  getClient.mockResolvedValue({ id: "c1", name: "Claude Code" });
  vi.stubGlobal("location", { ...window.location, pathname: "/oauth/authorize", search: `?${query}`, assign });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OAuthAuthorizePage", () => {
  it("sends an anonymous visitor to the login keeping the return path", async () => {
    me.mockRejectedValue(problem("unauthenticated", 401));
    render(<OAuthAuthorizePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  });

  it("denies a student without buttons or client lookup", async () => {
    me.mockResolvedValue({ role: "STUDENT" });
    render(<OAuthAuthorizePage />);
    expect(await screen.findByText(m.denied)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
    expect(getClient).not.toHaveBeenCalled();
  });

  it("shows the client and authorizes, then navigates to the returned url", async () => {
    authorize.mockResolvedValue({ redirectUrl: "http://localhost:9/cb?code=abc&state=st" });
    render(<OAuthAuthorizePage />);
    expect(await screen.findByText(m.intro("Claude Code"))).toBeDefined();
    expect(screen.getByText(m.cannot)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: m.allow }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://localhost:9/cb?code=abc&state=st"));
    expect(authorize).toHaveBeenCalledWith({
      clientId: "c1",
      redirectUri: "http://localhost:9/cb",
      codeChallenge: "ch",
      state: "st",
      allow: true,
    });
  });

  it("denies with allow=false", async () => {
    authorize.mockResolvedValue({ redirectUrl: "http://localhost:9/cb?error=access_denied" });
    render(<OAuthAuthorizePage />);
    fireEvent.click(await screen.findByRole("button", { name: m.deny }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("http://localhost:9/cb?error=access_denied"));
    expect(authorize.mock.calls[0]![0]).toMatchObject({ allow: false });
  });

  it("shows the problem of the authorize call and allows trying again", async () => {
    authorize.mockRejectedValue(problem("rate-limited", 429));
    render(<OAuthAuthorizePage />);
    fireEvent.click(await screen.findByRole("button", { name: m.allow }));
    expect(await screen.findByText(m.rateLimited)).toBeDefined();
    expect(assign).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: m.allow }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows an error when the client is not found", async () => {
    getClient.mockRejectedValue(problem("oauth-client-not-found", 404));
    render(<OAuthAuthorizePage />);
    expect(await screen.findByText(m.clientNotFound)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows an invalid request when the params are missing", () => {
    query = "client_id=c1";
    render(<OAuthAuthorizePage />);
    expect(screen.getByText(m.invalidRequest)).toBeDefined();
    expect(me).not.toHaveBeenCalled();
  });
});
