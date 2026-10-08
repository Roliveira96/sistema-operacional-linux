import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.scss";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  block?: boolean;
}

export function Button({ variant = "primary", block = false, className, type = "button", ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], block ? styles.block : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
