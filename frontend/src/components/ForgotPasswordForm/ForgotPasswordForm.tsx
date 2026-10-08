"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/Alert/Alert";
import { AuthCard } from "@/components/AuthCard/AuthCard";
import { Button } from "@/components/Button/Button";
import { TextField } from "@/components/TextField/TextField";
import { messages } from "@/messages/pt-BR";
import { describeAuthError } from "@/services/authErrors";
import { authService, type AuthService } from "@/services/authService";
import styles from "./ForgotPasswordForm.module.scss";

/** Requests a reset link. The answer is always neutral (SPEC-003 RN-10). */
export function ForgotPasswordForm({ service = authService }: { service?: Pick<AuthService, "forgotPassword"> }) {
  const [identifier, setIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identifier.trim()) {
      setError(messages.auth.errors.required);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await service.forgotPassword(identifier.trim());
      setSent(true);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title={messages.auth.forgot.title} subtitle={messages.auth.forgot.subtitle}>
      {sent ? (
        <Alert tone="success">{messages.auth.forgot.sent}</Alert>
      ) : (
        <form className={styles.form} onSubmit={submit} noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <TextField
            label={messages.auth.login.identifier}
            name="identifier"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          <Button type="submit" block disabled={submitting}>
            {submitting ? messages.auth.forgot.submitting : messages.auth.forgot.submit}
          </Button>
        </form>
      )}
      <Link href="/login" className={styles.link}>
        {messages.auth.forgot.back}
      </Link>
    </AuthCard>
  );
}
