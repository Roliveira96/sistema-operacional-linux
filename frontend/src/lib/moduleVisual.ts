import type { CSSProperties } from "react";

// Visual metadata of modules loaded from the legacy content (SPEC-012, SPEC-015).

/** Maps the legacy color variable (e.g. "--cor-dir") to the module accent token. */
export function moduleAccent(color?: string): CSSProperties | undefined {
  const key = color?.match(/^--cor-([a-z]+)$/)?.[1];
  return key ? ({ "--module-accent": `var(--color-module-${key})` } as CSSProperties) : undefined;
}

export interface ModuleDescription {
  /** Command or concept tags shown as chips, as in the prototype cards. */
  tags: string[];
  summary: string;
}

/**
 * Splits a legacy description ("ls · cd · mkdir — Summary text") into tags and
 * summary. Descriptions without that shape are returned whole as the summary.
 */
export function splitDescription(description: string): ModuleDescription {
  const separator = description.indexOf(" — ");
  if (separator < 0) return { tags: [], summary: description };
  const head = description.slice(0, separator);
  const summary = description.slice(separator + 3).trim();
  const tags = head
    .split(" · ")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return summary ? { tags, summary } : { tags: [], summary: description };
}

/** Two-digit position label of the prototype cards ("01", "02"). */
export function orderLabel(displayOrder?: number): string | null {
  return displayOrder && displayOrder > 0 ? String(displayOrder).padStart(2, "0") : null;
}

/**
 * Accent variables of a topic screen (SPEC-016): the module color and its tints.
 * Tints are mixed here, on the element, because the accent changes per module.
 */
export function topicAccentVars(color?: string): CSSProperties {
  const key = color?.match(/^--cor-([a-z]+)$/)?.[1];
  return {
    "--accent": key ? `var(--color-module-${key})` : "var(--color-accent)",
    "--accent-soft": "color-mix(in srgb, var(--accent) 18%, transparent)",
    "--accent-faint": "color-mix(in srgb, var(--accent) 8%, transparent)",
    "--accent-line": "color-mix(in srgb, var(--accent) 55%, transparent)",
    "--accent-glow": "color-mix(in srgb, var(--accent) 35%, transparent)",
  } as CSSProperties;
}
