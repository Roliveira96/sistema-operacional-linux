"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/Alert/Alert";
import { Button } from "@/components/Button/Button";
import { PasswordField } from "@/components/PasswordField/PasswordField";
import { TextField } from "@/components/TextField/TextField";
import { messages } from "@/messages/pt-BR";
import { describeAuthError } from "@/services/authErrors";
import { authService, type AuthService, type RegisterResult } from "@/services/authService";
import styles from "./RegisterForm.module.scss";

export interface RegisterFormProps {
  onSuccess: (result: RegisterResult) => void;
  service?: Pick<AuthService, "register">;
  onSwitchToLogin?: () => void;
}

/** Validates and normalizes academic ID if provided (7 numeric digits, optional leading 'a'/'A'). */
export function validateAcademicId(raw: string): { valid: boolean; normalized?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: true };
  let v = trimmed;
  if (v.startsWith("a") || v.startsWith("A")) {
    v = v.slice(1);
  }
  if (/^\d{7}$/.test(v)) {
    return { valid: true, normalized: v };
  }
  return { valid: false };
}

/** Self-service student registration form (SPEC-008). */
export function RegisterForm({ onSuccess, service = authService, onSwitchToLogin }: RegisterFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [academicId, setAcademicId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setError(messages.auth.errors.required);
      return;
    }
    const raCheck = validateAcademicId(academicId);
    if (!raCheck.valid) {
      setError(messages.auth.errors.invalidAcademicId);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await service.register(
        name.trim(),
        email.trim(),
        password,
        raCheck.normalized,
      );
      onSuccess(result);
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <TextField
        label={messages.auth.register.name}
        hint={messages.auth.register.nameHint}
        name="name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <TextField
        label={messages.auth.register.email}
        hint={messages.auth.register.emailHint}
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <TextField
        label={messages.auth.register.academicId}
        hint={messages.auth.register.academicIdHint}
        name="academicId"
        value={academicId}
        onChange={(e) => setAcademicId(e.target.value)}
      />
      <PasswordField
        label={messages.auth.register.password}
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Button type="submit" block disabled={submitting}>
        {submitting ? messages.auth.register.submitting : messages.auth.register.submit}
      </Button>
      {onSwitchToLogin && (
        <div className={styles.switchWrapper}>
          <span>{messages.auth.register.hasAccount}</span>{" "}
          <button type="button" className={styles.linkButton} onClick={onSwitchToLogin}>
            {messages.auth.register.loginAction}
          </button>
        </div>
      )}
    </form>
  );
}
