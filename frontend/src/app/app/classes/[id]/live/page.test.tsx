import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { classroomService, type ActiveRoom, type LiveSession } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import LivePage from "./page";

vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/components/Classroom/LiveClassroom/LiveClassroom", async () => {
  const React = await import("react");
  return {
    LiveClassroom: (p: { classId: string; role: string; userId: string; session: LiveSession }) =>
      React.createElement("div", { "data-testid": "room", "data-class": p.classId, "data-role": p.role, "data-user": p.userId, "data-session": p.session.id }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const params = Promise.resolve({ id: "c-1" });
const session: LiveSession = { id: "s-1", classId: "c-1", title: "Aula", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "x" };
const room = (): ActiveRoom => ({ hasActiveSession: true, session, displayMode: "SLIDES", currentSlide: 1, activeDeck: null, recentDrawings: [], terminal: { input: null, entries: [], state: null }, handRaises: [], onlineCount: 1 });

function asRole(role: "TEACHER" | "STUDENT" | "ADMIN") {
  vi.mocked(useAuth).mockReturnValue({ user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" }, refresh: vi.fn(), logout: vi.fn() });
}

// SPEC-051, section 3.1
describe("live classroom page", () => {
  it("opens the room of the class in progress, as the teacher", async () => {
    asRole("TEACHER");
    vi.spyOn(classroomService, "getActive").mockResolvedValue(room());
    render(<LivePage params={params} />);
    const view = await screen.findByTestId("room");
    expect(view.getAttribute("data-class")).toBe("c-1");
    expect(view.getAttribute("data-role")).toBe("teacher");
    expect(view.getAttribute("data-user")).toBe("u-1");
    expect(view.getAttribute("data-session")).toBe("s-1");
  });

  it("treats the administrator as the teacher and the student as a student", async () => {
    asRole("ADMIN");
    vi.spyOn(classroomService, "getActive").mockResolvedValue(room());
    const { unmount } = render(<LivePage params={params} />);
    expect((await screen.findByTestId("room")).getAttribute("data-role")).toBe("teacher");
    unmount();
    asRole("STUDENT");
    render(<LivePage params={params} />);
    expect((await screen.findByTestId("room")).getAttribute("data-role")).toBe("student");
  });

  it("says there is no class in progress, with the way back", async () => {
    asRole("STUDENT");
    vi.spyOn(classroomService, "getActive").mockResolvedValue({ hasActiveSession: false });
    render(<LivePage params={params} />);
    expect(await screen.findByText("Não há aula em andamento nesta turma.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a turma" }).getAttribute("href")).toBe("/app/classes/c-1");
    expect(screen.queryByTestId("room")).toBeNull();
  });

  it("says when the user has no access to the class", async () => {
    asRole("STUDENT");
    vi.spyOn(classroomService, "getActive").mockRejectedValue(new ApiProblemError({ type: "forbidden", status: 403 }, 403));
    render(<LivePage params={params} />);
    expect(await screen.findByText("Você não tem acesso à aula desta turma.")).toBeDefined();
  });

  it("says when the room cannot be opened", async () => {
    asRole("TEACHER");
    vi.spyOn(classroomService, "getActive").mockRejectedValue(new Error("down"));
    render(<LivePage params={params} />);
    expect(await screen.findByText("Não foi possível abrir a sala ao vivo.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para a turma" })).toBeDefined();
  });
});
