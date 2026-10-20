import { messages } from "@/messages/pt-BR";
import type { MaterialKind, MaterialVisibility } from "@/services/scheduleService";

const m = messages.schedule.materials;

/** The phases in the order the areas of the dialog and the groups of the diary are drawn (SPEC-074 CA-10). */
export const PHASES: MaterialVisibility[] = ["ALWAYS", "DURING_CLASS", "DURING_AND_AFTER", "AFTER_CLASS"];

export const KINDS: MaterialKind[] = ["SLIDES", "EXERCISES", "EXERCISE_SOLUTION", "REFERENCE"];

/** What a material is until the teacher says otherwise: the phase where it was dropped suggests it. */
export const START_KIND: Record<MaterialVisibility, MaterialKind> = {
  ALWAYS: "SLIDES",
  DURING_CLASS: "EXERCISES",
  DURING_AND_AFTER: "EXERCISES",
  AFTER_CLASS: "EXERCISE_SOLUTION",
};

/** "2,0 MB", "300 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The site of a link, for the line under its title. */
export function siteOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

// The schedule runs in the time zone of the school, which has had no summer time since 2019 (SPEC-042 RN-13).
const SCHOOL_ZONE = "America/Sao_Paulo";
const SCHOOL_OFFSET = "-03:00";

function partsOf(iso: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: SCHOOL_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(
    new Date(iso),
  );
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The value of an `<input type="datetime-local">` for an instant, as the school reads the clock; empty when there is none. */
export function toInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = partsOf(iso);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The instant of a value of `<input type="datetime-local">`, read in the time zone of the school. */
export function fromInputValue(value: string): string {
  return `${value}:00${SCHOOL_OFFSET}`;
}

/** Why a material is hidden, as the teacher is told: the reason, or "Oculto até 19/10 11:00" for a release. */
export function hiddenText(until: string): string {
  if (until in m.hidden && until !== "at") return m.hidden[until as "CLASS_START" | "CLASS_END" | "CLASS_OVER" | "CLASS_CANCELED"];
  const p = partsOf(until);
  return m.hidden.at(`${p.day}/${p.month} ${p.hour}:${p.minute}`);
}
