"use client";

import { PresenterStage } from "@/components/Classroom/PresenterStage/PresenterStage";
import { LiveGate } from "../LiveGate";

/** The presentation window of the live class: the stage alone, for the teacher to drag to the projector (SPEC-055). */
export default function PresentPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  return (
    <LiveGate params={params} teacherOnly>
      {({ classId, session }) => <PresenterStage classId={classId} session={session} />}
    </LiveGate>
  );
}
