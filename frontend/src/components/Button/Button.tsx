import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.scss";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  /** The height: md is 44 px, sm is 32 px. */
  size?: "md" | "sm";
  /** A square button with only an icon; it needs a name (aria-label or hidden text) and a title. */
  icon?: boolean;
  block?: boolean;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {}

/** The classes and data attributes of the one pattern of button of the system (SPEC-047, CA-06). */
export function buttonStyle({ variant = "primary", size = "md", icon = false, block = false }: ButtonStyleProps, className?: string) {
  return {
    className: [styles.button, styles[variant], size === "sm" ? styles.sm : "", icon ? styles.icon : "", block ? styles.block : "", className ?? ""]
      .filter(Boolean)
      .join(" "),
    "data-variant": variant,
    "data-size": size,
    "data-icon": icon ? "true" : undefined,
  };
}

export function Button({ variant, size, icon, block, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} {...buttonStyle({ variant, size, icon, block }, className)} {...rest} />;
}
