import { httpClient, type HttpClient } from "./httpClient";

export type Visibility = "PUBLIC" | "AUTHENTICATED" | "PRIVATE";
export type ModuleStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface CourseModuleSummary {
  id: string;
  teacherId: string;
  title: string;
  description: string;
  visibility: Visibility;
  status: ModuleStatus;
  activationStart?: string;
  activationEnd?: string;
  totalExercises: number;
  totalMaterials: number;
  isActiveNow: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseItem {
  id: string;
  moduleId: string;
  exerciseId: string;
  sequenceOrder: number;
  isMandatory: boolean;
}

export interface MaterialItem {
  id: string;
  moduleId: string;
  title: string;
  description?: string;
  url: string;
}

export interface CourseModuleDetails extends CourseModuleSummary {
  assignedClassIds: string[];
  exerciseItems: ExerciseItem[];
  materials: MaterialItem[];
}

export interface ListModulesResult {
  items: CourseModuleSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateModulePayload {
  title: string;
  description: string;
  visibility: Visibility;
  activationStart?: string;
  activationEnd?: string;
  classIds?: string[];
}

export interface UpdateModulePayload {
  title?: string;
  description?: string;
  visibility?: Visibility;
  status?: ModuleStatus;
  activationStart?: string;
  activationEnd?: string;
  classIds?: string[];
}

export class ModuleService {
  constructor(private client: HttpClient = httpClient) {}

  async listPublicModules(params: { page?: number; limit?: number; search?: string } = {}): Promise<ListModulesResult> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.search) query.set("search", params.search);

    const qs = query.toString();
    const path = `/modules/public${qs ? `?${qs}` : ""}`;
    return this.client.get<ListModulesResult>(path);
  }

  async listModules(params: {
    page?: number;
    limit?: number;
    status?: string;
    visibility?: string;
    classId?: string;
    search?: string;
  } = {}): Promise<ListModulesResult> {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.status) query.set("status", params.status);
    if (params.visibility) query.set("visibility", params.visibility);
    if (params.classId) query.set("classId", params.classId);
    if (params.search) query.set("search", params.search);

    const qs = query.toString();
    const path = `/modules${qs ? `?${qs}` : ""}`;
    return this.client.get<ListModulesResult>(path);
  }

  async getModuleById(id: string): Promise<CourseModuleDetails> {
    return this.client.get<CourseModuleDetails>(`/modules/${id}`);
  }

  async createModule(payload: CreateModulePayload): Promise<CourseModuleSummary> {
    return this.client.post<CourseModuleSummary>("/modules", payload);
  }

  async updateModule(id: string, payload: UpdateModulePayload): Promise<CourseModuleSummary> {
    return this.client.patch<CourseModuleSummary>(`/modules/${id}`, payload);
  }

  async reorderExercises(id: string, orderedExerciseIds: string[]): Promise<{ message: string; reorderedCount: number }> {
    return this.client.put<{ message: string; reorderedCount: number }>(`/modules/${id}/exercises/order`, {
      orderedExerciseIds,
    });
  }
}

export const moduleService = new ModuleService();
