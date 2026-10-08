"use client";

import { useState } from "react";
import { messages } from "@/messages/pt-BR";
import { TextField, type TextFieldProps } from "@/components/TextField/TextField";
import styles from "./PasswordField.module.scss";

/** Password input with a show/hide toggle. */
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
          <span aria-hidden="true">{visible ? "◉" : "◎"}</span>
        </button>
      }
    />
  );
}
