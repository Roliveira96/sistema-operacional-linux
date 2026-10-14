import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { classroomService, type ActiveRoom, type LiveSession } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import PresentPage from "./page";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/Classroom/PresenterStage/PresenterStage", async () => {
  const React = await import("react");
  return {
    PresenterStage: (p: { classId: string; session: LiveSession }) => React.createElement("div", { "data-testid": "stage", "data-class": p.classId, "data-session": p.session.id }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const params = Promise.resolve({ id: "c-1" });
const session: LiveSession = { id: "s-1", classId: "c-1", title: "Aula", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "x" };
const room = (): ActiveRoom => ({ hasActiveSession: true, session, displayMode: "SLIDES", currentSlide: 1, activeDeck: null, recentDrawings: [], terminal: { screen: null }, handRaises: [], onlineCount: 1 });

function asRole(role: "TEACHER" | "STUDENT" | "ADMIN") {
  vi.mocked(useAuth).mockReturnValue({ user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" }, refresh: vi.fn(), logout: vi.fn() });
}

// SPEC-055 CA-04: the presentation window of the teacher
describe("presentation window page", () => {
  it("opens the stage of the class in progress, for the teacher and the administrator", async () => {
    for (const role of ["TEACHER", "ADMIN"] as const) {
      asRole(role);
      vi.spyOn(classroomService, "getActive").mockResolvedValue(room());
      const { unmount } = render(<PresentPage params={params} />);
      const view = await screen.findByTestId("stage");
      expect(view.getAttribute("data-class")).toBe("c-1");
      expect(view.getAttribute("data-session")).toBe("s-1");
      unmount();
    }
  });

  it("is not for the student, who is sent back to the class", async () => {
    asRole("STUDENT");
    vi.spyOn(classroomService, "getActive").mockResolvedValue(room());
    render(<PresentPage params={params} />);
    expect(await screen.findByText("Esta janela é do professor da turma.")).toBeDefined();
    expect(screen.queryByTestId("stage")).toBeNull();
    expect(screen.getByRole("link", { name: "Voltar para a turma" }).getAttribute("href")).toBe("/app/classes/c-1");
  });

  it("says there is no class in progress, with the way back", async () => {
    asRole("TEACHER");
    vi.spyOn(classroomService, "getActive").mockResolvedValue({ hasActiveSession: false });
    render(<PresentPage params={params} />);
    expect(await screen.findByText("Não há aula em andamento nesta turma.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a turma" })).toBeDefined();
  });

  it("says when the user has no access, and when the room cannot be opened", async () => {
    asRole("TEACHER");
    vi.spyOn(classroomService, "getActive").mockRejectedValueOnce(new ApiProblemError({ type: "forbidden", status: 403 }, 403));
    const { unmount } = render(<PresentPage params={params} />);
    expect(await screen.findByText("Você não tem acesso à aula desta turma.")).toBeDefined();
    unmount();
    vi.spyOn(classroomService, "getActive").mockRejectedValueOnce(new Error("down"));
    render(<PresentPage params={params} />);
    expect(await screen.findByText("Não foi possível abrir a sala ao vivo.")).toBeDefined();
  });
});
