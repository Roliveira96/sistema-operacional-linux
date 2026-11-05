import { messages } from "@/messages/pt-BR";
import { ApiProblemError, httpClient, NetworkError, type HttpClient } from "./httpClient";

const m = messages.assessments;

export type AssessmentType = "EXAM" | "ASSIGNMENT";
export type AssessmentStatus = "SCHEDULED" | "CANCELED";
export type AssessmentPhase = "UPCOMING" | "RUNNING" | "ENDED";
export type Composition = "MANUAL" | "DRAW";
export type Audience = "ALL_CLASS" | "SELECTED";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type Modality = "IN_PERSON" | "ONLINE";
export type ClearanceStatus = "PENDING" | "APPROVED" | "REJECTED";

/** What every reader of an assessment gets (SPEC-075, section 5.1); the times are ISO 8601 in Brasília. */
export interface AssessmentBase {
  id: string;
  classId: string;
  classSessionId?: string;
  title: string;
  description: string;
  type: AssessmentType;
  status: AssessmentStatus;
  phase: AssessmentPhase;
  startsAt: string;
  endsAt: string;
  durationMinutes?: number;
  maxScore: number;
  cancelReason?: string;
}

/** What the student reads: only this, never a question, an answer, a weight or a note (RN-09). serverNow is the clock of the countdown. */
export interface AssessmentPublic extends AssessmentBase {
  serverNow: string;
}

/** An assessment of the calendar; the teacher also gets the count and the composition. */
export interface CalendarAssessment extends AssessmentBase {
  eligibleStudents?: number;
  composition?: Composition;
}

export interface ClearanceCounts {
  pending: number;
  approved: number;
  rejected: number;
}

/** What the teacher and the administrator read in the list. */
export interface AssessmentSummary extends AssessmentBase {
  moduleId: string;
  moduleTitle: string;
  composition: Composition;
  audience: Audience;
  modality: Modality;
  requiresClearance: boolean;
  clearanceCounts: ClearanceCounts;
  eligibleStudents: number;
  totalQuestions: number;
  frozen: boolean;
  teacherPrivateNotes: string | null;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
  canceledBy?: string;
  canceledAt?: string;
  /** The start of an in-person exam by the teacher, which opens the clearance of the students; absent until she starts it (SPEC-083). */
  startedAt?: string;
  startedBy?: string;
  startedByName?: string;
  /** The teacher finished the whole exam (SPEC-096 RN-04). */
  finishedAt?: string;
  finishedByName?: string;
}

export interface AssessmentItem {
  questionId: string;
  position: number;
  weight: number;
  title: string;
  kind: string;
  difficulty: Difficulty;
}

export interface DrawRule {
  difficulty: Difficulty;
  quantity: number;
  pointsPerQuestion: number;
}

export interface AssessmentStudent {
  studentId: string;
  name: string;
  academicId: string;
}

export interface AssessmentEvent {
  kind: "CREATED" | "UPDATED" | "RESCHEDULED" | "CANCELED" | "CLEARANCE_UPDATED" | "STARTED";
  actorName: string;
  createdAt: string;
  reason?: string;
  oldStartsAt?: string;
  oldEndsAt?: string;
  newStartsAt?: string;
  newEndsAt?: string;
  changedFields?: string[];
}

export interface AssessmentDetail extends AssessmentSummary {
  items: AssessmentItem[];
  drawRules: DrawRule[];
  students: AssessmentStudent[];
  events: AssessmentEvent[];
  serverNow: string;
}

/** A question of the bank that may enter the assessment, and one that was chosen with its weight. */
export interface EligibleQuestion {
  questionId: string;
  title: string;
  kind: string;
  difficulty: Difficulty;
}
export interface PickedQuestion extends EligibleQuestion {
  weight: number;
}
export type Stock = Partial<Record<Difficulty, number>>;
/** The exercises of the bank of the module that cannot enter the assessment, by reason (SPEC-088 RN-01): not published, or published without the link to the assessment. */
export interface ExcludedQuestions {
  unpublished: number;
  unlinked: number;
}
export interface EligibleQuestions {
  items: EligibleQuestion[];
  total: number;
  stock: Stock;
  excluded: ExcludedQuestions;
}
export interface QuestionQuery {
  moduleId: string;
  difficulty?: Difficulty;
  kind?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** What the student receives of a question, without the answer; only the fields of its kind come (SPEC-081 section 5). */
export interface StudentView {
  choices?: { id: string; html: string }[];
  columns?: { left: { id: string; text: string }[]; right: { id: string; text: string }[] };
  /** The alternatives or the columns are shown in a different order each time unless this is false. */
  shuffle?: boolean;
  maxLength?: number;
}

/** A question of the preview, with what only the teacher reads. */
export interface PreviewContent {
  questionId: string;
  title: string;
  kind: string;
  difficulty: Difficulty;
  statement: string;
  answerKey: string;
  explanation: string;
  studentView: StudentView;
}
export interface PreviewQuestion extends PreviewContent {
  position: number;
  weight: number;
}
export interface PreviewData {
  questions: PreviewQuestion[];
  rules?: DrawRule[];
  stock?: Stock;
  sample?: PreviewContent[];
}

export interface AssessmentInput {
  classSessionId?: string;
  moduleId: string;
  title: string;
  description?: string;
  type: AssessmentType;
  maxScore: number;
  durationMinutes?: number;
  startsAt: string;
  endsAt: string;
  composition: Composition;
  items?: { questionId: string; weight: number }[];
  draw?: { total: number; rules: DrawRule[] };
  audience?: Audience;
  studentIds?: string[];
  teacherPrivateNotes?: string;
  /** Without it the server chooses by the type: an exam is in person, an assignment is online (SPEC-076 RN-01). */
  modality?: Modality;
}

/** The situation of an attempt (SPEC-090 D-02). */
export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "TIME_EXPIRED" | "ENDED_BY_TEACHER";

/** What the student sees of a question of the attempt, frozen when they entered (SPEC-090 RN-02). */
export interface AttemptStudentView {
  title: string;
  statement: string;
  choices?: { id: string; html: string }[];
  columns?: { left: { id: string; text: string }[]; right: { id: string; text: string }[] };
  shuffle?: boolean;
  maxLength?: number;
  /** The machine a practical question starts from; none is the default machine. */
  scenario?: unknown;
}

/** A question of the attempt: never the key nor the points (SPEC-090 RN-10). */
export interface AttemptItem {
  position: number;
  kind: string;
  weight: number;
  studentView: AttemptStudentView;
  answer?: unknown;
  /** Only in a practical question: whether the last check gave it as solved. */
  checkedSolved?: boolean;
}

/** A question of the attempt as the teacher reads it in the room (SPEC-095): the title and, in the objective ones, the key; never the machine. */
export interface TeacherAttemptItem extends AttemptItem {
  title: string;
  answerKey?: unknown;
}

/** The attempt of one student as the teacher reads it in the room (SPEC-095 section 5). */
export interface TeacherAttempt {
  attemptId: string;
  studentId: string;
  studentName: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt?: string;
  serverNow: string;
  items: TeacherAttemptItem[];
}

/** The attempt of the student (SPEC-090 section 5). */
export interface StudentAttempt {
  id: string;
  status: AttemptStatus;
  startedAt: string;
  deadlineAt: string;
  submittedAt?: string;
  serverNow: string;
  items: AttemptItem[];
}

/** An attempt in the list of the teacher (SPEC-090 RN-09): the score only after the delivery. */
export interface AttemptRow {
  endedByName?: string;
  endReason?: string;
  /** None for who did not come (SPEC-096 RN-06). */
  attemptId?: string;
  studentId: string;
  studentName: string;
  academicId: string;
  status: AttemptStatus | "ABSENT";
  startedAt?: string;
  submittedAt?: string;
  preliminaryScore?: number;
  pendingItems?: number;
  /** The number of messages of the conversation (SPEC-093 RN-07). */
  chatCount?: number;
  /** The correction of the teacher (SPEC-097 section 5). */
  reviewed?: boolean;
  finalScore?: number;
}

/** A command of a practical question, in the correction (SPEC-097). */
export interface ReviewCommand {
  position: number;
  command: string;
  output: string;
  executedAt: string;
}

/** A question of the attempt in the correction (SPEC-097 section 5): the automatic points, the adjustment, the expected answer and the commands. */
export interface ReviewItem extends TeacherAttemptItem {
  points?: number;
  adjustedPoints?: number;
  adjustReason?: string;
  expectedAnswer?: string;
  commands: ReviewCommand[];
}

/** The delivered attempt of one student as the teacher corrects it (SPEC-097 section 5). */
export interface Review {
  attemptId: string;
  studentId: string;
  studentName: string;
  academicId: string;
  status: AttemptStatus;
  startedAt: string;
  submittedAt?: string;
  preliminaryScore?: number;
  pendingItems?: number;
  endedByName?: string;
  endReason?: string;
  score: number;
  reviewed: boolean;
  finalScore?: number;
  teacherNote: string;
  studentNote: string;
  items: ReviewItem[];
  helps: HelpItem[];
  serverNow: string;
}

/** A message of the conversation of the exam (SPEC-093 section 5): studentId is the owner of a private conversation; senderName only in the record. */
export interface ExamChatMessage {
  id: string;
  scope: "private" | "all";
  studentId?: string;
  from: "TEACHER" | "STUDENT";
  position?: number;
  text: string;
  createdAt: string;
  senderName?: string;
}

/** A student in the room of the exam (SPEC-091 RN-04): ABSENT until there is an attempt; online and waiting come from the realtime. */
export interface RoomCard {
  studentId: string;
  name: string;
  academicId: string;
  status: "ABSENT" | AttemptStatus;
  online: boolean;
  waiting: boolean;
  answered: number;
  total: number;
  solved: number;
  deadlineAt?: string;
  attemptId?: string;
  help?: HelpItem;
  /** The question the student is in, as she told the room (SPEC-092 revision 2). */
  question?: { position: number; title: string };
  /** Online and waiting after the start: she asks to enter, and the teacher admits her (SPEC-096 RN-02). */
  requesting?: boolean;
}

/** The exam the teacher finished (SPEC-096 section 5). */
export interface FinishResult {
  finishedAt: string;
  finishedBy: string;
  finishedByName: string;
  ended: number;
  absent: number;
}

/** A request for help (SPEC-091 RN-07). */
export interface HelpItem {
  id: string;
  studentId: string;
  position?: number;
  question: string;
  status: "OPEN" | "ANSWERED" | "CANCELED";
  createdAt: string;
  answer?: string;
}

/** A command the student ran in the exam (SPEC-091 RN-06). */
export interface RoomCommand {
  position: number;
  command: string;
  output: string;
  executedAt: string;
}

/** A message of the room: a type and its data. */
export interface RoomMessage {
  type: string;
  data: unknown;
}

export interface RoomHandlers {
  onOpen(): void;
  onMessage(message: RoomMessage): void;
  onClose(): void;
}

export interface RoomSocket {
  send(type: string, data: unknown): void;
  close(): void;
}

/** What the student reads about their own access, and about no one else's (RN-09, RN-10). */
export interface MyAccess {
  allowed: boolean;
  reason: "ALLOWED" | "CANCELED" | "NOT_OPEN_YET" | "ENDED" | "NOT_STARTED";
  modality: Modality;
  serverNow: string;
}

/** What may change by the PATCH: the dates and the notes have routes of their own (RN-11, RN-13). */
export type AssessmentPatch = Partial<Omit<AssessmentInput, "startsAt" | "endsAt" | "classSessionId" | "teacherPrivateNotes">>;

export interface RescheduleInput {
  startsAt: string;
  endsAt: string;
  reason?: string;
}

type Now<T> = T & { serverNow: string };

/** API client of the assessments of a class (SPEC-075, section 5.2). */
export function createAssessmentService(client: HttpClient = httpClient) {
  const base = (classId: string) => `/classes/${classId}/assessments`;
  return {
    /** The list brings the clock of the server once, outside the items; the student gets the public form of each. */
    list: (classId: string, filter: { phase?: AssessmentPhase; status?: AssessmentStatus } = {}) => {
      const query = new URLSearchParams();
      if (filter.phase) query.set("phase", filter.phase);
      if (filter.status) query.set("status", filter.status);
      const qs = query.toString();
      return client.get<{ items: Array<AssessmentSummary | AssessmentBase>; serverNow: string }>(`${base(classId)}${qs ? `?${qs}` : ""}`);
    },
    /** The detail for the teacher, the public form for the student: the server decides by who asks. */
    get: (classId: string, id: string) => client.get<AssessmentDetail | AssessmentPublic>(`${base(classId)}/${id}`),
    create: (classId: string, input: AssessmentInput) => client.post<Now<AssessmentSummary>>(base(classId), input),
    update: (classId: string, id: string, patch: AssessmentPatch) => client.patch<Now<AssessmentSummary>>(`${base(classId)}/${id}`, patch),
    reschedule: (classId: string, id: string, input: RescheduleInput) => client.put<Now<AssessmentSummary>>(`${base(classId)}/${id}/schedule`, input),
    cancel: (classId: string, id: string, reason: string) => client.post<Now<AssessmentSummary>>(`${base(classId)}/${id}/cancel`, { reason }),
    /** Starts an in-person exam that is running: from then on the teacher clears the students (SPEC-083). It has no body and cannot be undone. */
    start: (classId: string, id: string) => client.post<Now<AssessmentSummary>>(`${base(classId)}/${id}/start`),
    /** The machine a question of the assessment starts from, for the terminal of the simulator; null when it has none of its own (SPEC-084 RN-01). */
    questionScenario: async (classId: string, id: string, questionId: string) =>
      (await client.get<{ questionId: string; snapshot?: unknown }>(`${base(classId)}/${id}/questions/${encodeURIComponent(questionId)}/scenario`)).snapshot ?? null,
    /** Whether the machine meets the conditions of a question of command Linux of the assessment: the server corrects, says only yes or no and stores nothing (SPEC-085). */
    checkQuestion: async (classId: string, id: string, questionId: string, snapshot: unknown) =>
      (await client.post<{ passed: boolean }>(`${base(classId)}/${id}/questions/${encodeURIComponent(questionId)}/check`, { snapshot })).passed,
    saveNotes: async (classId: string, id: string, notes: string) =>
      (await client.put<{ teacherPrivateNotes: string }>(`${base(classId)}/${id}/private-notes`, { teacherPrivateNotes: notes })).teacherPrivateNotes,
    preview: (classId: string, id: string) => client.get<PreviewData>(`${base(classId)}/${id}/preview`),
    /** The own access of the student: whether they may enter, why and the modality (SPEC-091 RN-03: no clearance). */
    myAccess: (classId: string, id: string) => client.get<MyAccess>(`${base(classId)}/${id}/my-access`),
    /** The student enters the exam: the first time creates the attempt, the next ones give the same back (SPEC-090 RN-01). */
    enterAttempt: (classId: string, id: string) => client.post<StudentAttempt>(`${base(classId)}/${id}/attempt`),
    /** The own attempt of the student; 404 attempt-not-found when there is none. */
    myAttempt: (classId: string, id: string) => client.get<StudentAttempt>(`${base(classId)}/${id}/attempt`),
    /** Saves the answer of a question, replacing the one before (SPEC-090 RN-04). */
    saveAnswer: (classId: string, id: string, position: number, answer: unknown) => client.put<void>(`${base(classId)}/${id}/attempt/items/${position}`, { answer }),
    /** Checks the machine of a practical question against its key and says whether it is solved (SPEC-090 RN-05). */
    checkAnswer: async (classId: string, id: string, position: number, snapshot: unknown) =>
      (await client.post<{ solved: boolean }>(`${base(classId)}/${id}/attempt/items/${position}/check`, { snapshot })).solved,
    /** Delivers the attempt (SPEC-090 RN-06). */
    submitAttempt: (classId: string, id: string) => client.post<StudentAttempt>(`${base(classId)}/${id}/attempt/submit`),
    /** The attempts of the exam, for the teacher and the administrator (SPEC-090 RN-09). */
    attemptForTeacher: (classId: string, id: string, attemptId: string) => client.get<TeacherAttempt>(`${base(classId)}/${id}/attempts/${attemptId}`),
    review: (classId: string, id: string, attemptId: string) => client.get<Review>(`${base(classId)}/${id}/attempts/${attemptId}/review`),
    attempts: (classId: string, id: string) => client.get<{ items: AttemptRow[]; serverNow: string }>(`${base(classId)}/${id}/attempts`),
    /** The whole conversation of an attempt, for the teacher and the administrator (SPEC-093 RN-07). */
    attemptChat: (classId: string, id: string, attemptId: string) =>
      client.get<{ messages: ExamChatMessage[] }>(`${base(classId)}/${id}/attempts/${attemptId}/chat`),
    /** Ends the exam of a student, with the reason (SPEC-091 RN-08). */
    admit: (classId: string, id: string, studentIds: string[]) => client.post<{ admitted: string[] }>(`${base(classId)}/${id}/admissions`, { studentIds }),
    finish: (classId: string, id: string) => client.post<FinishResult>(`${base(classId)}/${id}/finish`),
    endAttempt: (classId: string, id: string, attemptId: string, reason: string) => client.post<AttemptRow>(`${base(classId)}/${id}/attempts/${attemptId}/end`, { reason }),
    /** Opens the room of the exam on the same origin, under /api/v1 (SPEC-091 section 5). A message that is not JSON is ignored. */
    openRoom: (classId: string, id: string, handlers: RoomHandlers, create: (url: string) => WebSocket = (url) => new WebSocket(url)): RoomSocket => {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = create(`${scheme}//${window.location.host}/api/v1${base(classId)}/${id}/room/ws`);
      socket.onopen = () => handlers.onOpen();
      socket.onclose = () => handlers.onClose();
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as RoomMessage;
          if (typeof message.type === "string") handlers.onMessage(message);
        } catch {
          /* not a message of the room */
        }
      };
      return {
        send(type, data) {
          if (socket.readyState === 1) socket.send(JSON.stringify({ type, data }));
        },
        close: () => socket.close(),
      };
    },
    /** The questions that may enter and the stock of each level, for the form (RN-05, RN-07). */
    eligibleQuestions: (classId: string, query: QuestionQuery) => {
      const qs = new URLSearchParams({ moduleId: query.moduleId });
      for (const key of ["difficulty", "kind", "q", "page", "pageSize"] as const) {
        const value = query[key];
        if (value !== undefined && value !== "") qs.set(key, String(value));
      }
      return client.get<EligibleQuestions>(`/classes/${classId}/assessment-questions?${qs}`);
    },
  };
}

export type AssessmentService = ReturnType<typeof createAssessmentService>;
export const assessmentService = createAssessmentService();

/** Translates an error of the assessment routes into the sentence the teacher reads. */
export function describeAssessmentError(error: unknown): string {
  if (error instanceof NetworkError) return m.networkError;
  if (error instanceof ApiProblemError) {
    if (error.type === "insufficient-stock") {
      const shortages = Array.isArray(error.extensions.shortages) ? (error.extensions.shortages as { difficulty: string; asked: number; available: number }[]) : [];
      const levels = shortages.map((s) => m.stockLevel((m.difficulty[s.difficulty] ?? s.difficulty).toLowerCase(), s.asked, s.available));
      if (levels.length) return m.stockError(levels.join("; "));
    }
    const text = m.errors[error.type];
    if (text) return text;
  }
  return m.unexpectedError;
}
