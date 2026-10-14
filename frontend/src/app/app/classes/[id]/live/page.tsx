"use client";

import { LiveClassroom } from "@/components/Classroom/LiveClassroom/LiveClassroom";
import { TeacherPanel } from "@/components/Classroom/TeacherPanel/TeacherPanel";
import { LiveGate } from "./LiveGate";

/** The live classroom of a class: the panel for the teacher, the room for the enrolled student (SPEC-051, SPEC-055). */
export default function LivePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  return (
    <LiveGate params={params}>
      {({ classId, userId, isStudent, session }) =>
        isStudent ? <LiveClassroom classId={classId} userId={userId} session={session} /> : <TeacherPanel classId={classId} session={session} />
      }
    </LiveGate>
  );
}
