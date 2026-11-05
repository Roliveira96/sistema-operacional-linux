import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { myAccess, studentAttempt } from "@/test/assessmentFixtures";
import { AttemptAction } from "./AttemptAction";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(access = myAccess({ allowed: true, reason: "ALLOWED" }), attempt: ReturnType<typeof studentAttempt> | null = null) {
  render(<AttemptAction classId="c-1" assessmentId="a-1" loadAccess={() => Promise.resolve(access)} loadAttempt={() => Promise.resolve(attempt)} />);
}

// SPEC-090 CA-11: the student enters the exam, goes back to it, or reads that it was delivered.
describe("AttemptAction", () => {
  it("offers to enter the exam, in its own window, when the access is allowed and there is no attempt", async () => {
    setup();
    const link = await screen.findByRole("link", { name: "Entrar na prova" });
    expect(link.getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/take");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("offers to go back to the exam in progress", async () => {
    setup(myAccess({ allowed: true, reason: "ALLOWED" }), studentAttempt());
    const link = await screen.findByRole("link", { name: "Voltar para a prova" });
    expect(link.getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/take");
  });

  it("says when the exam was delivered, with no button, also when the time ran out", async () => {
    setup(myAccess({ allowed: false, reason: "ENDED" }), studentAttempt({ status: "SUBMITTED", submittedAt: "2026-10-21T10:15:00-03:00" }));
    expect(await screen.findByText("Prova entregue em 21/10/2026, 10:15.")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    setup(myAccess({ allowed: false, reason: "ENDED" }), studentAttempt({ status: "TIME_EXPIRED", submittedAt: "2026-10-21T11:01:00-03:00" }));
    expect(await screen.findByText("Prova entregue em 21/10/2026, 11:01.")).toBeDefined();
  });

  // SPEC-091 RN-02 and CA-14: before the teacher starts, the student opens the window and waits in the waiting room there.
  it("offers to enter, to wait in the waiting room, while the teacher has not started the exam", async () => {
    setup(myAccess({ allowed: false, reason: "NOT_STARTED" }));
    const link = await screen.findByRole("link", { name: "Entrar na prova" });
    expect(link.getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1/take");
  });

  it("offers nothing without the access and without an attempt", async () => {
    setup(myAccess({ allowed: false, reason: "NOT_OPEN_YET" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link")).toBeNull();
  });

  // Defect of the manual script of 05/11/2026: the student opened the page before the period and the button never came.
  it("asks the access again while the exam is not open yet, and offers to enter when it opens", async () => {
    vi.useFakeTimers();
    const loadAccess = vi
      .fn()
      .mockResolvedValueOnce(myAccess({ allowed: false, reason: "NOT_OPEN_YET" }))
      .mockResolvedValue(myAccess({ allowed: false, reason: "NOT_STARTED" }));
    render(<AttemptAction classId="c-1" assessmentId="a-1" loadAccess={loadAccess} loadAttempt={() => Promise.resolve(null)} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.queryByRole("link")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole("link", { name: "Entrar na prova" })).toBeDefined();
    const calls = loadAccess.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(loadAccess).toHaveBeenCalledTimes(calls);
  });
});
