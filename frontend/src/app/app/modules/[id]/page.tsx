"use client";

import { useParams } from "next/navigation";
import { ModuleContentView } from "@/components/ModuleContentView/ModuleContentView";

/** Reading page of a module inside the signed-in area (SPEC-012). */
export default function ModuleReadingPage() {
  const { id } = useParams<{ id: string }>();
  return <ModuleContentView moduleId={id} backHref="/app/modules" />;
}
