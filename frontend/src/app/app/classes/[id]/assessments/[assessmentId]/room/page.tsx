"use client";

import { useRouter } from "next/navigation";
import { ExamRoom } from "@/components/ExamRoom/ExamRoom";
import { TeacherWindow } from "@/components/ExamRoom/TeacherWindow";

/** The room of the exam (SPEC-091): the window of the teacher and of the administrator; a student goes back to the assessment. */
export default function RoomPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const router = useRouter();
  return (
    <TeacherWindow params={params}>
      {(classId, assessment) => (
        // once finished, the room has nothing more to do: the teacher goes to the detail, with the summary (SPEC-096 section 3.1)
        <ExamRoom classId={classId} assessment={assessment} onFinished={() => router.push(`/app/classes/${classId}/assessments/${assessment.id}`)} />
      )}
    </TeacherWindow>
  );
}
