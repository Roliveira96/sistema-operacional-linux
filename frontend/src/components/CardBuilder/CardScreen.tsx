"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { groupCards, type CardGroup } from "@/lib/cardModel";
import { allLayers, type Setup, type SetupLayer } from "@/lib/setup";
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

type State = { status: "loading" } | { status: "missing" } | { status: "ready"; group?: CardGroup; before: SetupLayer[] };

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
      .content(moduleId)
      .then(({ blocks, setup }) => {
        if (!active) return;
        const groups = groupCards(blocks);
        // The snapshots that run before the card: the module, then the cards above it (SPEC-021 RN-03).
        const layersBefore = (index: number) => allLayers(setup as Setup | undefined, groups.slice(0, index).flatMap((g) => g.blocks));
        if (!cardKey) {
          // A new card goes after the card that holds `afterId`, or at the end.
          const after = afterId ? groups.findIndex((g) => g.blocks.some((b) => b.id === afterId)) : -1;
          return setState({ status: "ready", before: layersBefore(after >= 0 ? after + 1 : groups.length) });
        }
        const at = groups.findIndex((g) => g.key === cardKey);
        setState(at >= 0 ? { status: "ready", group: groups[at], before: layersBefore(at) } : { status: "missing" });
      })
      .catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, [service, moduleId, cardKey, afterId]);

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
          before={state.before}
          service={service}
          onCancel={() => router.push(back)}
          onCreated={(blocks) => router.replace(`/app/modules/${moduleId}/cards/${blocks[0]!.id}`)}
        />
      )}
    </main>
  );
}
