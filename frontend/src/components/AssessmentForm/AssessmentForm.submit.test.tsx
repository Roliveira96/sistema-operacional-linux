import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { problem } from "@/test/helpers";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormInitial } from "./AssessmentForm";

afterEach(cleanup);

// A saved assessment, so the form is valid from the start and only the sending is under test.
const saved: AssessmentFormInitial = {
  title: "Prova 1",
  type: "EXAM",
  maxScore: 10,
  moduleId: "mod-1",
  startsAt: "2026-10-23T09:00:00-03:00",
  endsAt: "2026-10-23T11:00:00-03:00",
  composition: "MANUAL",
  items: [{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 10 }],
  audience: "ALL_CLASS",
};

function setup(onSubmit: () => Promise<void>) {
  render(
    <AssessmentForm
      mode="edit"
      modules={[{ id: "mod-1", title: "Permissões de arquivos" }]}
      students={[]}
      loadQuestions={vi.fn().mockResolvedValue(questions())}
      onSubmit={onSubmit}
      initial={saved}
    />,
  );
}

const save = () => screen.getByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement;
const form = () => save().closest("form")!;

// An assessment was created twice by one press of the button: a worked save unlocked the form while the page was still leaving for the next one.
describe("AssessmentForm sends once", () => {
  it("stays locked after the save worked, because the page is leaving, and a second press sends nothing", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    setup(onSubmit);

    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(save().disabled).toBe(true);
    fireEvent.click(save());
    fireEvent.submit(form()); // the Enter key in a field
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("sends once when the form is submitted twice before it can show that it is busy", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    setup(onSubmit);

    act(() => {
      fireEvent.submit(form());
      fireEvent.submit(form());
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("unlocks when the server refuses, so the teacher can try again", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(problem("weights-mismatch", 400)).mockResolvedValue(undefined);
    setup(onSubmit);

    fireEvent.click(save());
    expect((await screen.findByRole("alert")).textContent).toBe("A soma dos pontos precisa ser igual à nota máxima.");
    expect(save().disabled).toBe(false);

    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  });
});
