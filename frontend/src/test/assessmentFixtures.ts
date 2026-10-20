import type {
  AssessmentBase,
  AssessmentDetail,
  AssessmentPublic,
  AssessmentSummary,
  CalendarAssessment,
  EligibleQuestions,
  PreviewData,
} from "@/services/assessmentService";

/** The clock of the server in the assessment tests: Wednesday, October 21st 2026, 10:00 in Brasília. */
export const SERVER_NOW = "2026-10-21T10:00:00-03:00";

const base = (over: Partial<AssessmentBase> = {}): AssessmentBase => ({
  id: "a-1",
  classId: "c-1",
  title: "Prova 1: permissões",
  description: "Traga o documento com foto.",
  type: "EXAM",
  status: "SCHEDULED",
  phase: "UPCOMING",
  startsAt: "2026-10-23T09:00:00-03:00",
  endsAt: "2026-10-23T11:00:00-03:00",
  durationMinutes: 60,
  maxScore: 10,
  ...over,
});

/** What the teacher reads in the list (SPEC-075, section 5.1). */
export const summary = (over: Partial<AssessmentSummary> = {}): AssessmentSummary => ({
  ...base(),
  moduleId: "mod-1",
  moduleTitle: "Permissões de arquivos",
  composition: "MANUAL",
  audience: "ALL_CLASS",
  eligibleStudents: 32,
  totalQuestions: 3,
  frozen: false,
  teacherPrivateNotes: null,
  createdBy: "u-1",
  createdByName: "Profa. Sediane",
  updatedBy: "u-1",
  updatedByName: "Profa. Sediane",
  updatedAt: "2026-10-20T16:00:00-03:00",
  ...over,
});

export const detail = (over: Partial<AssessmentDetail> = {}): AssessmentDetail => ({
  ...summary(),
  serverNow: SERVER_NOW,
  items: [
    { questionId: "q-1", position: 1, weight: 3.34, title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY" },
    { questionId: "q-2", position: 2, weight: 3.33, title: "Apagar a pasta", kind: "PRACTICAL", difficulty: "EASY" },
    { questionId: "q-3", position: 3, weight: 3.33, title: "Mudar a permissão", kind: "PRACTICAL", difficulty: "MEDIUM" },
  ],
  drawRules: [],
  students: [],
  events: [{ kind: "CREATED", actorName: "Profa. Sediane", createdAt: "2026-10-20T16:00:00-03:00" }],
  ...over,
});

/** What the student reads: the public form only (RN-09). */
export const publicOf = (over: Partial<AssessmentPublic> = {}): AssessmentPublic => ({ ...base(), serverNow: SERVER_NOW, ...over });

/** An assessment of the calendar; the teacher also gets the count and the composition. */
export const calendarAssessment = (over: Partial<CalendarAssessment> = {}): CalendarAssessment => ({ ...base(), ...over });

export const questions = (over: Partial<EligibleQuestions> = {}): EligibleQuestions => ({
  items: [
    { questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY" },
    { questionId: "q-2", title: "Apagar a pasta", kind: "PRACTICAL", difficulty: "EASY" },
    { questionId: "q-3", title: "Mudar a permissão", kind: "PRACTICAL", difficulty: "MEDIUM" },
    { questionId: "q-4", title: "Dono e grupo", kind: "THEORETICAL_SINGLE", difficulty: "HARD" },
  ],
  total: 4,
  stock: { EASY: 2, MEDIUM: 1, HARD: 1 },
  ...over,
});

export const preview = (over: Partial<PreviewData> = {}): PreviewData => ({
  questions: [
    { position: 1, weight: 5, questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", statement: "<p>Crie a pasta <code>/a</code>.</p>", answerKey: '{"steps":[{"command":"mkdir /a"}]}', explanation: "Use mkdir." },
    { position: 2, weight: 5, questionId: "q-4", title: "Dono e grupo", kind: "THEORETICAL_SINGLE", difficulty: "HARD", statement: "<p>Quem é o dono?</p>", answerKey: "B", explanation: "O dono é quem criou." },
  ],
  ...over,
});
