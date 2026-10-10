"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { cardCounts, groupCards, parseCard, type CardGroup } from "@/lib/cardModel";
import type { Setup } from "@/lib/setup";
import { activeCards, moduleFingerprint, moduleTestStatus, testStatus } from "@/lib/testRecord";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type AuthoredBlock, type ContentAuthoringService } from "@/services/contentAuthoringService";
import { practiceService, type PracticeService } from "@/services/practiceService";
import { ActionMenu } from "./ActionMenu";
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

const lastBlockId = (group: CardGroup) => group.blocks[group.blocks.length - 1]!.id;
const editHref = (moduleId: string, group: CardGroup) => `/app/modules/${moduleId}/cards/${group.key}`;

/**
 * The "Conteúdo" tab of the module edit page: one card per row, as the student sees them, with
 * an action menu (see, edit, inactivate, remove) and buttons to move it (SPEC-019).
 */
export function ContentTab({ moduleId, service = contentAuthoringService, practice = practiceService }: ContentTabProps) {
  const router = useRouter();
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
      const order = [...groups];
      [order[index], order[to]] = [order[to] as CardGroup, order[index] as CardGroup];
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
            <InfoTip topic={m.title}>{authoringMessages.info.contentTab}</InfoTip>
          </div>
          <p className={styles.hint}>{m.hint}</p>
          {(() => {
            const cards = activeCards(blocks);
            if (!cards.some((c) => c.commands.length > 0)) return null;
            const status = moduleTestStatus(moduleId, moduleFingerprint(cards, moduleSetup));
            return (
              <span className={`${styles.badge} ${status === "passed" ? styles.badgeOk : styles.badgeOff}`} title={m.testAll.moduleTitle}>
                {m.testAll.moduleTest[status]}
              </span>
            );
          })()}
        </div>
        <div className={styles.add}>
          <Link href={`/app/modules/${moduleId}/cards/new`} className={`${styles.primary}`}>
            {m.add}
          </Link>
          <button type="button" className={styles.secondary} title={m.testAll.moduleOpenTitle} onClick={() => setTestingModule((n) => n + 1)}>
            {m.testAll.moduleOpen}
          </button>
          <Link href={`/app/modules/${moduleId}?draft=1`} className={styles.link}>
            {m.previewDraft}
          </Link>
          <Link href={`/app/modules/${moduleId}`} className={styles.link}>
            {m.preview}
          </Link>
        </div>
      </div>

      <details className={styles.environment}>
        <summary className={styles.environmentSummary}>
          <span aria-hidden="true">🧪</span> {m.environment.title}
        </summary>
        <p className={styles.hint}>
          <InfoTip topic="Ambiente do módulo">{authoringMessages.info.moduleEnvironment}</InfoTip> Para que serve este ambiente?
        </p>
        <ModuleSetupTab moduleId={moduleId} service={service} practice={practice} onSaved={setModuleSetup} />
      </details>

      {testingModule > 0 && <TestAll key={testingModule} moduleId={moduleId} service={service} practice={practice} onResult={() => setMarks((n) => n + 1)} onClose={() => setTestingModule(0)} />}

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
            const title = group.header ? String(group.header.payload.title ?? "") : m.intro;
            const pill = group.header ? String(group.header.payload.command ?? "") : "";
            return (
              <li key={group.key} className={`${styles.block} ${inactive ? styles.inactiveBlock : ""}`}>
                <div className={styles.row}>
                  <span className={styles.number} aria-label={m.position(index + 1, groups.length)}>
                    {index + 1}
                  </span>
                  {pill && <code className={styles.pill}>{pill}</code>}
                  <div className={styles.summary}>
                    <span className={styles.cardTitle}>{title || m.untitled}</span>
                    <span className={styles.counts}>
                      {summaryOf(group).length === 0
                        ? m.summary.none
                        : summaryOf(group).map((part) => (
                            <span key={part.text} className={styles.chip}>
                              <span aria-hidden="true">{part.icon}</span> {part.text}
                            </span>
                          ))}
                    </span>
                  </div>
                  {(() => {
                    const status = testStatus(moduleId, group.key, parseCard(group));
                    return status === "none" ? null : (
                      <span className={`${styles.badge} ${status === "passed" ? styles.badgeOk : styles.badgeOff}`} title={m.test.title}>
                        {m.test[status]}
                      </span>
                    );
                  })()}
                  {edited && <span className={styles.badge}>{m.edited}</span>}
                  {inactive && <span className={`${styles.badge} ${styles.badgeOff}`}>{m.inactive}</span>}
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.smallButton} onClick={() => void move(index, index - 1)} disabled={index === 0} aria-label={`${m.moveUp} ${index + 1}`}>
                      ↑
                    </button>
                    <button type="button" className={styles.smallButton} onClick={() => void move(index, index + 1)} disabled={index === groups.length - 1} aria-label={`${m.moveDown} ${index + 1}`}>
                      ↓
                    </button>
                    <Link href={`/app/modules/${moduleId}/cards/new?after=${lastBlockId(group)}`} className={styles.smallButton} aria-label={`${m.addAfter} ${index + 1}`}>
                      +
                    </Link>
                    <ActionMenu
                      label={m.actionsOf(index + 1)}
                      text={m.actions}
                      actions={[
                        { key: "view", label: m.view, onSelect: () => setViewing(group.key) },
                        { key: "edit", label: m.edit, onSelect: () => router.push(editHref(moduleId, group)) },
                        { key: "active", label: inactive ? m.activate : m.inactivate, onSelect: () => void toggleActive(group, inactive) },
                        { key: "remove", label: m.remove, danger: true, onSelect: () => setRemoving(group.key) },
                      ]}
                    />
                  </div>
                </div>

                {removing === group.key && (
                  <div className={styles.confirm} role="alertdialog" aria-label={m.remove}>
                    <p>{m.removeConfirm}</p>
                    <div className={styles.actions}>
                      <button type="button" className={styles.secondary} onClick={() => setRemoving(null)}>
                        {m.cancel}
                      </button>
                      <button type="button" className={styles.danger} onClick={() => void remove(group)}>
                        {m.removeYes}
                      </button>
                    </div>
                  </div>
                )}

                {viewing === group.key && (
                  <div className={styles.viewer}>
                    <div className={styles.viewerHead}>
                      <h3 className={styles.viewerTitle}>{m.viewTitle}</h3>
                      <button type="button" className={styles.secondary} onClick={() => setViewing(null)}>
                        {m.close}
                      </button>
                    </div>
                    <ContentRenderer blocks={group.blocks} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
