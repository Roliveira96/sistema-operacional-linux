import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService } from "@/services/assessmentService";
import { detail } from "@/test/assessmentFixtures";
import RoomPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

function asRole(role: "TEACHER" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}
const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });

beforeEach(() => {
  vi.spyOn(assessmentService, "openRoom").mockReturnValue({ send: vi.fn(), close: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

// SPEC-091 CA-10, CA-11: the room is the window of the teacher; a student goes back to the assessment.
describe("room page", () => {
  it("opens the room of the exam for the teacher", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail({ phase: "RUNNING" }));
    render(<RoomPage params={params} />);
    expect(await screen.findByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
    expect(assessmentService.openRoom).toHaveBeenCalledWith("c-1", "a-1", expect.anything());
  });

  it("sends the student back to the assessment", async () => {
    asRole("STUDENT");
    render(<RoomPage params={params} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-1"));
  });
});
