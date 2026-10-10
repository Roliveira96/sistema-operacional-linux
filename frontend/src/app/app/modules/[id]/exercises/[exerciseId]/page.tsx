"use client";

import { useParams } from "next/navigation";
import { ModuleExerciseScreen } from "@/components/ModuleExercises/ModuleExerciseScreen";

/** Edits one exercise of the bank of the module; `exerciseId` is its id, or "new" (SPEC-023). */
export default function EditModuleExercisePage() {
  const { id, exerciseId } = useParams<{ id: string; exerciseId: string }>();
  return <ModuleExerciseScreen moduleId={id} exerciseId={exerciseId} />;
}
