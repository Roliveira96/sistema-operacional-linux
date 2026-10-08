"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/Alert/Alert";
import { AuthCard } from "@/components/AuthCard/AuthCard";
import { Button } from "@/components/Button/Button";
import { PasswordField } from "@/components/PasswordField/PasswordField";
import { TextField } from "@/components/TextField/TextField";
import { messages } from "@/messages/pt-BR";
import { describeAuthError } from "@/services/authErrors";
import { authService, type AuthService, type LoginResult } from "@/services/authService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./LoginForm.module.scss";

export interface LoginFormProps {
  onSuccess: (result: LoginResult) => void;
  /** Why the user landed here: IDLE, ABSOLUTE or LOGOUT. */
  reason?: string | null;
  service?: Pick<AuthService, "login">;
}

/** Login by e-mail or academic id (SPEC-003). */
export function LoginForm({ onSuccess, reason, service = authService }: LoginFormProps) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedSeconds, setLockedSeconds] = useState(0);

  useEffect(() => {
    if (lockedSeconds <= 0) return;
    const timer = setTimeout(() => setLockedSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockedSeconds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      setError(messages.auth.errors.required);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onSuccess(await service.login(identifier.trim(), password));
    } catch (err) {
      if (err instanceof ApiProblemError && err.type === "rate-limited") {
        setLockedSeconds(err.retryAfterSeconds ?? 60);
        setError(null);
      } else {
        setError(describeAuthError(err));
      }
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  const reasonText = reason ? messages.auth.login.reason[reason] : undefined;
  const locked = lockedSeconds > 0;

  return (
    <AuthCard title={messages.auth.login.title} subtitle={messages.auth.login.subtitle}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {reasonText && <Alert tone="info">{reasonText}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {locked && <Alert tone="warning">{messages.auth.login.rateLimited(lockedSeconds)}</Alert>}
        <TextField
          label={messages.auth.login.identifier}
          hint={messages.auth.login.identifierHint}
          name="identifier"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
        />
        <PasswordField
          label={messages.auth.login.password}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" block disabled={submitting || locked}>
          {submitting ? messages.auth.login.submitting : messages.auth.login.submit}
        </Button>
        <Link href="/forgot-password" className={styles.link}>
          {messages.auth.login.forgot}
        </Link>
      </form>
    </AuthCard>
  );
}
