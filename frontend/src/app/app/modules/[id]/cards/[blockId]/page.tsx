"use client";

import { useParams } from "next/navigation";
import { CardScreen } from "@/components/CardBuilder/CardScreen";

/** Edits one card of the module; `blockId` is the id of the card's first block (SPEC-019). */
export default function EditCardPage() {
  const { id, blockId } = useParams<{ id: string; blockId: string }>();
  return <CardScreen moduleId={id} cardKey={blockId} />;
}
