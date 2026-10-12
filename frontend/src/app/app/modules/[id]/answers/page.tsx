"use client";

import { useParams } from "next/navigation";
import { AnswerGrading } from "@/components/AnswerGrading/AnswerGrading";

/** The correction of the descriptive answers of the module (SPEC-039). */
export default function ModuleAnswersPage() {
  const { id } = useParams<{ id: string }>();
  return <AnswerGrading moduleId={id} />;
}
