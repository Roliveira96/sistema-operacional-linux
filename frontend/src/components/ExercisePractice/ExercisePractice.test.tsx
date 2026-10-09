import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineSession } from "@/engine/engine";
import type { PracticeService } from "@/services/practiceService";
import { contentMessages } from "@/messages/content.pt-BR";
import { problem } from "@/test/helpers";
import { ExercisePractice } from "./ExercisePractice";

afterEach(cleanup);
const m = contentMessages.practice;

function engine() {
  const session: EngineSession = {
    prompt: () => ({ user: "root", host: "lab", path: "~", isRoot: true }),
    run: async () => {},
    snapshot: () => ({ formato: "exame-so/maquina" }),
  };
  return vi.fn().mockResolvedValue(session);
}

async function openPanel(service: Pick<PracticeService, "scenario" | "check">, extra = {}) {
  const create = engine();
  render(<ExercisePractice questionId="q1" completed={false} service={service} create={create} {...extra} />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: m.open }));
  });
  return create;
}

// Covers SPEC-014 CA-01, CA-03, CA-04 and CA-07 (interface side).
describe("ExercisePractice", () => {
  it("opens the terminal on the scenario and reports a passed check", async () => {
    const onCompleted = vi.fn();
    const service = { scenario: vi.fn().mockResolvedValue({ s: 1 }), check: vi.fn().mockResolvedValue({ passed: true, completedAt: "t" }) };
    const create = await openPanel(service, { onCompleted });
    expect(service.scenario).toHaveBeenCalledWith("q1");
    expect(create).toHaveBeenCalledWith({ s: 1 }, expect.anything());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: m.check }));
    });
    expect(service.check).toHaveBeenCalledWith("q1", { formato: "exame-so/maquina" });
    expect(screen.getByRole("status").textContent).toBe(m.passed);
    expect(onCompleted).toHaveBeenCalledWith("q1");
  });

  it.each([
    [{ passed: false, completedAt: null }, null, m.notYet],
    [null, problem("not-authenticated", 401), m.needsLogin],
    [null, new Error("offline"), m.checkFailed],
  ])("explains the outcome %#", async (result, error, message) => {
    const check = error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue(result);
    await openPanel({ scenario: vi.fn().mockResolvedValue({}), check });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: m.check }));
    });
    expect(screen.getByRole("alert").textContent).toContain(message);
  });

  it("resets the terminal and closes the panel", async () => {
    const create = await openPanel({ scenario: vi.fn().mockResolvedValue({}), check: vi.fn() });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: m.reset }));
    });
    expect(create).toHaveBeenCalledTimes(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: m.close }));
    });
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("shows when the scenario cannot be loaded and when the exercise is completed", async () => {
    await openPanel({ scenario: vi.fn().mockRejectedValue(new Error("404")), check: vi.fn() }, { completed: true });
    expect(screen.getByRole("alert").textContent).toBe(m.loadFailed);
    expect(screen.getByText(new RegExp(m.completed))).toBeTruthy();
  });
});
