"use client";

import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { TopicStudy } from "@/components/TopicStudy/TopicStudy";

/** Study screen of a module inside the signed-in area (SPEC-016). */
export default function ModuleReadingPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div style={{ "--topic-offset": "5.5rem" } as CSSProperties}>
      <TopicStudy moduleId={id} backHref="/app/modules" />
    </div>
  );
}
