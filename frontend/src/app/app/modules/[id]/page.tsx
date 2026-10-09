"use client";

import { useParams } from "next/navigation";
import { TopicScreen } from "@/components/TopicScreen/TopicScreen";

/** Study page of a module inside the signed-in area (SPEC-016). */
export default function ModuleReadingPage() {
  const { id } = useParams<{ id: string }>();
  return <TopicScreen moduleId={id} backHref="/app/modules" />;
}
