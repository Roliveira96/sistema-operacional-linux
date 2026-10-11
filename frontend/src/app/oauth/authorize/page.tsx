"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { authService } from "@/services/authService";
import { ApiProblemError } from "@/services/httpClient";
import { oauthService } from "@/services/oauthService";
import styles from "./page.module.scss";

const m = messages.oauthConsent;

type State =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "ready"; clientName: string }
  | { kind: "submitting"; clientName: string };

function problemText(error: unknown): string {
  if (error instanceof ApiProblemError) {
    if (error.status === 429) return m.rateLimited;
    if (error.status === 403) return m.forbidden;
    if (error.status === 400) return m.badRequest;
  }
  return m.submitFailed;
}

/** Consent screen of the MCP client OAuth login (SPEC-024 RN-14). */
function ConsentContent() {
  const router = useRouter();
  const params = useSearchParams();
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const state = params.get("state") ?? "";
  const valid = clientId !== "" && redirectUri !== "" && codeChallenge !== "";

  const [view, setView] = useState<State>(valid ? { kind: "loading" } : { kind: "error", text: m.invalidRequest });
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!valid) return;
    let active = true;
    (async () => {
      try {
        const me = await authService.me();
        if (!active) return;
        if (me.role !== "ADMIN" && me.role !== "TEACHER") {
          setDenied(true);
          return;
        }
        const client = await oauthService.getClient(clientId);
        if (active) setView({ kind: "ready", clientName: client.name });
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiProblemError && error.type === "oauth-client-not-found") {
          setView({ kind: "error", text: m.clientNotFound });
        } else if (error instanceof ApiProblemError && error.status === 401) {
          const back = `${window.location.pathname}${window.location.search}`;
          router.replace(`/login?next=${encodeURIComponent(back)}`);
        } else {
          setView({ kind: "error", text: m.loadFailed });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [valid, clientId, router]);

  async function decide(allow: boolean) {
    if (view.kind !== "ready") return;
    const { clientName } = view;
    setView({ kind: "submitting", clientName });
    try {
      const { redirectUrl } = await oauthService.authorize({ clientId, redirectUri, codeChallenge, state, allow });
      window.location.assign(redirectUrl);
    } catch (error) {
      setView({ kind: "ready", clientName });
      setSubmitError(problemText(error));
    }
  }

  const [submitError, setSubmitError] = useState<string | null>(null);

  if (denied) {
    return (
      <main className={styles.page}>
        <p className={styles.error} role="alert">
          {m.denied}
        </p>
      </main>
    );
  }
  if (view.kind === "loading") {
    return (
      <main className={styles.page}>
        <p role="status">{m.loading}</p>
      </main>
    );
  }
  if (view.kind === "error") {
    return (
      <main className={styles.page}>
        <p className={styles.error} role="alert">
          {view.text}
        </p>
      </main>
    );
  }

  const busy = view.kind === "submitting";
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>{m.title}</h1>
        <p>{m.intro(view.clientName)}</p>
        <h2 className={styles.subtitle}>{m.canTitle}</h2>
        <p>{m.can}</p>
        <h2 className={styles.subtitle}>{m.cannotTitle}</h2>
        <p>{m.cannot}</p>
        <p className={styles.hint}>{m.redirectTo(redirectUri)}</p>
        {submitError && (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void decide(true)}>
            {busy ? m.submitting : m.allow}
          </button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void decide(false)}>
            {m.deny}
          </button>
        </div>
      </section>
    </main>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense>
      <ConsentContent />
    </Suspense>
  );
}
