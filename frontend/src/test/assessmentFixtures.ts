import type {
  AssessmentBase,
  AssessmentDetail,
  AssessmentPublic,
  AssessmentSummary,
  CalendarAssessment,
  ClearanceItem,
  ClearanceList,
  EligibleQuestions,
  MyAccess,
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
  modality: "IN_PERSON",
  requiresClearance: true,
  clearanceCounts: { pending: 0, approved: 32, rejected: 0 },
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

/** The students of an in-person exam that requires the clearance, as the teacher reads them (SPEC-076 section 5). */
export const clearanceItems = (): ClearanceItem[] => [
  { studentId: "s-1", name: "Ana Souza", academicId: "1000001", status: "PENDING" },
  { studentId: "s-2", name: "Bruno Lima", academicId: "1000002", status: "APPROVED", clearedAt: "2026-10-21T09:30:00-03:00", clearedByName: "Profa. Sediane" },
  {
    studentId: "s-3",
    name: "Carla Dias",
    academicId: "1000003",
    status: "REJECTED",
    rejectionReason: "Reprovada por faltas",
    clearedAt: "2026-10-21T09:31:00-03:00",
    clearedByName: "Profa. Sediane",
  },
  { studentId: "s-4", name: "Davi Alves", academicId: "1000004", status: "REJECTED", clearedAt: "2026-10-21T09:32:00-03:00", clearedByName: "Profa. Sediane" },
];

export const clearanceList = (over: Partial<ClearanceList> = {}): ClearanceList => ({
  requiresClearance: true,
  items: clearanceItems(),
  counts: { pending: 1, approved: 1, rejected: 2 },
  serverNow: SERVER_NOW,
  ...over,
});

/** What the student reads about their own access (SPEC-076 RN-09). */
export const myAccess = (over: Partial<MyAccess> = {}): MyAccess => ({
  allowed: false,
  reason: "NOT_OPEN_YET",
  modality: "IN_PERSON",
  requiresClearance: true,
  clearance: { status: "PENDING" },
  serverNow: SERVER_NOW,
  ...over,
});
