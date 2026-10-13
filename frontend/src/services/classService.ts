import { httpClient, type HttpClient } from "./httpClient";

export interface ClassGroup {
  id: string;
  teacherId: string;
  name: string;
  courseCode: string;
  semester: string;
  /** Short presentation of the class (SPEC-041). */
  summary?: string;
  /** Filtered HTML (SPEC-041 RN-02). */
  syllabus?: string;
  /** Filtered HTML (SPEC-041 RN-02). */
  institutionalGuidelines?: string;
  startDate: string;
  endDate: string;
  scheduleDescription?: string;
  color?: string;
  enableVirtualClassroom: boolean;
  enableInviteLink: boolean;
  inviteLinkToken?: string;
  inviteLinkStart?: string;
  inviteLinkEnd?: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  archiveReason?: string;
  isExpiringSoon: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSummary extends ClassGroup {
  totalActiveStudents: number;
  totalPendingRequests: number;
}

export interface ListClassesResult {
  items: ClassSummary[];
  totalCount: number;
  page: number;
  limit: number;
}

export interface CreateClassPayload {
  name: string;
  courseCode: string;
  semester: string;
  summary?: string;
  syllabus?: string;
  institutionalGuidelines?: string;
  startDate: string;
  endDate: string;
  scheduleDescription?: string;
  color?: string;
  enableVirtualClassroom?: boolean;
  enableInviteLink?: boolean;
  inviteLinkStart?: string;
  inviteLinkEnd?: string;
  initialStudentIds?: string[];
}

export interface UpdateClassPayload {
  name?: string;
  summary?: string;
  syllabus?: string;
  institutionalGuidelines?: string;
  startDate?: string;
  endDate?: string;
  scheduleDescription?: string;
  color?: string;
  enableVirtualClassroom?: boolean;
  enableInviteLink?: boolean;
  inviteLinkStart?: string;
  inviteLinkEnd?: string;
}

export interface JoinResult {
  enrollmentId: string;
  className: string;
  status: string;
}

export interface ClassMember {
  id: string;
  classId: string;
  userId: string;
  userName?: string;
  userEmail: string;
  userAcademicId?: string;
  status: "PENDING_MODERATION" | "ACTIVE" | "REJECTED" | "TRANSFERRED" | "UNENROLLED";
  origin: "INVITE_LINK" | "DIRECT_BY_TEACHER" | "CSV_IMPORT";
  requestedAt: string;
  decidedAt?: string;
}

/** A class of the signed-in user, for the account menu (SPEC-026). */
export interface MyClass {
  id: string;
  name: string;
  courseCode: string;
  semester: string;
  relation: "TEACHER" | "STUDENT";
  enrollmentStatus?: "ACTIVE" | "PENDING_MODERATION";
}

export interface MyClassesResult {
  items: MyClass[];
  total: number;
}

/** Why a student of a batch was not enrolled (SPEC-041 RN-05). */
export type EnrollRejectReason = "not-a-student" | "transferred";

/** Result of a batch enrollment (SPEC-041, section 5.1). */
export interface EnrollStudentsResult {
  enrolled: string[];
  alreadyEnrolled: string[];
  rejected: Array<{ studentId: string; reason: EnrollRejectReason }>;
}

/** What an enrolled student reads of a class (SPEC-041, section 5.2). */
export interface StudentClass {
  id: string;
  name: string;
  courseCode: string;
  semester: string;
  status: ClassGroup["status"];
  summary: string;
  syllabus: string;
  institutionalGuidelines: string;
  startDate: string;
  endDate: string;
  scheduleDescription: string;
  enableVirtualClassroom: boolean;
  teacherName?: string;
}

/** Class management API client (SPEC-009). */
export function createClassService(client: HttpClient = httpClient) {
  return {
    listClasses: (params?: { page?: number; limit?: number; status?: string; search?: string }) => {
      const query = new URLSearchParams();
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.status) query.set("status", params.status);
      if (params?.search) query.set("search", params.search);
      const qs = query.toString();
      return client.get<ListClassesResult>(`/classes${qs ? `?${qs}` : ""}`);
    },
    myClasses: () => client.get<MyClassesResult>("/me/classes"),
    getMyClass: (id: string) => client.get<StudentClass>(`/me/classes/${id}`),
    enrollStudents: (classId: string, studentIds: string[]) =>
      client.post<EnrollStudentsResult>(`/classes/${classId}/enrollments`, { studentIds }),
    getClass: (id: string) => client.get<ClassGroup>(`/classes/${id}`),
    createClass: (payload: CreateClassPayload) => client.post<ClassGroup>("/classes", payload),
    updateClass: (id: string, payload: UpdateClassPayload) => client.patch<ClassGroup>(`/classes/${id}`, payload),
    archiveClass: (id: string, reason: string) => client.post<ClassGroup>(`/classes/${id}/archive`, { reason }),
    joinByToken: (token: string) => client.post<JoinResult>(`/classes/join/${token}`),
    listMembers: (classId: string, status?: string) => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : "";
      return client.get<ClassMember[]>(`/classes/${classId}/members${qs}`);
    },
    moderateMember: (classId: string, memberId: string, approve: boolean, rejectionReason?: string) =>
      client.post<{ id: string; status: string }>(`/classes/${classId}/members/${memberId}/moderate`, {
        approve,
        rejectionReason,
      }),
  };
}

export type ClassService = ReturnType<typeof createClassService>;
export const classService = createClassService();
