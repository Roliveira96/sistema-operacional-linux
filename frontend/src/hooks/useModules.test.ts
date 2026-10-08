import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useModules } from "./useModules";
import { moduleService } from "@/services/moduleService";

vi.mock("@/services/moduleService", () => ({
  moduleService: {
    listPublicModules: vi.fn(),
    listModules: vi.fn(),
  },
}));

describe("useModules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches public modules when isPublic is true", async () => {
    vi.mocked(moduleService.listPublicModules).mockResolvedValueOnce({
      items: [
        {
          id: "m-1",
          teacherId: "t-1",
          title: "Public Module",
          description: "Desc",
          visibility: "PUBLIC",
          status: "ACTIVE",
          totalExercises: 2,
          totalMaterials: 1,
          isActiveNow: true,
          createdAt: "2026-10-08T00:00:00Z",
          updatedAt: "2026-10-08T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });

    const { result } = renderHook(() => useModules({ isPublic: true }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.modules).toHaveLength(1);
    expect(result.current.modules[0]?.title).toBe("Public Module");
    expect(moduleService.listPublicModules).toHaveBeenCalledWith({ page: 1, limit: 10, search: undefined });
  });

  it("fetches authenticated modules and handles filter changes", async () => {
    vi.mocked(moduleService.listModules).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });

    const { result } = renderHook(() => useModules({ isPublic: false }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setStatus("INACTIVE");
      result.current.setVisibility("PRIVATE");
      result.current.setSearch("thread");
    });

    await waitFor(() => {
      expect(moduleService.listModules).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        status: "INACTIVE",
        visibility: "PRIVATE",
        classId: undefined,
        search: "thread",
      });
    });
  });

  it("handles errors properly", async () => {
    vi.mocked(moduleService.listModules).mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useModules());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Network failure");
    expect(result.current.modules).toEqual([]);
  });
});
