"use client";

import Image from "next/image";
import Link from "next/link";
import { messages } from "@/messages/pt-BR";
import styles from "./BrandMark.module.scss";

/** The real logo of the university and the name of the platform, as a link (SPEC-007, SPEC-015). */
export function BrandMark({ href }: { href: string }) {
  return (
    <Link href={href} className={styles.link} aria-label={`${messages.public.nav.brand} - ${messages.public.nav.institution}`}>
      <span className={styles.seal}>
        <Image src="/utfpr-logo.svg" alt={messages.public.nav.logoAlt} width={78} height={22} className={styles.logo} unoptimized />
      </span>
      <span className={styles.title}>{messages.public.nav.brand}</span>
    </Link>
  );
}
