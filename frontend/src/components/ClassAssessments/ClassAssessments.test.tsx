import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { SERVER_NOW, publicOf, summary } from "@/test/assessmentFixtures";
import { ClassAssessments } from "./ClassAssessments";

const pushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

function asRole(role: "TEACHER" | "STUDENT" | "ADMIN") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}

/** Opens the menu Mais ações of the only assessment on the screen (SPEC-080). */
const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /^Mais ações de/ }));

beforeEach(() => pushMock.mockClear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-082 CA-02, CA-08: the assessments of the class, now the content of a tab of the page of the class, with what SPEC-075, 076 and 080 gave the list.
describe("assessments of the class (tab)", () => {
  describe("teacher", () => {
    function setup() {
      asRole("TEACHER");
      const list = vi.spyOn(assessmentService, "list").mockResolvedValue({ items: [summary({ id: "a-1", title: "Prova 1: permissões" })], serverNow: SERVER_NOW });
      render(<ClassAssessments classId="c-1" />);
      return { list };
    }

    it("lists the assessments of the class", async () => {
      const { list } = setup();
      expect(await screen.findByRole("table")).toBeDefined();
      expect(list).toHaveBeenCalledWith("c-1");
      expect(screen.getByText("Prova 1: permissões")).toBeDefined();
    });

    // SPEC-082 section 3.1: the name of the tab is the title, and the class is already around it.
    it("has no title of its own and no way back to the class", async () => {
      setup();
      await screen.findByRole("table");
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
      expect(screen.queryByRole("link", { name: "Voltar para a turma" })).toBeNull();
      expect(screen.queryByRole("main")).toBeNull();
    });

    it("goes to the form of a new assessment, and to the detail, the edit and the preview of one", async () => {
      setup();
      await screen.findByRole("table");
      fireEvent.click(screen.getByRole("button", { name: "Nova avaliação" }));
      expect(pushMock).toHaveBeenLastCalledWith("/app/classes/c-1/assessments/new");
      expect(screen.getByRole("link", { name: "Prova 1: permissões" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
      fireEvent.click(screen.getByRole("button", { name: /^Editar/ }));
      expect(pushMock).toHaveBeenLastCalledWith("/app/classes/c-1/assessments/a-1/edit");
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Pré-visualizar" }));
      expect(pushMock).toHaveBeenLastCalledWith("/app/classes/c-1/assessments/a-1?preview=1");
    });

    it("reschedules in a dialog, and reads the list again", async () => {
      const { list } = setup();
      const reschedule = vi.spyOn(assessmentService, "reschedule").mockResolvedValue({ ...summary(), serverNow: SERVER_NOW });
      await screen.findByRole("table");
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Reagendar" }));
      const dialog = screen.getByRole("dialog", { name: /^Reagendar avaliação/ });
      fireEvent.change(within(dialog).getByLabelText("Término"), { target: { value: "2026-10-23T12:00" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Reagendar" }));
      await waitFor(() =>
        expect(reschedule).toHaveBeenCalledWith("c-1", "a-1", { startsAt: "2026-10-23T09:00:00-03:00", endsAt: "2026-10-23T12:00:00-03:00", reason: undefined }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(list).toHaveBeenCalledTimes(2);
    });

    it("cancels in a dialog, with the reason and the confirmation, and reads the list again", async () => {
      const { list } = setup();
      const cancel = vi.spyOn(assessmentService, "cancel").mockResolvedValue({ ...summary({ status: "CANCELED" }), serverNow: SERVER_NOW });
      await screen.findByRole("table");
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar" }));
      const dialog = screen.getByRole("dialog", { name: /^Cancelar avaliação/ });
      fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "Falta de energia" } });
      fireEvent.click(within(dialog).getByRole("checkbox"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar avaliação" }));
      await waitFor(() => expect(cancel).toHaveBeenCalledWith("c-1", "a-1", "Falta de energia"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(list).toHaveBeenCalledTimes(2);
    });

    it("keeps the dialog open and says why when the server refuses", async () => {
      setup();
      vi.spyOn(assessmentService, "cancel").mockRejectedValue(problem("grades-homologated", 409));
      await screen.findByRole("table");
      openMenu();
      fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "x" } });
      fireEvent.click(within(dialog).getByRole("checkbox"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar avaliação" }));
      expect((await within(dialog).findByRole("alert")).textContent).toContain("homologada");
      expect(screen.getByRole("dialog")).toBeDefined();
    });

    it("says it failed to load, and tries again", async () => {
      asRole("TEACHER");
      const list = vi.spyOn(assessmentService, "list").mockRejectedValueOnce(new Error("down")).mockResolvedValue({ items: [summary()], serverNow: SERVER_NOW });
      render(<ClassAssessments classId="c-1" />);
      expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar as avaliações.");
      fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
      expect(await screen.findByRole("table")).toBeDefined();
      expect(list).toHaveBeenCalledTimes(2);
    });

    it("lets the administrator do the same", async () => {
      asRole("ADMIN");
      vi.spyOn(assessmentService, "list").mockResolvedValue({ items: [summary()], serverNow: SERVER_NOW });
      render(<ClassAssessments classId="c-1" />);
      expect(await screen.findByRole("button", { name: "Nova avaliação" })).toBeDefined();
    });
  });

  describe("student", () => {
    it("lists only what is public, each one a link to its page, and has no way to make or change one", async () => {
      asRole("STUDENT");
      vi.spyOn(assessmentService, "list").mockResolvedValue({
        items: [
          publicOf({ id: "a-1", title: "Prova 1: permissões" }),
          publicOf({ id: "a-2", title: "Prova de reposição", status: "CANCELED", cancelReason: "Falta de energia" }),
        ],
        serverNow: SERVER_NOW,
      });
      render(<ClassAssessments classId="c-1" />);
      const first = await screen.findByRole("link", { name: "Prova 1: permissões" });
      expect(first.getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
      const items = screen.getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(items[0]!.textContent).toContain("Prova");
      expect(items[0]!.textContent).toContain("23/10/2026, 09:00–11:00");
      expect(items[0]!.textContent).toContain("Agendada");
      expect(items[1]!.textContent).toContain("Cancelada");
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByRole("button", { name: "Nova avaliação" })).toBeNull();
    });

    it("says there is none", async () => {
      asRole("STUDENT");
      vi.spyOn(assessmentService, "list").mockResolvedValue({ items: [], serverNow: SERVER_NOW });
      render(<ClassAssessments classId="c-1" />);
      expect(await screen.findByText("Nenhuma avaliação agendada")).toBeDefined();
    });
  });
});

// SPEC-076 CA-15: the warning of the list, wired to the clearances.
describe("assessments of the class: clearances (SPEC-076)", () => {
  const soon = () =>
    summary({
      id: "a-1",
      title: "Prova 1: permissões",
      startsAt: "2026-10-21T10:30:00-03:00",
      endsAt: "2026-10-21T12:00:00-03:00",
      clearanceCounts: { pending: 3, approved: 29, rejected: 0 },
    });

  it("approves all who wait from the warning, and reads the list again", async () => {
    asRole("TEACHER");
    const list = vi.spyOn(assessmentService, "list").mockResolvedValue({ items: [soon()], serverNow: SERVER_NOW });
    const decide = vi.spyOn(assessmentService, "decideClearances").mockResolvedValue({ requiresClearance: true, items: [], counts: { pending: 0, approved: 32, rejected: 0 }, serverNow: SERVER_NOW });
    render(<ClassAssessments classId="c-1" />);
    await screen.findByRole("table");
    const warning = screen.getByRole("status");
    expect(warning.textContent).toContain("3 alunos ainda não foram habilitados");
    fireEvent.click(within(warning).getByRole("button", { name: "Habilitar todos" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("c-1", "a-1", { action: "APPROVE_ALL" }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("goes to the clearances from the warning", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "list").mockResolvedValue({ items: [soon()], serverNow: SERVER_NOW });
    render(<ClassAssessments classId="c-1" />);
    await screen.findByRole("table");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Ver habilitações" }));
    expect(pushMock).toHaveBeenLastCalledWith("/app/classes/c-1/assessments/a-1/clearances");
  });

  it("says why it could not approve all, and leaves the warning there", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "list").mockResolvedValue({ items: [soon()], serverNow: SERVER_NOW });
    vi.spyOn(assessmentService, "decideClearances").mockRejectedValue(problem("assessment-ended", 409));
    render(<ClassAssessments classId="c-1" />);
    await screen.findByRole("table");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Habilitar todos" }));
    expect((await screen.findByRole("alert")).textContent).toBe("A avaliação já terminou.");
    expect(screen.getByRole("status").textContent).toContain("3 alunos ainda não foram habilitados");
  });
});
