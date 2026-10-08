"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/Alert/Alert";
import { Button } from "@/components/Button/Button";
import { PasswordField } from "@/components/PasswordField/PasswordField";
import { checkPassword } from "@/lib/passwordPolicy";
import { messages } from "@/messages/pt-BR";
import { describeAuthError } from "@/services/authErrors";
import { authService, type AuthService } from "@/services/authService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./ChangePasswordForm.module.scss";

export interface ChangePasswordFormProps {
  email?: string;
  onSuccess: () => void;
  service?: Pick<AuthService, "changePassword">;
}

/** Changes the password of the signed-in user (SPEC-003, forced or voluntary). */
export function ChangePasswordForm({ email, onSuccess, service = authService }: ChangePasswordFormProps) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const violations = password ? checkPassword(password, { email, current }) : [];
  const mismatch = confirm !== "" && confirm !== password;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current || !password || violations.length > 0 || password !== confirm) {
      setError(password !== confirm ? messages.auth.mismatch : messages.auth.errors.required);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await service.changePassword(current, password);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof ApiProblemError && err.type === "invalid-credentials"
          ? messages.auth.change.wrongCurrent
          : describeAuthError(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <PasswordField
        label={messages.auth.change.current}
        name="currentPassword"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
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
        {submitting ? messages.auth.change.submitting : messages.auth.change.submit}
      </Button>
    </form>
  );
}
