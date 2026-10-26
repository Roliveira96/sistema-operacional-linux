import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm } from "./AssessmentForm";

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof AssessmentForm>> = {}) {
  const onSubmit = vi.fn().mockRejectedValue(problem("weights-mismatch", 400));
  return render(
    <AssessmentForm
      mode="create"
      modules={[{ id: "mod-1", title: "Permissões de arquivos" }]}
      students={[{ id: "s-1", name: "Ana Souza", academicId: "1000001" }]}
      loadQuestions={vi.fn().mockResolvedValue(questions())}
      onSubmit={onSubmit}
      {...over}
    />,
  );
}

const tabs = () => screen.getAllByRole("tab");
const key = (el: HTMLElement, k: string) => fireEvent.keyDown(el, { key: k });

/** The name of a control: its label, or what the author wrote for it. */
const named = (el: Element) => (el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");

// SPEC-075 CA-29: keyboard, labels and focus of the form.
describe("AssessmentForm accessibility", () => {
  it("is a tablist that the keyboard walks: one tab in the sequence, the arrows and Home and End move it", () => {
    setup();
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Seções da avaliação");
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);

    key(tabs()[0]!, "ArrowRight");
    expect(tabs()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1, -1]);

    key(tabs()[1]!, "End");
    expect(document.activeElement).toBe(tabs()[4]);
    key(tabs()[4]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs()[4]); // it stops at the end
    key(tabs()[4]!, "Home");
    expect(document.activeElement).toBe(tabs()[0]);
    key(tabs()[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("ties each tab to its panel, and each panel back to its tab", () => {
    setup();
    for (const t of tabs()) {
      const panel = document.getElementById(t.getAttribute("aria-controls")!)!;
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(t.id);
      expect(panel.hidden).toBe(t.getAttribute("aria-selected") !== "true");
    }
  });

  it("gives every control of every tab a name", () => {
    setup();
    for (const t of tabs()) {
      fireEvent.click(t);
      const panel = document.getElementById(t.getAttribute("aria-controls")!)!;
      for (const control of panel.querySelectorAll("input, select, textarea")) {
        expect(named(control), `${t.textContent}: ${control.outerHTML}`).toBeTruthy();
      }
    }
  });

  it("marks the fields that are required, and groups the choices with a legend", () => {
    setup();
    expect((screen.getByLabelText(/^Título/, { selector: "input" }) as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText(/^Nota máxima/) as HTMLInputElement).required).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Questões" }));
    expect(screen.getByRole("radiogroup", { name: "Composição" })).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Participantes" }));
    expect(screen.getByRole("radiogroup", { name: "Quem faz a avaliação" })).toBeDefined();
  });

  it("says what blocks the save in text tied to the button, and the sum as a polite status", async () => {
    setup();
    const save = screen.getByRole("button", { name: "Agendar avaliação" });
    expect(save.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Questões" }));
    expect(screen.getByRole("status").getAttribute("aria-live")).not.toBe("off");
  });

  it("announces the answer of the server as an alert", async () => {
    setup({
      initial: {
        title: "Prova 1",
        moduleId: "mod-1",
        startsAt: "2026-10-23T09:00:00-03:00",
        endsAt: "2026-10-23T11:00:00-03:00",
        items: [{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 10 }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agendar avaliação" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("A soma dos pontos precisa ser igual à nota máxima.");
  });

  it("does not submit with Enter while a check is failing", () => {
    const onSubmit = vi.fn();
    setup({ onSubmit });
    fireEvent.submit(screen.getByLabelText(/^Título/, { selector: "input" }).closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
