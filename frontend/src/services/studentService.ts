import { httpClient, type HttpClient } from "./httpClient";

export interface StudentSummary {
  id: string;
  academicId: string;
  email: string;
  name: string;
  whatsapp?: string;
  discord?: string;
  avatarUrl?: string;
  totalClassesEnrolled: number;
  createdAt: string;
}

export interface StudentProfileResponse {
  id: string;
  academicId: string;
  email: string;
  name: string;
  whatsapp?: string;
  discord?: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface ManualStudentInput {
  academicId: string;
  email: string;
  name?: string;
  whatsapp?: string;
  discord?: string;
  classGroupId?: string;
}

export interface ManualStudentResponse {
  id: string;
  academicId: string;
  email: string;
  enrollmentStatus: "ACTIVE" | "NOT_ENROLLED" | string;
  createdAt: string;
}

export interface CSVRowError {
  line: number;
  reason: string;
}

export interface CSVImportResult {
  totalRows: number;
  created: number;
  enrolled: number;
  alreadyEnrolled: number;
  errors: CSVRowError[];
}

export interface ListStudentsParams {
  page?: number;
  perPage?: number;
  search?: string;
}

export interface ListStudentsResult {
  items: StudentSummary[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface JoinInviteInput {
  academicId: string;
  email: string;
  name: string;
  password: string;
  whatsapp?: string;
  discord?: string;
}

export interface JoinInviteResponse {
  userId: string;
  accountStatus: "ACTIVE" | string;
  enrollmentStatus: "PENDING_MODERATION" | string;
}

export async function createStudentManual(
  payload: ManualStudentInput,
  client: HttpClient = httpClient
): Promise<ManualStudentResponse> {
  return client.post<ManualStudentResponse>("/students", payload);
}

export async function importStudentsCSV(
  file: File,
  classGroupId?: string,
  client: HttpClient = httpClient
): Promise<CSVImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (classGroupId) {
    formData.append("classGroupId", classGroupId);
  }
  return client.post<CSVImportResult>("/students/import-csv", formData);
}

export async function listStudents(
  params: ListStudentsParams = {},
  client: HttpClient = httpClient
): Promise<ListStudentsResult> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.perPage) query.set("perPage", String(params.perPage));
  if (params.search) query.set("search", params.search);

  const qs = query.toString();
  const path = qs ? `/students?${qs}` : "/students";
  return client.get<ListStudentsResult>(path);
}

export async function getStudentProfile(
  client: HttpClient = httpClient
): Promise<StudentProfileResponse> {
  return client.get<StudentProfileResponse>("/students/me");
}

export async function uploadAvatar(
  file: File,
  client: HttpClient = httpClient
): Promise<{ avatarUrl: string }> {
  const formData = new FormData();
  formData.append("avatar", file);
  return client.patch<{ avatarUrl: string }>("/students/me/avatar", formData);
}

export async function joinByInvite(
  token: string,
  payload: JoinInviteInput,
  client: HttpClient = httpClient
): Promise<JoinInviteResponse> {
  return client.post<JoinInviteResponse>(`/invites/${encodeURIComponent(token)}/join`, payload);
}
