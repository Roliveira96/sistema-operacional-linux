import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonStyle, type ButtonStyleProps } from "./Button";

export interface ButtonLinkProps extends ComponentProps<typeof Link>, ButtonStyleProps {}

/** A link that looks exactly like a Button (SPEC-047, CA-06). */
export function ButtonLink({ variant, size, icon, block, className, ...rest }: ButtonLinkProps) {
  return <Link {...buttonStyle({ variant, size, icon, block }, className)} {...rest} />;
}
