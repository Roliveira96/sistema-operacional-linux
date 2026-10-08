"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import styles from "./page.module.scss";

const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function HomePage() {
  const { user } = useAuth();
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>{messages.home.greeting(user.name ?? user.email)}</h1>
      <p className={styles.text}>{messages.home.intro}</p>
      <p className={styles.meta}>{messages.home.sessionUntil(timeFormat.format(new Date(user.sessionExpiresAt)))}</p>
      <Link href="/status">{messages.home.status}</Link>
    </section>
  );
}
