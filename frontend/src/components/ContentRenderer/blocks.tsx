// One component per block type of the SPEC-011 catalog. HTML fields were
// filtered by the backend (SPEC-011 RN-08) and are rendered as received.
import { LsAnatomy } from "@/components/LsAnatomy/LsAnatomy";
import { PermissionCalculator } from "@/components/PermissionCalculator/PermissionCalculator";
import { contentMessages as m } from "@/messages/content.pt-BR";
import styles from "./ContentRenderer.module.scss";

type Payload = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v : "");
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function Html({ html, className }: { html: string; className?: string }) {
  return <div className={`${styles.html} ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TextBlock({ payload }: { payload: Payload }) {
  const title = text(payload.title);
  return (
    <section className={styles.text}>
      {title && <h3 className={styles.blockTitle}>{title}</h3>}
      <Html html={text(payload.html)} />
    </section>
  );
}

interface Step {
  command: string;
  explanation?: string;
  terminal?: number;
  login?: { user: string };
}

export function CommandBlock({ payload }: { payload: Payload }) {
  return (
    <ol className={styles.commands}>
      {list<Step>(payload.steps).map((step, i) => (
        <li key={i} className={styles.command}>
          <div className={styles.commandLine}>
            {(step.terminal ?? 1) > 1 && <span className={styles.terminalTag}>{m.terminal(step.terminal ?? 1)}</span>}
            {step.login && <span className={styles.terminalTag}>{m.loginAs(step.login.user)}</span>}
            <code>{step.command}</code>
          </div>
          {step.explanation && <p className={styles.explanation}>{step.explanation}</p>}
        </li>
      ))}
    </ol>
  );
}

export function TipBlock({ payload }: { payload: Payload }) {
  const warning = payload.variant === "WARNING";
  return (
    <aside className={`${styles.tip} ${warning ? styles.warning : ""}`} aria-label={warning ? m.warningTitle : m.tipTitle}>
      <strong className={styles.tipTitle}>{text(payload.title) || (warning ? m.warningTitle : m.tipTitle)}</strong>
      <Html html={text(payload.html)} />
    </aside>
  );
}

export function CuriosityBlock({ payload }: { payload: Payload }) {
  return (
    <aside className={styles.curiosity}>
      {text(payload.title) && <strong className={styles.tipTitle}>{text(payload.title)}</strong>}
      <Html html={text(payload.html)} />
    </aside>
  );
}

export function StepByStepBlock({ payload }: { payload: Payload }) {
  return (
    <ol className={styles.steps}>
      {list<string>(payload.steps).map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

export function CardsBlock({ payload }: { payload: Payload }) {
  return (
    <div className={styles.cards}>
      {list<{ title: string; text: string }>(payload.cards).map((card, i) => (
        <article key={i} className={styles.card}>
          <h4 className={styles.blockTitle}>{card.title}</h4>
          <p>{card.text}</p>
        </article>
      ))}
    </div>
  );
}

export function WidgetBlock({ payload }: { payload: Payload }) {
  if (payload.component === "PERMISSION_CALCULATOR") return <PermissionCalculator />;
  if (payload.component === "LS_ANATOMY") return <LsAnatomy />;
  return <UnknownBlock />;
}

export function LegacyHtmlBlock({ payload }: { payload: Payload }) {
  return <Html html={text(payload.html)} className={styles.legacy} />;
}

export function UnknownBlock() {
  return <p className={styles.unknown}>{m.unknownBlock}</p>;
}
