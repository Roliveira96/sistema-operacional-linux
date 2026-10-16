import type { MaterialKind } from "@/services/scheduleService";

const PATHS: Record<MaterialKind, string[]> = {
  // a screen on a stand
  SLIDES: ["M2 3h20", "M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3", "m7 21 5-5 5 5"],
  // a clipboard with a list
  EXERCISES: ["M8 2h8v4H8z", "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2", "M12 11h4", "M12 16h4", "M8 11h.01", "M8 16h.01"],
  // a check in a circle
  EXERCISE_SOLUTION: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "m9 11 3 3L22 4"],
  // a bookmark
  REFERENCE: ["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"],
};

/** The icon of the kind of a material. It only decorates: the kind is always written beside it. */
export function MaterialIcon({ kind, className }: { kind: MaterialKind; className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
