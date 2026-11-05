"use client";

import { ExamReview } from "@/components/ExamReview/ExamReview";
import { TeacherWindow } from "@/components/ExamRoom/TeacherWindow";

/** The correction of the exam (SPEC-097): the window of the teacher and of the administrator; a student goes back to the assessment. */
export default function ReviewPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  return <TeacherWindow params={params}>{(classId, assessment) => <ExamReview classId={classId} assessment={assessment} />}</TeacherWindow>;
}
