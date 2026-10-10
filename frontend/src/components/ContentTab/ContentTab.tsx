"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import {
  cardCounts,
  groupCards,
  parseCard,
  type CardGroup,
} from "@/lib/cardModel";
import type { Setup } from "@/lib/setup";
import {
  activeCards,
  moduleFingerprint,
  moduleTestStatus,
  testStatus,
} from "@/lib/testRecord";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import {
  contentAuthoringService,
  type AuthoredBlock,
  type ContentAuthoringService,
} from "@/services/contentAuthoringService";
import {
  practiceService,
  type PracticeService,
} from "@/services/practiceService";
import { ActionMenu } from "./ActionMenu";
import { CardModal } from "./CardModal";
import { ModuleSetupTab } from "@/components/ModuleSetupTab/ModuleSetupTab";
import { TestAll } from "./TestAll";
import styles from "./ContentTab.module.scss";

const m = authoringMessages.cards;

interface ContentTabProps {
  moduleId: string;
  service?: ContentAuthoringService;
  practice?: Pick<PracticeService, "topicScenario">;
}

/** What the card has, one chip each: "3 comandos", "1 dica"… (the list is empty for a card with no content). */
function summaryOf(group: CardGroup): { icon: string; text: string }[] {
  const c = cardCounts(group);
  const parts = [
    c.texts > 0 && { icon: "📝", text: m.summary.texts(c.texts) },
    c.commands > 0 && { icon: "💻", text: m.summary.commands(c.commands) },
    c.tips > 0 && { icon: "💡", text: m.summary.tips(c.tips) },
    c.real > 0 && { icon: "🌎", text: m.summary.real(c.real) },
    c.exams > 0 && { icon: "🎓", text: m.summary.exams(c.exams) },
    c.exercises > 0 && { icon: "🎯", text: m.summary.exercises(c.exercises) },
    c.others > 0 && { icon: "📦", text: m.summary.others(c.others) },
  ];
  return parts.filter((p): p is { icon: string; text: string } => Boolean(p));
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });

/** When the card was created and by whom, and when it was last changed and by whom (the update is left out if nothing changed since the creation). */
function auditOf(group: CardGroup): { created?: string; updated?: string } {
  const withDate = group.blocks.filter((b) => b.createdAt);
  if (withDate.length === 0) return {};
  const first = withDate.reduce((a, b) =>
    a.createdAt! <= b.createdAt! ? a : b,
  );
  const last = group.blocks.reduce((a, b) =>
    a.updatedAt >= b.updatedAt ? a : b,
  );
  const created = m.audit.created(
    when(first.createdAt!),
    first.createdBy ?? "",
  );
  const changed = last.updatedAt > first.createdAt!;
  return {
    created,
    updated: changed
      ? m.audit.updated(when(last.updatedAt), last.updatedBy ?? "")
      : undefined,
  };
}

const lastBlockId = (group: CardGroup) =>
  group.blocks[group.blocks.length - 1]!.id;
const editHref = (moduleId: string, group: CardGroup) =>
  `/app/modules/${moduleId}/cards/${group.key}`;

/**
 * The "Conteúdo" tab of the module edit page: one card per row, as the student sees them, with
 * an action menu (see, edit, inactivate, remove) and buttons to move it (SPEC-019).
 */
export function ContentTab({
  moduleId,
  service = contentAuthoringService,
  practice = practiceService,
}: ContentTabProps) {
  const router = useRouter();
  // Sort mode: the cards can be dragged (or moved with the arrows) to a new place.
  const [sorting, setSorting] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<AuthoredBlock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testingModule, setTestingModule] = useState(0);
  const [moduleSetup, setModuleSetup] = useState<Setup | undefined>();
  // Each result of the test of all cards redraws the list, which reads the marks from storage.
  const [, setMarks] = useState(0);

  useEffect(() => {
    let active = true;
    service
      .list(moduleId)
      .then((list) => {
        if (!active) return;
        setBlocks(list);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    // The snapshot of the module is part of what the test of the module depends on.
    Promise.resolve(service.content?.(moduleId))
      .then((c) => active && setModuleSetup(c?.setup))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [service, moduleId, attempt]);

  const reload = () => setAttempt((n) => n + 1);

  if (failed && !blocks) {
    return (
      <div className={styles.notice} role="alert">
        <p>{m.loadError}</p>
        <button type="button" className={styles.secondary} onClick={reload}>
          {m.retry}
        </button>
      </div>
    );
  }
  if (!blocks) return <p className={styles.hint}>{m.loading}</p>;

  const groups = groupCards(blocks);
  const ids = (group: CardGroup) => group.blocks.map((b) => b.id);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch {
      setNote(m.genericError);
    }
  };

  const move = (index: number, to: number) =>
    run(async () => {
      if (index === to) return;
      const order = [...groups];
      order.splice(to, 0, order.splice(index, 1)[0] as CardGroup);
      setBlocks(await service.reorder(moduleId, order.flatMap(ids)));
      setNote(null);
    });

  const toggleActive = (group: CardGroup, active: boolean) =>
    run(async () => {
      setBlocks(await service.setCardActive(moduleId, ids(group), active));
      setNote(active ? m.activated : m.inactivated);
    });

  const remove = (group: CardGroup) =>
    run(async () => {
      await service.saveCard(moduleId, { replaceIds: ids(group), blocks: [] });
      setRemoving(null);
      setViewing(null);
      setNote(m.removed);
      reload();
    });

  return (
    <div className={styles.tab}>
      <div className={styles.toolbar}>
        <div>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              📚
            </span>
            <h2 className={styles.title}>{m.title}</h2>
            <InfoTip topic={m.title}>
              {authoringMessages.info.contentTab}
            </InfoTip>
          </div>
          <p className={styles.hint}>{m.hint}</p>
          {(() => {
            const cards = activeCards(blocks);
            if (!cards.some((c) => c.commands.length > 0)) return null;
            const status = moduleTestStatus(
              moduleId,
              moduleFingerprint(cards, moduleSetup),
            );
            return (
              <span
                className={`${styles.badge} ${styles.cornerBadge} ${status === "passed" ? styles.badgeOk : styles.badgeOff}`}
                title={m.testAll.moduleTitle}
              >
                {m.testAll.moduleTest[status]}
              </span>
            );
          })()}
        </div>
        <div className={styles.add}>
          <Link
            href={`/app/modules/${moduleId}/cards/new`}
            className={`${styles.primary}`}
          >
            {m.add}
          </Link>
          <button
            type="button"
            className={`${styles.secondary} ${sorting ? styles.secondaryOn : ""}`}
            aria-pressed={sorting}
            onClick={() => setSorting((v) => !v)}
          >
            <span aria-hidden="true">{sorting ? "✅" : "↕️"}</span>{" "}
            {sorting ? m.sortDone : m.sort}
          </button>
          <button
            type="button"
            className={styles.secondary}
            title={m.testAll.moduleOpenTitle}
            onClick={() => setTestingModule((n) => n + 1)}
          >
            <span aria-hidden="true">🧪</span> {m.testAll.moduleOpen}
          </button>
          <span className={styles.viewGroup}>
            <Link
              href={`/app/modules/${moduleId}?draft=1`}
              className={styles.link}
            >
              <span aria-hidden="true">📝</span> {m.previewDraft}
            </Link>
            <Link href={`/app/modules/${moduleId}`} className={styles.link}>
              <span aria-hidden="true">🎓</span> {m.preview}
            </Link>
          </span>
        </div>
      </div>
      {sorting && (
        <p className={styles.sortHint} role="status">
          {m.sortHint}
        </p>
      )}

      <details className={styles.environment}>
        <summary className={styles.environmentSummary}>
          <span aria-hidden="true">🧪</span> {m.environment.title}
          <span className={styles.environmentCta}>
            <span className={styles.ctaOpen}>{m.environment.open}</span>
            <span className={styles.ctaClose}>{m.environment.close}</span>
          </span>
        </summary>
        <ModuleSetupTab
          moduleId={moduleId}
          service={service}
          practice={practice}
          onSaved={setModuleSetup}
        />
      </details>

      {testingModule > 0 && (
        <TestAll
          key={testingModule}
          moduleId={moduleId}
          service={service}
          practice={practice}
          onResult={() => setMarks((n) => n + 1)}
          onClose={() => setTestingModule(0)}
        />
      )}

      {note && (
        <p className={styles.flash} role="status">
          {note}
        </p>
      )}

      {groups.length === 0 ? (
        <p className={styles.hint}>{m.empty}</p>
      ) : (
        <ol className={styles.blocks}>
          {groups.map((group, index) => {
            const inactive = group.blocks.every((b) => !b.active);
            const edited = group.blocks.some((b) => b.edited);
            const status = testStatus(moduleId, group.key, parseCard(group));
            const title = group.header
              ? String(group.header.payload.title ?? "")
              : m.intro;
            const pill = group.header
              ? String(group.header.payload.command ?? "")
              : "";
            return (
              <li
                key={group.key}
                className={`${styles.block} ${inactive ? styles.inactiveBlock : ""} ${status === "passed" ? styles.blockOk : ""} ${sorting ? styles.sortable : ""} ${dragging === index ? styles.dragging : ""} ${over === index && dragging !== null && dragging !== index ? styles.dropTarget : ""}`}
                draggable={sorting}
                onClick={(event) => {
                  // A click on the row opens the card, except on the buttons and links inside it, and while sorting.
                  if (
                    sorting ||
                    (event.target as HTMLElement).closest(
                      "a, button, [role=menu]",
                    )
                  )
                    return;
                  setViewing(group.key);
                }}
                onDragStart={() => setDragging(index)}
                onDragOver={(event) => {
                  if (dragging === null) return;
                  event.preventDefault();
                  setOver(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging !== null) void move(dragging, index);
                  setDragging(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
              >
                <div className={styles.row}>
                  {sorting && (
                    <span
                      className={styles.handle}
                      aria-label={m.dragCard(index + 1)}
                      role="img"
                    >
                      ⠿
                    </span>
                  )}
                  <span
                    className={styles.number}
                    aria-label={m.position(index + 1, groups.length)}
                  >
                    {index + 1}
                  </span>
                  {pill && <code className={styles.pill}>{pill}</code>}
                  <div className={styles.summary}>
                    <button
                      type="button"
                      className={styles.cardTitle}
                      disabled={sorting}
                      onClick={() => setViewing(group.key)}
                    >
                      {title || m.untitled}
                    </button>
                    <span className={styles.counts}>
                      {summaryOf(group).length === 0
                        ? m.summary.none
                        : summaryOf(group).map((part) => (
                            <span key={part.text} className={styles.chip}>
                              <span aria-hidden="true">{part.icon}</span>{" "}
                              {part.text}
                            </span>
                          ))}
                    </span>
                    {(() => {
                      const { created, updated } = auditOf(group);
                      if (!created) return null;
                      return (
                        <span className={styles.audit}>
                          <span>
                            <span aria-hidden="true">🆕</span> {created}
                          </span>
                          {updated && (
                            <span>
                              <span aria-hidden="true">🔄</span> {updated}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </div>
                  <div className={styles.badgeBar}>
                    {status !== "none" && (
                      <span
                        className={`${styles.badge} ${status === "passed" ? styles.badgeOk : styles.badgeOff}`}
                        title={m.test.title}
                      >
                        {m.test[status]}
                      </span>
                    )}
                    {edited && <span className={styles.badge}>{m.edited}</span>}
                    {inactive && (
                      <span className={`${styles.badge} ${styles.badgeOff}`}>
                        {m.inactive}
                      </span>
                    )}
                  </div>
                  <div className={styles.rowActions}>
                    {sorting ? (
                      <>
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => void move(index, index - 1)}
                          disabled={index === 0}
                          aria-label={`${m.moveUp} ${index + 1}`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => void move(index, index + 1)}
                          disabled={index === groups.length - 1}
                          aria-label={`${m.moveDown} ${index + 1}`}
                        >
                          ↓
                        </button>
                      </>
                    ) : (
                      <>
                        <ActionMenu
                          label={m.actionsOf(index + 1)}
                          text="⋮"
                          actions={[
                            {
                              key: "view",
                              icon: "👁️",
                              label: m.view,
                              onSelect: () => setViewing(group.key),
                            },
                            {
                              key: "edit",
                              icon: "✏️",
                              label: m.edit,
                              onSelect: () =>
                                router.push(editHref(moduleId, group)),
                            },
                            {
                              key: "after",
                              icon: "➕",
                              label: m.addAfter,
                              onSelect: () =>
                                router.push(
                                  `/app/modules/${moduleId}/cards/new?after=${lastBlockId(group)}`,
                                ),
                            },
                            {
                              key: "active",
                              icon: inactive ? "▶️" : "⏸️",
                              label: inactive ? m.activate : m.inactivate,
                              onSelect: () =>
                                void toggleActive(group, inactive),
                            },
                            {
                              key: "remove",
                              icon: "🗑️",
                              label: m.remove,
                              danger: true,
                              onSelect: () => setRemoving(group.key),
                            },
                          ]}
                        />
                      </>
                    )}
                  </div>
                </div>

                {removing === group.key && (
                  <div
                    className={styles.confirm}
                    role="alertdialog"
                    aria-label={m.remove}
                  >
                    <p>{m.removeConfirm}</p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => setRemoving(null)}
                      >
                        {m.cancel}
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => void remove(group)}
                      >
                        {m.removeYes}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {(() => {
        const open = groups.find((g) => g.key === viewing);
        if (!open) return null;
        const header = open.header
          ? String(open.header.payload.title ?? "")
          : "";
        return (
          <CardModal
            title={header || m.intro}
            blocks={open.blocks}
            editHref={editHref(moduleId, open)}
            onClose={() => setViewing(null)}
          />
        );
      })()}
    </div>
  );
}
