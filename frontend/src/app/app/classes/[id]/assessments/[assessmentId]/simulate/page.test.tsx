import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { detail, simulation } from "@/test/assessmentFixtures";
import SimulatePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));

function asRole(role: "TEACHER" | "ADMIN" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}

const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });

beforeEach(() => replace.mockClear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-081 section 3.1: the page of the simulator, for the teacher and the administrator; the student goes back to the assessment.
describe("simulator page", () => {
  it("reads the assessment and the preview of the route and shows the simulator with the two views", async () => {
    asRole("TEACHER");
    const get = vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    const preview = vi.spyOn(assessmentService, "preview").mockResolvedValue(simulation());
    render(<SimulatePage params={params} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Simulador da prova" })).toBeDefined();
    expect(await screen.findByRole("region", { name: "Visão do professor" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Visão do aluno" })).toBeDefined();
    expect(get).toHaveBeenCalledWith("c-1", "a-1");
    expect(preview).toHaveBeenCalledWith("c-1", "a-1");
    expect(screen.getByRole("link", { name: "Voltar para a avaliação" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
  });

  it("works for the administrator too", async () => {
    asRole("ADMIN");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    vi.spyOn(assessmentService, "preview").mockResolvedValue(simulation());
    render(<SimulatePage params={params} />);
    expect(await screen.findByRole("region", { name: "Visão do aluno" })).toBeDefined();
  });

  // CA-01: the student has no simulator; the address takes them back to the assessment, and nothing is read.
  it("sends the student back to the assessment without reading anything", async () => {
    asRole("STUDENT");
    const get = vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    const preview = vi.spyOn(assessmentService, "preview").mockResolvedValue(simulation());
    render(<SimulatePage params={params} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-1"));
    expect(get).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Visão do aluno" })).toBeNull();
  });

  it("says that it could not read the assessment and tries again", async () => {
    asRole("TEACHER");
    const get = vi.spyOn(assessmentService, "get").mockRejectedValueOnce(problem("assessment-not-found", 404)).mockResolvedValue(detail());
    vi.spyOn(assessmentService, "preview").mockResolvedValue(simulation());
    render(<SimulatePage params={params} />);
    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("region", { name: "Visão do aluno" })).toBeDefined();
    expect(get).toHaveBeenCalledTimes(2);
  });

  // CA-17, RN-04: the simulation only reads; no route that writes is called, from the start to the delivery.
  it("calls no route that writes while the teacher simulates and delivers", async () => {
    asRole("TEACHER");
    vi.spyOn(assessmentService, "get").mockResolvedValue(detail());
    vi.spyOn(assessmentService, "preview").mockResolvedValue(simulation());
    const writers = (["create", "update", "reschedule", "cancel", "saveNotes", "decideClearances"] as const).map((name) =>
      vi.spyOn(assessmentService, name).mockRejectedValue(new Error(`${name} must not be called`)),
    );
    render(<SimulatePage params={params} />);
    const student = await screen.findByRole("region", { name: "Visão do aluno" });
    fireEvent.click(within(student).getByRole("button", { name: "Começar" }));
    fireEvent.click(within(student).getByRole("radio", { name: "Falso" }));
    fireEvent.click(within(student).getByRole("button", { name: "Entregar" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Entregar" }));
    expect(within(student).getByRole("heading", { name: "Simulação entregue" })).toBeDefined();
    for (const writer of writers) expect(writer).not.toHaveBeenCalled();
  });
});
