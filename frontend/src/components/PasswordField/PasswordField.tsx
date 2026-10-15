"use client";

import { useState } from "react";
import { messages } from "@/messages/pt-BR";
import { TextField, type TextFieldProps } from "@/components/TextField/TextField";
import styles from "./PasswordField.module.scss";

const eye = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The open eye, for a password that is hidden (SPEC-066). */
function EyeIcon() {
  return (
    <svg {...eye}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** The crossed eye, for a password that is showing. */
function EyeOffIcon() {
  return (
    <svg {...eye}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

/** Password input with the eye that shows and hides what is typed. */
export function PasswordField(props: Omit<TextFieldProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  const label = visible ? messages.auth.hidePassword : messages.auth.showPassword;
  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setVisible((v) => !v)}
          aria-label={label}
          aria-pressed={visible}
          title={label}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}
