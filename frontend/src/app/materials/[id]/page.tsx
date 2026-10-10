"use client";

import { useParams } from "next/navigation";
import { TopicStudy } from "@/components/TopicStudy/TopicStudy";

/** Study screen of a public module: material on the left, terminal on the right (SPEC-016). */
export default function MaterialPage() {
  const { id } = useParams<{ id: string }>();
  return <TopicStudy moduleId={id} backHref="/materials" />;
}
