"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/Alert/Alert";
import { AuthCard } from "@/components/AuthCard/AuthCard";
import { Button } from "@/components/Button/Button";
import { PasswordField } from "@/components/PasswordField/PasswordField";
import { checkPassword } from "@/lib/passwordPolicy";
import { messages } from "@/messages/pt-BR";
import { describeAuthError } from "@/services/authErrors";
import { authService, type AuthService } from "@/services/authService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./ResetPasswordForm.module.scss";

/** Sets a new password from the e-mailed token (SPEC-003 RN-11). */
export function ResetPasswordForm({
  token,
  service = authService,
}: {
  token: string | null;
  service?: Pick<AuthService, "resetPassword">;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(!token);
  const [error, setError] = useState<string | null>(null);

  const violations = password ? checkPassword(password) : [];
  const mismatch = confirm !== "" && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || violations.length > 0 || !password || password !== confirm) {
      setError(password !== confirm ? messages.auth.mismatch : messages.auth.errors.required);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await service.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiProblemError && err.type === "reset-token-invalid") {
        setTokenInvalid(true);
      } else {
        setError(describeAuthError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthCard title={messages.auth.reset.title}>
        <Alert tone="success">{messages.auth.reset.success}</Alert>
        <Link href="/login" className={styles.link}>
          {messages.auth.reset.goToLogin}
        </Link>
      </AuthCard>
    );
  }

  if (tokenInvalid) {
    return (
      <AuthCard title={messages.auth.reset.title}>
        <Alert tone="danger">{token ? messages.auth.reset.invalidToken : messages.auth.reset.missingToken}</Alert>
        <Link href="/forgot-password" className={styles.link}>
          {messages.auth.reset.requestNew}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={messages.auth.reset.title} subtitle={messages.auth.reset.subtitle}>
      <form className={styles.form} onSubmit={submit} noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <PasswordField
          label={messages.auth.newPassword}
          name="newPassword"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={violations.map((v) => messages.auth.policy[v]).join(" ") || undefined}
          required
        />
        <PasswordField
          label={messages.auth.confirmPassword}
          name="confirmPassword"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? messages.auth.mismatch : undefined}
          required
        />
        <Button type="submit" block disabled={submitting || violations.length > 0 || mismatch}>
          {submitting ? messages.auth.reset.submitting : messages.auth.reset.submit}
        </Button>
      </form>
    </AuthCard>
  );
}
