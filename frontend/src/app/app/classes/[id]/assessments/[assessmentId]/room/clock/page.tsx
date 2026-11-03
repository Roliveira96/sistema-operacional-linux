"use client";

import { ExamClock } from "@/components/ExamClock/ExamClock";
import { TeacherWindow } from "@/components/ExamRoom/TeacherWindow";

/** The clock of the exam for the class (SPEC-092): a tab of the teacher, made to be projected; a student goes back to the assessment. */
export default function ClockPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  return <TeacherWindow params={params}>{(_classId, assessment) => <ExamClock assessment={assessment} />}</TeacherWindow>;
}
