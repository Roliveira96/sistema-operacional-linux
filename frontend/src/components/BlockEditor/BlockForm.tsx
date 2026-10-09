"use client";

import { useId, type ReactNode } from "react";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { emptyStep, type Payload } from "./blockModel";
import styles from "./BlockEditor.module.scss";

const m = authoringMessages.blocks;

export type FieldErrors = Record<string, string>;

interface BlockFormProps {
  type: string;
  payload: Payload;
  onChange: (payload: Payload) => void;
  errors: FieldErrors;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function Field({ label, help, error, htmlFor, children }: { label: string; help?: string; error?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && !error && <span className={styles.help}>{help}</span>}
      {error && (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function TextInput({ label, help, error, value, onChange, mono }: { label: string; help?: string; error?: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      <input id={id} className={`${styles.input} ${mono ? styles.mono : ""}`} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} />
    </Field>
  );
}

function TextArea({ label, help, error, value, onChange, rows = 3 }: { label: string; help?: string; error?: string; value: string; onChange: (v: string) => void; rows?: number }) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} htmlFor={id}>
      <textarea id={id} className={styles.textarea} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} />
    </Field>
  );
}

function Rich({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (v: string) => void }) {
  const errId = useId();
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <RichTextEditor label={label} value={value} onChange={onChange} invalid={Boolean(error)} describedBy={error ? errId : undefined} />
      {error && (
        <span id={errId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function RowTools({ index, total, onMove, onRemove, removeLabel, upLabel, downLabel }: { index: number; total: number; onMove: (to: number) => void; onRemove: () => void; removeLabel: string; upLabel: string; downLabel: string }) {
  return (
    <div className={styles.rowTools}>
      <button type="button" className={styles.smallButton} onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`${upLabel} ${index + 1}`}>
        ↑
      </button>
      <button type="button" className={styles.smallButton} onClick={() => onMove(index + 1)} disabled={index === total - 1} aria-label={`${downLabel} ${index + 1}`}>
        ↓
      </button>
      <button type="button" className={styles.smallButton} onClick={onRemove} disabled={total <= 1} aria-label={`${removeLabel} ${index + 1}`}>
        ✕
      </button>
    </div>
  );
}

interface Step {
  command?: string;
  explanation?: string;
  outputExplanation?: string;
  terminal?: number;
  login?: { user?: string; password?: string };
  answers?: string[];
}

function CommandSteps({ payload, onChange, errors }: Omit<BlockFormProps, "type">) {
  const s = m.steps;
  const steps = (Array.isArray(payload.steps) ? payload.steps : []) as Step[];
  const set = (next: Step[]) => onChange({ ...payload, steps: next });
  const patch = (i: number, change: Partial<Step>) => set(steps.map((step, j) => (j === i ? { ...step, ...change } : step)));

  return (
    <div className={styles.list}>
      {errors.steps && (
        <span className={styles.error} role="alert">
          {errors.steps}
        </span>
      )}
      {steps.map((step, i) => {
        const at = (name: string) => errors[`steps[${i}].${name}`];
        const terminal = step.terminal ?? 1;
        return (
          <fieldset key={i} className={styles.item}>
            <legend className={styles.legend}>{s.item(i + 1)}</legend>
            <RowTools index={i} total={steps.length} onMove={(to) => set(move(steps, i, to))} onRemove={() => set(steps.filter((_, j) => j !== i))} removeLabel={s.remove} upLabel={s.up} downLabel={s.down} />
            <TextInput label={`${s.command} (${i + 1})`} mono error={at("command")} value={str(step.command)} onChange={(v) => patch(i, { command: v })} />
            <TextArea label={`${s.explanation} (${i + 1})`} error={at("explanation")} value={str(step.explanation)} onChange={(v) => patch(i, { explanation: v })} />
            <TextArea label={`${s.output} (${i + 1})`} error={at("outputExplanation")} value={str(step.outputExplanation)} onChange={(v) => patch(i, { outputExplanation: v })} />
            <Field label={`${s.terminal} (${i + 1})`} error={at("terminal")}>
              <select className={styles.input} value={terminal} onChange={(e) => patch(i, { terminal: Number(e.target.value) })} aria-label={`${s.terminal} (${i + 1})`}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            {terminal > 1 && (
              <div className={styles.pair}>
                <TextInput label={`${s.user} (${i + 1})`} error={at("login")} value={str(step.login?.user)} onChange={(v) => patch(i, { login: { user: v, password: step.login?.password ?? "" } })} />
                <TextInput label={`${s.password} (${i + 1})`} value={str(step.login?.password)} onChange={(v) => patch(i, { login: { user: step.login?.user ?? "", password: v } })} />
              </div>
            )}
            <TextArea
              label={`${s.answers} (${i + 1})`}
              rows={2}
              error={at("answers")}
              value={(step.answers ?? []).join("\n")}
              onChange={(v) => patch(i, { answers: v === "" ? [] : v.split("\n") })}
            />
          </fieldset>
        );
      })}
      <button type="button" className={styles.addButton} onClick={() => set([...steps, emptyStep() as Step])}>
        {s.add}
      </button>
    </div>
  );
}

function TextSteps({ payload, onChange, errors }: Omit<BlockFormProps, "type">) {
  const t = m.textSteps;
  const steps = (Array.isArray(payload.steps) ? payload.steps : []).map(str);
  const set = (next: string[]) => onChange({ ...payload, steps: next });
  return (
    <div className={styles.list}>
      {errors.steps && (
        <span className={styles.error} role="alert">
          {errors.steps}
        </span>
      )}
      {steps.map((value, i) => (
        <div key={i} className={styles.item}>
          <RowTools index={i} total={steps.length} onMove={(to) => set(move(steps, i, to))} onRemove={() => set(steps.filter((_, j) => j !== i))} removeLabel={m.steps.remove} upLabel={m.steps.up} downLabel={m.steps.down} />
          <TextArea label={t.item(i + 1)} rows={2} error={errors[`steps[${i}]`]} value={value} onChange={(v) => set(steps.map((x, j) => (j === i ? v : x)))} />
        </div>
      ))}
      <button type="button" className={styles.addButton} onClick={() => set([...steps, ""])}>
        {t.add}
      </button>
    </div>
  );
}

function Cards({ payload, onChange, errors }: Omit<BlockFormProps, "type">) {
  const c = m.cards;
  const cards = (Array.isArray(payload.cards) ? payload.cards : []) as { title?: string; text?: string }[];
  const set = (next: { title?: string; text?: string }[]) => onChange({ ...payload, cards: next });
  const patch = (i: number, change: object) => set(cards.map((card, j) => (j === i ? { ...card, ...change } : card)));
  return (
    <div className={styles.list}>
      {errors.cards && (
        <span className={styles.error} role="alert">
          {errors.cards}
        </span>
      )}
      {cards.map((card, i) => (
        <fieldset key={i} className={styles.item}>
          <legend className={styles.legend}>{c.item(i + 1)}</legend>
          <RowTools index={i} total={cards.length} onMove={(to) => set(move(cards, i, to))} onRemove={() => set(cards.filter((_, j) => j !== i))} removeLabel={c.remove} upLabel={c.remove} downLabel={c.remove} />
          <TextInput label={`${c.cardTitle} (${i + 1})`} error={errors[`cards[${i}].title`]} value={str(card.title)} onChange={(v) => patch(i, { title: v })} />
          <TextArea label={`${c.cardText} (${i + 1})`} error={errors[`cards[${i}].text`]} value={str(card.text)} onChange={(v) => patch(i, { text: v })} />
        </fieldset>
      ))}
      <button type="button" className={styles.addButton} onClick={() => set([...cards, { title: "", text: "" }])}>
        {c.add}
      </button>
    </div>
  );
}

/** The editor of one block, chosen by its type (SPEC-019 section 3.1). */
export function BlockForm({ type, payload, onChange, errors }: BlockFormProps) {
  const f = m.fields;
  const set = (change: Payload) => onChange({ ...payload, ...change });
  const title = <TextInput label={f.title} help={f.titleHelp} error={errors.title} value={str(payload.title)} onChange={(v) => set({ title: v })} />;
  const text = <Rich label={f.text} value={str(payload.html)} error={errors.html} onChange={(v) => set({ html: v })} />;

  switch (type) {
    case "TEXT":
      return (
        <div className={styles.form}>
          {title}
          <TextInput label={f.cardLabel} help={f.cardLabelHelp} error={errors.command} value={str(payload.command)} onChange={(v) => set({ command: v })} />
          {text}
        </div>
      );
    case "TIP":
      return (
        <div className={styles.form}>
          <Field label={f.variant} error={errors.variant}>
            <select className={styles.input} value={str(payload.variant) || "DEFAULT"} onChange={(e) => set({ variant: e.target.value })} aria-label={f.variant}>
              <option value="DEFAULT">{f.variantDefault}</option>
              <option value="WARNING">{f.variantWarning}</option>
            </select>
          </Field>
          {title}
          {text}
        </div>
      );
    case "CURIOSITY":
      return (
        <div className={styles.form}>
          {title}
          {text}
        </div>
      );
    case "COMMAND":
      return <CommandSteps payload={payload} onChange={onChange} errors={errors} />;
    case "STEP_BY_STEP":
      return <TextSteps payload={payload} onChange={onChange} errors={errors} />;
    case "CARDS":
      return <Cards payload={payload} onChange={onChange} errors={errors} />;
    case "WIDGET":
      return (
        <div className={styles.form}>
          <Field label={f.component} error={errors.component}>
            <select className={styles.input} value={str(payload.component)} onChange={(e) => set({ component: e.target.value })} aria-label={f.component}>
              <option value="PERMISSION_CALCULATOR">{f.componentPermission}</option>
              <option value="LS_ANATOMY">{f.componentLs}</option>
            </select>
          </Field>
        </div>
      );
    default:
      return (
        <div className={styles.form}>
          <TextArea label={f.html} help={f.htmlHelp} error={errors.html} rows={10} value={str(payload.html)} onChange={(v) => set({ html: v })} />
        </div>
      );
  }
}
