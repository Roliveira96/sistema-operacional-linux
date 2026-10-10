"use client";

import { useParams, useSearchParams } from "next/navigation";
import type { CSSProperties } from "react";
import { TopicStudy } from "@/components/TopicStudy/TopicStudy";

/** Study screen of a module inside the signed-in area (SPEC-016). */
export default function ModuleReadingPage() {
  const { id } = useParams<{ id: string }>();
  // The authors open the version being edited with ?draft=1 (SPEC-021).
  const draft = useSearchParams().get("draft") === "1";
  return (
    <div style={{ "--topic-offset": "5.5rem" } as CSSProperties}>
      <TopicStudy moduleId={id} backHref="/app/modules" draft={draft} />
    </div>
  );
}
