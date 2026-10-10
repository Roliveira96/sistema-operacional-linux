"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import cardStyles from "@/components/CardBuilder/CardBuilder.module.scss";
import { messages } from "@/messages/pt-BR";
import {
  accessTokenService,
  tokenStatus,
  TOKEN_VALIDITY_DAYS,
  type AccessToken,
  type AccessTokenService,
  type CreatedAccessToken,
  type TokenValidityDays,
} from "@/services/accessTokenService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./AccessTokensSection.module.scss";

const m = messages.accessTokens;

interface AccessTokensSectionProps {
  service?: AccessTokenService;
  confirm?: (message: string) => boolean;
  /** Where the MCP endpoint lives: the API origin, or this page's origin by default. */
  apiOrigin?: string;
  copyText?: (text: string) => Promise<void>;
}

/** The configuration a Claude Code project needs to reach the MCP server with the token (HTTP transport). */
export function mcpConfigSnippet(origin: string, token: string): string {
  return JSON.stringify(
    { mcpServers: { "linux-lab": { type: "http", url: `${origin.replace(/\/$/, "")}/mcp`, headers: { Authorization: `Bearer ${token}` } } } },
    null,
    2,
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** "Acesso por agentes (MCP)" of the profile: lists, creates (value shown once) and revokes personal access tokens (SPEC-024 3.1). */
export function AccessTokensSection({
  service = accessTokenService,
  confirm = (text) => window.confirm(text),
  apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? window.location.origin,
  copyText = (text) => navigator.clipboard.writeText(text),
}: AccessTokensSectionProps) {
  const id = useId();
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [form, setForm] = useState<{ name: string; days: TokenValidityDays } | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedAccessToken | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => setTokens(await service.list()), [service]);

  useEffect(() => {
    let active = true;
    service
      .list()
      .then((list) => {
        if (!active) return;
        setTokens(list);
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [service, attempt]);

  const copy = async (text: string, ok: string) => {
    try {
      await copyText(text);
      setFlash({ kind: "ok", text: ok });
    } catch {
      setFlash({ kind: "error", text: m.copyFailed });
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const name = form.name.trim();
    if (name === "" || name.length > 80) {
      setFlash({ kind: "error", text: m.nameRequired });
      return;
    }
    setSaving(true);
    setFlash(null);
    try {
      setCreated(await service.create(name, form.days));
      setForm(null);
      await load().catch(() => undefined);
    } catch (error: unknown) {
      setFlash({ kind: "error", text: error instanceof ApiProblemError && error.type === "rate-limited" ? m.rateLimited : m.createFailed });
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (token: AccessToken) => {
    if (!confirm(m.revokeConfirm(token.name))) return;
    setFlash(null);
    try {
      await service.revoke(token.id);
      setFlash({ kind: "ok", text: m.revoked(token.name) });
      await load();
    } catch {
      setFlash({ kind: "error", text: m.revokeFailed });
    }
  };

  const snippet = created ? mcpConfigSnippet(apiOrigin, created.token) : "";

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <header className={styles.head}>
        <div>
          <h2 id={`${id}-title`} className={styles.title}>
            {m.title}
          </h2>
          <p className={cardStyles.hint}>{m.help}</p>
        </div>
        {!form && !created && (
          <button type="button" className={cardStyles.primary} onClick={() => setForm({ name: "", days: 90 })}>
            {m.create}
          </button>
        )}
      </header>

      {flash && (
        <p className={flash.kind === "ok" ? styles.ok : cardStyles.error} role={flash.kind === "ok" ? "status" : "alert"}>
          {flash.text}
        </p>
      )}

      {form && (
        <form className={styles.form} onSubmit={(e) => void submit(e)}>
          <div className={cardStyles.field}>
            <label className={cardStyles.label} htmlFor={`${id}-name`}>
              {m.nameLabel}
            </label>
            <input
              id={`${id}-name`}
              className={cardStyles.input}
              value={form.name}
              maxLength={80}
              placeholder={m.namePlaceholder}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className={cardStyles.field}>
            <label className={cardStyles.label} htmlFor={`${id}-days`}>
              {m.validityLabel}
            </label>
            <select
              id={`${id}-days`}
              className={cardStyles.input}
              value={form.days}
              onChange={(e) => setForm({ ...form, days: Number(e.target.value) as TokenValidityDays })}
            >
              {TOKEN_VALIDITY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {m.validityOption(d)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.actions}>
            <button type="submit" className={cardStyles.primary} disabled={saving}>
              {saving ? m.submitting : m.submit}
            </button>
            <button type="button" className={cardStyles.secondary} onClick={() => setForm(null)} disabled={saving}>
              {m.cancel}
            </button>
          </div>
        </form>
      )}

      {created && (
        <div className={styles.created} role="region" aria-label={m.createdTitle}>
          <h3 className={styles.subtitle}>{m.createdTitle}</h3>
          <p className={styles.warning} role="alert">
            {m.createdWarning}
          </p>
          <label className={cardStyles.label} htmlFor={`${id}-value`}>
            {m.tokenLabel}
          </label>
          <div className={styles.row}>
            <input id={`${id}-value`} className={cardStyles.input} readOnly value={created.token} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className={cardStyles.primary} onClick={() => void copy(created.token, m.copied)}>
              {m.copy}
            </button>
          </div>
          <h3 className={styles.subtitle}>{m.snippetTitle}</h3>
          <p className={cardStyles.hint}>{m.snippetHelp}</p>
          <pre className={styles.snippet} tabIndex={0} aria-label={m.snippetTitle}>
            {snippet}
          </pre>
          <div className={styles.actions}>
            <button type="button" className={cardStyles.secondary} onClick={() => void copy(snippet, m.snippetCopied)}>
              {m.copySnippet}
            </button>
            <button type="button" className={cardStyles.secondary} onClick={() => setCreated(null)}>
              {m.done}
            </button>
          </div>
        </div>
      )}

      {state === "loading" && <p className={cardStyles.hint}>{m.loading}</p>}
      {state === "error" && (
        <div className={styles.actions}>
          <p className={cardStyles.error} role="alert">
            {m.loadFailed}
          </p>
          <button
            type="button"
            className={cardStyles.secondary}
            onClick={() => {
              setState("loading");
              setAttempt((n) => n + 1);
            }}
          >
            {m.retry}
          </button>
        </div>
      )}
      {state === "ready" && tokens.length === 0 && <p className={cardStyles.hint}>{m.empty}</p>}
      {state === "ready" && tokens.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label={m.listLabel}>
            <thead>
              <tr>
                <th scope="col">{m.columns.name}</th>
                <th scope="col">{m.columns.created}</th>
                <th scope="col">{m.columns.lastUsed}</th>
                <th scope="col">{m.columns.expires}</th>
                <th scope="col">{m.columns.status}</th>
                <th scope="col">
                  <span className={styles.srOnly}>{m.revoke}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const status = tokenStatus(t);
                return (
                  <tr key={t.id}>
                    <th scope="row">{t.name}</th>
                    <td>{date(t.createdAt)}</td>
                    <td>{t.lastUsedAt ? date(t.lastUsedAt) : m.neverUsed}</td>
                    <td>{date(t.expiresAt)}</td>
                    <td>{m.status[status]}</td>
                    <td>
                      {status === "active" && (
                        <button type="button" className={cardStyles.danger} aria-label={m.revokeLabel(t.name)} onClick={() => void revoke(t)}>
                          {m.revoke}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
