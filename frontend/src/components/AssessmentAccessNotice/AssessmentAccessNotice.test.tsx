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

// SPEC-076 RN-09, SPEC-083 CA-14, SPEC-091 CA-03 (RN-03): the student reads the modality and, while the teacher has not started the exam, that they
// wait for her; nothing of a clearance, which no longer exists. The start reaches them without a reload.
describe("AssessmentAccessNotice", () => {
  it("names the modality", async () => {
    await setup(myAccess());
    expect(screen.getByText("Modalidade: Presencial")).toBeDefined();
    expect(screen.queryByText(/habilita/i)).toBeNull();
  });

  it("says the teacher has not started the exam, in person or online, and that the student enters as soon as she does", async () => {
    await setup(myAccess({ reason: "NOT_STARTED" }));
    expect(screen.getByRole("status").textContent).toBe("A docente ainda não iniciou a prova. Aguarde: você entra assim que ela iniciar.");
    cleanup();
    await setup(myAccess({ reason: "NOT_STARTED", modality: "ONLINE" }));
    expect(screen.getByRole("status").textContent).toBe("A docente ainda não iniciou a prova. Aguarde: você entra assim que ela iniciar.");
  });

  it("has no field for a token and no button to start", async () => {
    await setup(myAccess());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the start of the teacher within 30 seconds, without reloading", async () => {
    const { load } = await setup(myAccess({ reason: "NOT_STARTED" }), myAccess({ allowed: true, reason: "ALLOWED" }));
    expect(screen.getByRole("status")).toBeDefined();
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
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

  it("stays quiet when it cannot read, and keeps what it has when a later reading fails", async () => {
    const { container } = await setup(new Error("down"), myAccess({ reason: "NOT_STARTED" }), new Error("down"));
    expect(container.textContent).toBe("");
    await advance(30_000);
    expect(screen.getByRole("status")).toBeDefined();
    await advance(30_000);
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("stops asking when it leaves the screen", async () => {
    const { load, unmount } = await setup(myAccess());
    unmount();
    await advance(120_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
