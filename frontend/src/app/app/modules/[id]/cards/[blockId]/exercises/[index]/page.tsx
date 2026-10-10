"use client";

import { useParams } from "next/navigation";
import { ExerciseScreen } from "@/components/ExerciseForm/ExerciseScreen";

/** Edits one exercise of a card; `index` is its position in the group, or "new" (SPEC-022). */
export default function EditExercisePage() {
  const { id, blockId, index } = useParams<{ id: string; blockId: string; index: string }>();
  return <ExerciseScreen moduleId={id} cardKey={blockId} index={index} />;
}
