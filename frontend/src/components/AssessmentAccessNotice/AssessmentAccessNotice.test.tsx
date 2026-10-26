import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myAccess } from "@/test/assessmentFixtures";
import type { MyAccess } from "@/services/assessmentService";
import { AssessmentAccessNotice } from "./AssessmentAccessNotice";

// The visibility of the tab, which jsdom keeps always visible.
let visibility: "visible" | "hidden" = "visible";
function showTab(state: "visible" | "hidden") {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

async function setup(...reads: Array<MyAccess | Error>) {
  const load = vi.fn();
  reads.forEach((r) => (r instanceof Error ? load.mockRejectedValueOnce(r) : load.mockResolvedValueOnce(r)));
  load.mockResolvedValue(reads.filter((r): r is MyAccess => !(r instanceof Error)).at(-1) ?? myAccess());
  const view = render(<AssessmentAccessNotice load={load} />);
  await flush();
  return { ...view, load };
}

// SPEC-076 CA-17, RN-09, D-09: the student sees only their own state of the clearance, and the decision of the teacher reaches them without a reload.
describe("AssessmentAccessNotice", () => {
  it("says the student waits for the teacher", async () => {
    await setup(myAccess({ clearance: { status: "PENDING" } }));
    expect(screen.getByText("Modalidade: Presencial")).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("Aguardando a habilitação da professora");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says the student is cleared", async () => {
    await setup(myAccess({ allowed: true, reason: "ALLOWED", clearance: { status: "APPROVED" } }));
    expect(screen.getByRole("status").textContent).toContain("Habilitado");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a fixed banner with the reason when the clearance was refused", async () => {
    await setup(myAccess({ reason: "NOT_CLEARED", clearance: { status: "REJECTED", rejectionReason: "Reprovado por faltas" } }));
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Habilitação recusada");
    expect(banner.textContent).toContain("Reprovado por faltas");
    expect(banner.textContent).not.toContain("Sua matrícula não foi habilitada");
  });

  it("shows the standard sentence when the refusal has no reason", async () => {
    await setup(myAccess({ reason: "NOT_CLEARED", clearance: { status: "REJECTED" } }));
    expect(screen.getByRole("alert").textContent).toContain("Sua matrícula não foi habilitada para esta avaliação presencial.");
  });

  it("only names the modality when the assessment does not require the clearance", async () => {
    await setup(myAccess({ modality: "ONLINE", requiresClearance: false, clearance: undefined, allowed: true, reason: "ALLOWED" }));
    expect(screen.getByText("Modalidade: Online")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();

    await setup(myAccess({ modality: "IN_PERSON", requiresClearance: false, clearance: undefined }));
    expect(screen.getByText("Modalidade: Presencial")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("has no field for a token and no button to start", async () => {
    await setup(myAccess({ clearance: { status: "APPROVED" }, allowed: true, reason: "ALLOWED" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the decision of the teacher within 30 seconds, without reloading", async () => {
    const { load } = await setup(myAccess({ clearance: { status: "PENDING" } }), myAccess({ clearance: { status: "REJECTED", rejectionReason: "Faltas" } }));
    expect(screen.queryByRole("alert")).toBeNull();
    await advance(29_000);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toContain("Faltas");
  });

  it("does not ask while the tab is hidden, and asks the moment it is back in view", async () => {
    const { load } = await setup(myAccess());
    showTab("hidden");
    await advance(120_000);
    expect(load).toHaveBeenCalledTimes(1);
    showTab("visible");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when it cannot read, and shows the state when it can", async () => {
    const { container } = await setup(new Error("down"), myAccess({ clearance: { status: "APPROVED" } }));
    expect(container.textContent).toBe("");
    await advance(30_000);
    expect(screen.getByRole("status").textContent).toContain("Habilitado");
  });

  it("keeps what it has when a later reading fails", async () => {
    await setup(myAccess({ clearance: { status: "APPROVED" } }), new Error("down"));
    await advance(30_000);
    expect(screen.getByRole("status").textContent).toContain("Habilitado");
  });

  it("stops asking when it leaves the screen", async () => {
    const { load, unmount } = await setup(myAccess());
    unmount();
    await advance(120_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

// SPEC-083 CA-14, RN-06: while the teacher has not started the exam the student reads that, and not their own state of the clearance.
describe("AssessmentAccessNotice, exam not started", () => {
  it("says the teacher has not started the exam and does not show the own state of the clearance", async () => {
    await setup(myAccess({ reason: "NOT_STARTED", clearance: { status: "PENDING" } }));
    expect(screen.getByText("Modalidade: Presencial")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("A docente ainda não iniciou a prova. Aguarde: ela libera a entrada de cada aluno.");
    expect(screen.queryByText(/Aguardando a habilitação da professora/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the own state once the exam is started, as the teacher decides", async () => {
    await setup(myAccess({ reason: "NOT_STARTED", clearance: { status: "REJECTED", rejectionReason: "Faltas" } }));
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    await setup(myAccess({ reason: "NOT_CLEARED", clearance: { status: "REJECTED", rejectionReason: "Faltas" } }));
    expect(screen.getByRole("alert").textContent).toContain("Faltas");
  });
});
