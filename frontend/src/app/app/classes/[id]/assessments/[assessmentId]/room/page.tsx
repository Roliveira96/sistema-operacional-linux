"use client";

import { ExamRoom } from "@/components/ExamRoom/ExamRoom";
import { TeacherWindow } from "@/components/ExamRoom/TeacherWindow";

/** The room of the exam (SPEC-091): the window of the teacher and of the administrator; a student goes back to the assessment. */
export default function RoomPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  return <TeacherWindow params={params}>{(classId, assessment) => <ExamRoom classId={classId} assessment={assessment} />}</TeacherWindow>;
}
