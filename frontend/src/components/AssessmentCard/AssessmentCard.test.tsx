import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicOf } from "@/test/assessmentFixtures";
import type { AssessmentPublic } from "@/services/assessmentService";
import { AssessmentCard } from "./AssessmentCard";

// The server says it is 10:00 on October 21st; the exam starts at 11:30, an hour and a half ahead.
const soon = (over: Partial<AssessmentPublic> = {}) =>
  publicOf({ startsAt: "2026-10-21T11:30:00-03:00", endsAt: "2026-10-21T13:30:00-03:00", ...over });

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

async function setup(...reads: Array<AssessmentPublic | Error>) {
  const load = vi.fn();
  reads.forEach((r) => (r instanceof Error ? load.mockRejectedValueOnce(r) : load.mockResolvedValueOnce(r)));
  // after the readings the test gave, the server keeps answering with the last good one, and its clock keeps running
  const good = reads.filter((r): r is AssessmentPublic => !(r instanceof Error)).at(-1) ?? soon();
  const t0 = Date.now();
  load.mockImplementation(async () => ({ ...good, serverNow: new Date(Date.parse(good.serverNow) + (Date.now() - t0)).toISOString() }));
  const view = render(<AssessmentCard load={load} />);
  await flush();
  return { ...view, load };
}

const timer = () => screen.queryByRole("timer")?.textContent;

// SPEC-075 CA-27 and CA-28, section 3.1 (the student).
describe("AssessmentCard", () => {
  it("shows the label, the title, the period, the duration, the maximum score and the instructions", async () => {
    await setup(soon({ description: "Traga o documento com foto.\nSem consulta." }));
    expect(screen.getByText("Prova")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
    expect(screen.getByText("21/10/2026, 11:30–13:30")).toBeDefined();
    expect(screen.getByText("Duração: 60 minutos")).toBeDefined();
    expect(screen.getByText("Nota máxima: 10,00")).toBeDefined();
    expect(screen.getByText(/Traga o documento com foto\./).textContent).toBe("Traga o documento com foto.\nSem consulta.");
  });

  it("calls an assignment an activity, and says it uses the whole period when it has no duration", async () => {
    await setup(soon({ type: "ASSIGNMENT", durationMinutes: undefined, startsAt: "2026-10-26T08:00:00-03:00", endsAt: "2026-10-30T23:59:00-03:00" }));
    expect(screen.getByText("Atividade")).toBeDefined();
    expect(screen.getByText("Duração: o período inteiro")).toBeDefined();
    expect(screen.getByText("26/10/2026 08:00 a 30/10/2026 23:59")).toBeDefined();
  });

  it("counts down to the start with the clock of the server, a second at a time", async () => {
    await setup(soon());
    expect(screen.getByText("Começa em")).toBeDefined();
    expect(timer()).toBe("01:30:00");
    await advance(1000);
    expect(timer()).toBe("01:29:59");
    await advance(59_000);
    expect(timer()).toBe("01:29:00");
  });

  it("counts with the server clock, whatever the clock of the browser says", async () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    await setup(soon());
    expect(timer()).toBe("01:30:00");
  });

  it("stops the count at zero while the next reading does not come", async () => {
    await setup(soon());
    await advance(29_000); // before the 30 seconds
    await advance(5400_000 - 29_000);
    expect(timer()).toBe("00:00:00");
  });

  it("asks again every 30 seconds while the tab is in view", async () => {
    const { load } = await setup(soon());
    expect(load).toHaveBeenCalledTimes(1);
    await advance(29_000);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not ask while the tab is hidden, and asks the moment it is back in view", async () => {
    const { load } = await setup(soon());
    showTab("hidden");
    await advance(120_000);
    expect(load).toHaveBeenCalledTimes(1);
    showTab("visible");
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("redoes the count when the teacher moves the start, without reloading the page", async () => {
    // thirty seconds later the server says 10:00:30, and the start moved from 11:30 to 12:00
    await setup(soon(), soon({ startsAt: "2026-10-21T12:00:00-03:00", endsAt: "2026-10-21T14:00:00-03:00", serverNow: "2026-10-21T10:00:30-03:00" }));
    expect(timer()).toBe("01:30:00");
    await advance(30_000);
    expect(timer()).toBe("01:59:30");
    expect(screen.getByText("21/10/2026, 12:00–14:00")).toBeDefined();
  });

  it("turns into the canceled card when the teacher cancels: struck title, a banner and the reason", async () => {
    await setup(soon(), soon({ status: "CANCELED", cancelReason: "Falta de energia", serverNow: "2026-10-21T10:00:30-03:00" }));
    expect(timer()).toBe("01:30:00");
    await advance(30_000);
    expect(timer()).toBeUndefined();
    expect(screen.getByText("Prova 1: permissões").closest("s")).not.toBeNull();
    expect(screen.getByText("Avaliação cancelada")).toBeDefined();
    expect(screen.getByText("Falta de energia")).toBeDefined();
    expect(screen.queryByText("Começa em")).toBeNull();
  });

  it("says the assessment is on, until when, and has no way to start it", async () => {
    await setup(soon({ phase: "RUNNING", startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00" }));
    expect(screen.getByText("Em andamento: termina em 21/10/2026 às 11:00.")).toBeDefined();
    expect(timer()).toBeUndefined();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says the assessment is over", async () => {
    await setup(soon({ phase: "ENDED", startsAt: "2026-10-21T07:00:00-03:00", endsAt: "2026-10-21T09:00:00-03:00" }));
    expect(screen.getByText("Encerrada em 21/10/2026 às 09:00.")).toBeDefined();
    expect(timer()).toBeUndefined();
  });

  it("says it is loading, and that it failed, and tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(soon());
    render(<AssessmentCard load={load} />);
    expect(screen.getByRole("status").textContent).toBe("Carregando a avaliação…");
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar a avaliação.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
  });

  it("keeps the card it has when a later reading fails", async () => {
    await setup(soon(), new Error("down"));
    await advance(30_000);
    expect(screen.getByRole("heading", { name: "Prova 1: permissões" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops asking when it leaves the screen", async () => {
    const { load, unmount } = await setup(soon());
    unmount();
    await advance(120_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
