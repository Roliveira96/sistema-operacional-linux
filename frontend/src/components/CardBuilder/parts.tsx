import { InfoTip } from "@/components/InfoTip/InfoTip";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { CardErrors } from "@/lib/cardModel";
import styles from "./CardBuilder.module.scss";

const m = authoringMessages.builder;

const reasonText = (reason: string) => {
  const known: Record<string, string> = { required: m.required, https: m.https, youtube: m.youtube, url: m.url, "needs-title": m.setup.needsTitleError, "hint-required": m.exercises.hintRequired, "files-invalid": m.setup.filesInvalid };
  return known[reason] ?? reason;
};

export function Errors({ id, errors }: { id: string; errors: CardErrors }) {
  const list = errors[id];
  if (!list) return null;
  return (
    <div className={styles.error} role="alert">
      {list.map((reason) => (
        <p key={reason}>{reasonText(reason)}</p>
      ))}
    </div>
  );
}

export function Field({ label, htmlFor, info, children }: { label: string; htmlFor?: string; info?: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
        {info && <InfoTip topic={label}>{info}</InfoTip>}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, hint, info, action, children }: { title: string; hint: string; info?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <div>
          <div className={styles.titleRow}>
            <h2 className={styles.sectionTitle}>{title}</h2>
            {info && <InfoTip topic={title}>{info}</InfoTip>}
          </div>
          <p className={styles.hint}>{hint}</p>
        </div>
      </header>
      {children}
      {action && <div className={styles.sectionFoot}>{action}</div>}
    </section>
  );
}

export function Tools({ index, total, labels, onMove, onRemove }: { index: number; total: number; labels: { up: string; down: string; remove: string }; onMove: (to: number) => void; onRemove: () => void }) {
  return (
    <div className={styles.tools}>
      <button type="button" className={styles.small} onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`${labels.up} ${index + 1}`}>
        ↑
      </button>
      <button type="button" className={styles.small} onClick={() => onMove(index + 1)} disabled={index === total - 1} aria-label={`${labels.down} ${index + 1}`}>
        ↓
      </button>
      <button type="button" className={styles.small} onClick={onRemove} aria-label={`${labels.remove} ${index + 1}`}>
        ✕
      </button>
    </div>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}
