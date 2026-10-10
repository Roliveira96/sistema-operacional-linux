"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import modal from "@/components/ContentTab/CardModal.module.scss";
import { SetupEditor } from "@/components/CardBuilder/SetupEditor";
import {
  ActionMenu,
  type MenuAction,
} from "@/components/ContentTab/ActionMenu";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import {
  hasSetup,
  invalidFiles,
  setupPayload,
  type Setup,
  type SetupLayer,
} from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import {
  contentAuthoringService,
  type ContentAuthoringService,
} from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import {
  moduleExerciseService,
  type ExerciseBank,
  type ExerciseLinks,
  type ModuleExercise,
  type ModuleExerciseService,
} from "@/services/moduleExerciseService";
import {
  practiceService,
  type PracticeService,
} from "@/services/practiceService";
import { BankTest } from "./BankTest";
import styles from "./ModuleExercisesTab.module.scss";

const m = authoringMessages.moduleExercises;
const level = authoringMessages.builder.exercises;

interface ModuleExercisesTabProps {
  moduleId: string;
  service?: ModuleExerciseService;
  content?: Pick<ContentAuthoringService, "content">;
  practice?: Pick<PracticeService, "topicScenario">;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
const same = (a?: Setup, b?: Setup) =>
  JSON.stringify(a && hasSetup(a) ? setupPayload(a) : null) ===
  JSON.stringify(b && hasSetup(b) ? setupPayload(b) : null);

type Block = "practice" | "assessment";
type Filter = "all" | "practice" | "assessment" | "exclusive" | "unlinked";
const FILTERS: Filter[] = ["all", "practice", "assessment", "exclusive", "unlinked"];

const linksOf = (it: ModuleExercise): ExerciseLinks => ({ practice: it.practice, assessment: it.assessment, exclusive: it.exclusive });
const inFilter = (it: ModuleExercise, f: Filter) =>
  f === "all" || (f === "unlinked" ? !it.practice && !it.assessment : f === "exclusive" ? it.exclusive : it[f]);
const tagsOf = (it: ModuleExercise) => {
  const tags: ("practice" | "assessment" | "exclusive" | "unlinked")[] = [];
  if (it.practice) tags.push("practice");
  if (it.assessment) tags.push("assessment");
  if (it.exclusive) tags.push("exclusive");
  return tags.length === 0 ? (["unlinked"] as const) : tags;
};

/** The window that lists the exercises of the bank not yet in the block, to link them to it (SPEC-023 11.1). */
function BankPicker({ block, items, onAdd, onClose }: { block: Block; items: ModuleExercise[]; onAdd: (it: ModuleExercise) => void; onClose: () => void }) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = items.filter((it) => it.exercise.title.toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(
    <div className={modal.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={modal.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={modal.head}>
          <h3 id={titleId} className={modal.kicker}>
            {m.pickerTitle(m[block === "practice" ? "available" : "assessment"].title)}
          </h3>
          <button type="button" className={modal.close} onClick={onClose}>
            {m.pickerClose}
          </button>
        </div>
        <div className={modal.body}>
          <input type="search" className={styles.search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.pickerFilter} aria-label={m.pickerFilter} />
          {shown.length === 0 ? (
            <p className={styles.empty}>{m.pickerEmpty}</p>
          ) : (
            <ul className={styles.pick}>
              {shown.map((it) => (
                <li key={it.exercise.id}>
                  <span>{it.exercise.title.trim() || m.untitled}</span>
                  <button type="button" className={styles.secondary} onClick={() => onAdd(it)} aria-label={`${m.pickerAdd} ${it.exercise.title.trim() || m.untitled}`}>
                    {m.pickerAdd}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The tab Exercícios of the edition of the module (SPEC-023 rev. 2): the central bank, where exercises are created, and two
 * blocks of links to it: the exercises available in the practice (the trail) and the ones reserved for assessment, over a single snapshot.
 */
export function ModuleExercisesTab({
  moduleId,
  service = moduleExerciseService,
  content = contentAuthoringService,
  practice = practiceService,
}: ModuleExercisesTabProps) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [bank, setBank] = useState<ExerciseBank>({ items: [] });
  const [moduleSetup, setModuleSetup] = useState<Setup | undefined>();
  const [bankSetup, setBankSetup] = useState<Setup | undefined>();
  const [filter, setFilter] = useState<Filter>("all");
  const [picking, setPicking] = useState<Block | null>(null);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(() => {
    let active = true;
    Promise.all([
      service.bank(moduleId),
      Promise.resolve(content.content(moduleId)),
    ])
      .then(([loaded, c]) => {
        if (!active) return;
        setBank(loaded);
        setBankSetup(loaded.bankSetup);
        setModuleSetup(c?.setup);
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [service, content, moduleId]);

  useEffect(() => load(), [load]);

  /** Reloads the bank after a change, keeping the snapshots that are being written. */
  const refresh = async () => {
    const loaded = await service.bank(moduleId);
    setBank(loaded);
  };

  const loadBase = useMemo(
    () => () => practice.topicScenario(moduleId),
    [practice, moduleId],
  );
  const before: SetupLayer[] = hasSetup(moduleSetup)
    ? [{ id: "module", kind: "module", label: "Módulo", setup: moduleSetup }]
    : [];
  const dirty = !same(bankSetup, bank.bankSetup);
  const invalid = invalidFiles(bankSetup).length > 0;

  const run = async (action: () => Promise<void>, ok: string) => {
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage({ kind: "ok", text: ok });
    } catch (error: unknown) {
      setMessage({
        kind: "error",
        text:
          error instanceof ApiProblemError && error.invalidParams.length > 0
            ? error.invalidParams.map((p) => p.reason).join("; ")
            : m.genericError,
      });
    }
  };

  const available = bank.items.filter((it) => it.practice).sort((a, b) => a.position - b.position);
  const reserved = bank.items.filter((it) => it.assessment);

  /** Links (or unlinks) an exercise; the bank keeps it either way. */
  const relink = (it: ModuleExercise, change: Partial<ExerciseLinks>, status = it.status) =>
    run(() => service.links(moduleId, it.exercise.id, { ...linksOf(it), ...change }, status).then(() => undefined), m.changed);

  const sendOrder = (list: ModuleExercise[]) =>
    run(
      () =>
        service.order(
          moduleId,
          list.map((it) => ({
            exerciseId: it.exercise.id,
            mandatory: it.mandatory,
          })),
        ),
      m.changed,
    );
  const move = (index: number, to: number) => {
    const next = [...available];
    next.splice(to, 0, next.splice(index, 1)[0]!);
    void sendOrder(next);
  };
  const toggleMandatory = (index: number) =>
    void sendOrder(
      available.map((it, i) =>
        i === index ? { ...it, mandatory: !it.mandatory } : it,
      ),
    );

  const saveSetups = async () => {
    setSaving(true);
    await run(
      () => service.setup(moduleId, bankSetup),
      m.setup.saved,
    );
    setSaving(false);
  };

  const actionsOf = (it: ModuleExercise, from: Block | "bank"): MenuAction[] => [
    {
      key: "open",
      icon: "✏️",
      label: m.open,
      onSelect: () => router.push(`/app/modules/${moduleId}/exercises/${it.exercise.id}`),
    },
    ...(from === "bank"
      ? []
      : [
          {
            key: "unlink",
            icon: "↩️",
            label: m.removeFromBlock,
            onSelect: () => void relink(it, from === "practice" ? { practice: false } : { assessment: false, exclusive: false }),
          },
        ]),
    it.status === "PUBLISHED"
      ? { key: "unpublish", icon: "📝", label: m.unpublish, onSelect: () => void relink(it, {}, "DRAFT") }
      : { key: "publish", icon: "🚀", label: m.publish, onSelect: () => void relink(it, {}, "PUBLISHED") },
    ...(from === "bank" ? [{ key: "remove", icon: "🗑️", label: m.remove, danger: true, onSelect: () => setRemoving(it.exercise.id) }] : []),
  ];

  if (state === "loading") return <p className={styles.note}>{m.loading}</p>;
  if (state === "error")
    return (
      <div className={styles.note} role="alert">
        <p>{m.loadFailed}</p>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            setState("loading");
            load();
          }}
        >
          {m.retry}
        </button>
      </div>
    );

  const row = (it: ModuleExercise, index: number, from: Block | "bank") => {
    const trail = from === "practice";
    const ex = it.exercise;
    const title = ex.title.trim() || m.untitled;
    return (
      <li key={ex.id} className={styles.row}>
        <span className={styles.number} aria-hidden="true">
          {trail ? index + 1 : from === "assessment" ? "🔒" : "📦"}
        </span>
        <div className={styles.body}>
          <Link
            href={`/app/modules/${moduleId}/exercises/${ex.id}`}
            className={styles.title}
            aria-label={m.openExercise(title)}
          >
            {title}
          </Link>
          <span className={styles.meta}>
            {level.difficulty[ex.difficulty]} ·{" "}
            {level.hintCount(ex.hints.length)} ·{" "}
            {ex.solution ? level.hasSolution : level.noSolution} ·{" "}
            {level.conditionCount(ex.conditions.length)}
          </span>
          {it.legacy && <span className={styles.legacy}>{m.legacy}</span>}
          <span className={styles.audit}>
            {it.createdAt && (
              <span>
                <span aria-hidden="true">🆕</span>{" "}
                {m.created(when(it.createdAt), it.createdBy)}
              </span>
            )}
            {it.updatedAt && it.updatedAt !== it.createdAt && (
              <span>
                <span aria-hidden="true">🔄</span>{" "}
                {m.updated(when(it.updatedAt), it.updatedBy)}
              </span>
            )}
          </span>
          {removing === ex.id && (
            <div
              className={styles.confirm}
              role="alertdialog"
              aria-label={m.remove}
            >
              <p>{m.removeConfirm}</p>
              <div className={styles.confirmActions}>
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
                  onClick={() => {
                    setRemoving(null);
                    void run(() => service.remove(moduleId, ex.id), m.removed);
                  }}
                >
                  {m.removeYes}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className={styles.marks}>
          <span
            className={`${styles.badge} ${it.status === "PUBLISHED" ? styles.badgeOk : styles.badgeOff}`}
          >
            {m.status[it.status]}
          </span>
          {it.dependsOn && (
            <span className={styles.chain}>
              <span aria-hidden="true">↪</span>{" "}
              {m.dependsOnChip(bank.items.find((o) => o.exercise.id === it.dependsOn)?.exercise.title.trim() || m.untitled)}
            </span>
          )}
          {from === "bank" &&
            tagsOf(it).map((t) => (
              <span key={t} className={styles.tag}>
                {m.bank.tags[t]}
              </span>
            ))}
          {from === "assessment" && (
            <label className={styles.mandatory}>
              <input
                type="checkbox"
                checked={it.exclusive}
                onChange={() => void relink(it, it.exclusive ? { exclusive: false } : { exclusive: true, practice: false })}
                aria-label={m.exclusiveLabel(title)}
              />{" "}
              {m.exclusive}
            </label>
          )}
          {trail && (
            <label className={styles.mandatory}>
              <input
                type="checkbox"
                checked={it.mandatory}
                onChange={() => toggleMandatory(index)}
                aria-label={m.mandatoryLabel(title)}
              />{" "}
              {it.mandatory ? m.mandatory : m.optional}
            </label>
          )}
        </div>
        <div className={styles.actions}>
          {trail && (
            <>
              <button
                type="button"
                className={styles.small}
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={`${m.moveUp} ${title}`}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.small}
                onClick={() => move(index, index + 1)}
                disabled={index === available.length - 1}
                aria-label={`${m.moveDown} ${title}`}
              >
                ↓
              </button>
            </>
          )}
          <ActionMenu
            label={m.actionsOf(title)}
            text="⋮"
            actions={actionsOf(it, from)}
          />
        </div>
      </li>
    );
  };

  const block = (kind: Block) => {
    const list = kind === "practice" ? available : reserved;
    const text = m[kind === "practice" ? "available" : "assessment"];
    return (
      <section className={styles.set} aria-label={text.title}>
        <header className={styles.setHead}>
          <span className={styles.icon} aria-hidden="true">
            {kind === "practice" ? "🎯" : "🔒"}
          </span>
          <div>
            <div className={styles.titleRow}>
              <h3 className={styles.setTitle}>{text.title}</h3>
              <InfoTip topic={text.title}>{authoringMessages.info[kind === "practice" ? "availableSet" : "assessmentSet"]}</InfoTip>
            </div>
            <p className={styles.hint}>{text.hint}</p>
          </div>
          <div className={styles.setActions}>
            <button type="button" className={styles.secondary} onClick={() => setPicking(kind)}>
              {m.addFromBank}
            </button>
            <Link href={`/app/modules/${moduleId}/exercises/new?link=${kind}`} className={styles.primary}>
              {m.createNew}
            </Link>
          </div>
        </header>
        {list.length === 0 ? (
          <p className={styles.empty}>{text.empty}</p>
        ) : (
          <ol className={styles.list}>{list.map((it, i) => row(it, i, kind))}</ol>
        )}
      </section>
    );
  };

  const bankItems = bank.items.filter((it) => inFilter(it, filter));
  const pickable = bank.items.filter((it) => (picking === "practice" ? !it.practice && !it.exclusive : !it.assessment));

  return (
    <div className={styles.tab}>
      <header className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true">
          🎯
        </span>
        <div className={styles.headText}>
          <div className={styles.titleRow}>
            <h2 className={styles.headTitle}>{m.title}</h2>
            <InfoTip topic={m.title}>
              {authoringMessages.info.exerciseBank}
            </InfoTip>
          </div>
          <p className={styles.hint}>{m.hint}</p>
        </div>
        <button type="button" className={styles.secondary} title={authoringMessages.bankTest.buttonTitle} onClick={() => setTesting(true)}>
          <span aria-hidden="true">🧪</span> {authoringMessages.bankTest.button}
        </button>
      </header>

      {message && (
        <p
          className={message.kind === "ok" ? styles.ok : styles.error}
          role={message.kind === "ok" ? "status" : "alert"}
        >
          {message.text}
        </p>
      )}

      <section className={styles.set} aria-label={m.bank.title}>
        <header className={styles.setHead}>
          <span className={styles.icon} aria-hidden="true">
            📦
          </span>
          <div>
            <h3 className={styles.setTitle}>{m.bank.title}</h3>
            <p className={styles.hint}>{m.bank.hint}</p>
          </div>
          <div className={styles.setActions}>
            <Link href={`/app/modules/${moduleId}/exercises/new`} className={styles.primary}>
              {m.createNew}
            </Link>
          </div>
        </header>
        <div className={styles.filters} role="group" aria-label={m.bank.filterLabel}>
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`${styles.chip} ${filter === f ? styles.chipOn : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {m.bank.filters[f]}
            </button>
          ))}
        </div>
        {bankItems.length === 0 ? (
          <p className={styles.empty}>{m.bank.empty}</p>
        ) : (
          <ol className={styles.list}>{bankItems.map((it, i) => row(it, i, "bank"))}</ol>
        )}
      </section>

      {block("practice")}
      {block("assessment")}

      <details className={styles.setup}>
        <summary>
          <span aria-hidden="true">🧪</span> {m.setup.title}
        </summary>
        <p className={styles.hint}>
          <InfoTip topic={m.setup.title}>{authoringMessages.info.exerciseSetup}</InfoTip> {m.setup.help}
        </p>
        <SetupEditor setup={bankSetup} before={before} loadBase={loadBase} help={m.setup.help} recordLabel={m.setup.record} onChange={setBankSetup} />
      </details>

      <div className={styles.foot}>
        {dirty && <span className={styles.unsaved}>{m.setup.unsaved}</span>}
        <button type="button" className={styles.primary} onClick={() => void saveSetups()} disabled={saving || !dirty || invalid}>
          {saving ? m.setup.saving : m.setup.save}
        </button>
      </div>

      {testing && (
        <BankTest
          moduleId={moduleId}
          bank={bank}
          moduleSetup={moduleSetup}
          loadBase={loadBase}
          service={service}
          onClose={() => setTesting(false)}
          onChanged={() => void refresh()}
        />
      )}

      {picking && (
        <BankPicker
          block={picking}
          items={pickable}
          onClose={() => setPicking(null)}
          onAdd={(it) => {
            const target = picking;
            setPicking(null);
            void relink(it, target === "practice" ? { practice: true } : { assessment: true });
          }}
        />
      )}
    </div>
  );
}
