"use client";

import { useParams } from "next/navigation";
import { TopicScreen } from "@/components/TopicScreen/TopicScreen";

/** Public study page of a module: the topic screen of the prototype (SPEC-016). */
export default function MaterialPage() {
  const { id } = useParams<{ id: string }>();
  return <TopicScreen moduleId={id} backHref="/materials" />;
}
