import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { summary } from "@/test/assessmentFixtures";
import type { AssessmentSummary } from "@/services/assessmentService";
import { AssessmentRescheduleDialog } from "./AssessmentRescheduleDialog";

afterEach(cleanup);

function setup(over: Partial<AssessmentSummary> = {}, onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<AssessmentRescheduleDialog assessment={summary({ title: "Prova 1: permissões", ...over })} onClose={onClose} onConfirm={onConfirm} />);
  return { onClose, onConfirm };
}

const starts = () => screen.getByLabelText("Início") as HTMLInputElement;
const ends = () => screen.getByLabelText("Término") as HTMLInputElement;
const reason = () => screen.getByLabelText(/Justificativa/) as HTMLTextAreaElement;
const confirm = () => screen.getByRole("button", { name: "Reagendar" }) as HTMLButtonElement;
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

// SPEC-075 CA-26, RN-11, D-07.
describe("AssessmentRescheduleDialog", () => {
  it("is a dialog named for the assessment, with the dates it has and the focus on the first field", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Reagendar avaliação: Prova 1: permissões" })).toBeDefined();
    expect(starts().value).toBe("2026-10-23T09:00");
    expect(ends().value).toBe("2026-10-23T11:00");
    expect(document.activeElement).toBe(starts());
  });

  describe("before it starts", () => {
    it("changes both dates, and the reason is optional", async () => {
      const { onConfirm } = setup();
      expect(confirm().disabled).toBe(true); // nothing changed yet
      set(starts(), "2026-10-24T14:00");
      set(ends(), "2026-10-24T16:00");
      expect(confirm().disabled).toBe(false);
      fireEvent.click(confirm());
      await waitFor(() =>
        expect(onConfirm).toHaveBeenCalledWith({ startsAt: "2026-10-24T14:00:00-03:00", endsAt: "2026-10-24T16:00:00-03:00", reason: undefined }),
      );
    });

    it("sends the reason when there is one", async () => {
      const { onConfirm } = setup();
      set(starts(), "2026-10-24T14:00");
      set(ends(), "2026-10-24T16:00");
      set(reason(), " Laboratório indisponível ");
      fireEvent.click(confirm());
      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ reason: "Laboratório indisponível" })));
    });

    it("refuses a term that is not after the start, and an exam that crosses the day", () => {
      setup();
      set(starts(), "2026-10-24T14:00");
      set(ends(), "2026-10-24T13:00");
      expect(confirm().disabled).toBe(true);
      expect(screen.getByText("O término deve ser depois do início.")).toBeDefined();
      set(ends(), "2026-10-25T10:00");
      expect(confirm().disabled).toBe(true);
      expect(screen.getByText("Uma prova começa e termina no mesmo dia.")).toBeDefined();
    });

    it("lets an assignment run over several days", () => {
      setup({ type: "ASSIGNMENT", startsAt: "2026-10-26T08:00:00-03:00", endsAt: "2026-10-30T23:59:00-03:00" });
      set(ends(), "2026-11-02T23:59");
      expect(confirm().disabled).toBe(false);
    });
  });

  describe("while it runs", () => {
    const running = { phase: "RUNNING" as const, startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T11:00:00-03:00" };

    it("locks the start and asks for the reason", () => {
      setup(running);
      expect(starts().disabled).toBe(true);
      expect(starts().value).toBe("2026-10-21T09:00");
      expect(screen.getByText("Com a avaliação em andamento, só o término pode ser empurrado para depois, e a justificativa é obrigatória.")).toBeDefined();
      expect(reason().required).toBe(true);
      expect(document.activeElement).toBe(ends());
      set(ends(), "2026-10-21T12:00");
      expect(confirm().disabled).toBe(true); // no reason yet
      set(reason(), "A turma pediu mais tempo");
      expect(confirm().disabled).toBe(false);
    });

    it("only lets the term be pushed past the current one", () => {
      setup(running);
      set(reason(), "A turma pediu mais tempo");
      set(ends(), "2026-10-21T10:30");
      expect(confirm().disabled).toBe(true);
      expect(screen.getByText("O novo término deve ser depois do atual.")).toBeDefined();
    });

    it("sends the same start", async () => {
      const { onConfirm } = setup(running);
      set(ends(), "2026-10-21T12:00");
      set(reason(), "A turma pediu mais tempo");
      fireEvent.click(confirm());
      await waitFor(() =>
        expect(onConfirm).toHaveBeenCalledWith({ startsAt: "2026-10-21T09:00:00-03:00", endsAt: "2026-10-21T12:00:00-03:00", reason: "A turma pediu mais tempo" }),
      );
    });
  });

  it("shows why the server refused, and stays open", async () => {
    const { onClose } = setup({}, vi.fn().mockRejectedValue(problem("assessment-ended", 409)));
    set(ends(), "2026-10-23T12:00");
    fireEvent.click(confirm());
    expect((await screen.findByRole("alert")).textContent).toBe("A avaliação já terminou.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with Escape and with the way back", () => {
    const { onClose, onConfirm } = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
