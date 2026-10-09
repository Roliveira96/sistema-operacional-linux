"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { groupCards, type CardGroup } from "@/lib/cardModel";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type ContentAuthoringService } from "@/services/contentAuthoringService";
import { CardBuilder } from "./CardBuilder";
import styles from "./CardScreen.module.scss";

const m = authoringMessages.builder;

interface CardScreenProps {
  moduleId: string;
  /** The key of the card being edited (the id of its first block); absent for a new card. */
  cardKey?: string;
  /** A new card goes after this block. */
  afterId?: string;
  service?: ContentAuthoringService;
}

type State = { status: "loading" } | { status: "missing" } | { status: "ready"; group?: CardGroup };

/**
 * The screen of one card of a module: create (`/cards/new`) or edit (`/cards/[blockId]`). It loads
 * the blocks, finds the card and hands it to the builder (SPEC-019).
 */
export function CardScreen({ moduleId, cardKey, afterId, service = contentAuthoringService }: CardScreenProps) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const back = `/app/modules/${moduleId}/edit?tab=content`;

  useEffect(() => {
    let active = true;
    service
      .list(moduleId)
      .then((blocks) => {
        if (!active) return;
        if (!cardKey) return setState({ status: "ready" });
        const group = groupCards(blocks).find((g) => g.key === cardKey);
        setState(group ? { status: "ready", group } : { status: "missing" });
      })
      .catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, [service, moduleId, cardKey]);

  const title = !cardKey ? m.newTitle : state.status === "ready" && state.group && !state.group.header ? m.introTitle : m.editTitle;

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Link href={back} className={styles.back}>
          {m.back}
        </Link>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{m.subtitle}</p>
      </header>

      {state.status === "loading" && <p className={styles.note}>{m.loading}</p>}
      {state.status === "missing" && (
        <p className={styles.missing} role="alert">
          {m.notFound}
        </p>
      )}
      {state.status === "ready" && (
        <CardBuilder
          // A card opened again from the server starts the form over.
          key={state.group?.key ?? "new"}
          moduleId={moduleId}
          group={state.group}
          afterId={afterId}
          service={service}
          onCancel={() => router.push(back)}
          onCreated={(blocks) => router.replace(`/app/modules/${moduleId}/cards/${blocks[0]!.id}`)}
        />
      )}
    </main>
  );
}
