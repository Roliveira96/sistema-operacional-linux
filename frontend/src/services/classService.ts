import { httpClient, type HttpClient } from "./httpClient";

export interface ClassGroup {
  id: string;
  teacherId: string;
  name: string;
  courseCode: string;
  semester: string;
  syllabus?: string;
  institutionalGuidelines?: string;
  startDate: string;
  endDate: string;
  scheduleDescription?: string;
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
  syllabus?: string;
  institutionalGuidelines?: string;
  startDate: string;
  endDate: string;
  scheduleDescription?: string;
  enableVirtualClassroom?: boolean;
  enableInviteLink?: boolean;
  inviteLinkStart?: string;
  inviteLinkEnd?: string;
  initialStudentIds?: string[];
}

export interface UpdateClassPayload {
  name?: string;
  syllabus?: string;
  institutionalGuidelines?: string;
  startDate?: string;
  endDate?: string;
  scheduleDescription?: string;
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
