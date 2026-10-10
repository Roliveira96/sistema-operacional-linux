"use client";

import { useParams, useSearchParams } from "next/navigation";
import { CardScreen } from "@/components/CardBuilder/CardScreen";

/** Creates a card of the module, at the end or after the block in `?after=` (SPEC-019). */
export default function NewCardPage() {
  const { id } = useParams<{ id: string }>();
  const after = useSearchParams().get("after") ?? undefined;
  return <CardScreen moduleId={id} afterId={after} />;
}
