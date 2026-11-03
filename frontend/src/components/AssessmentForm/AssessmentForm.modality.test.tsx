import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormInitial, type AssessmentFormProps } from "./AssessmentForm";

afterEach(cleanup);

// An exam that could be saved as it is: the data, the period, the module and the questions are there.
const ready: AssessmentFormInitial = {
  title: "Prova 1",
  moduleId: "mod-1",
  startsAt: "2026-10-23T09:00:00-03:00",
  endsAt: "2026-10-23T11:00:00-03:00",
  items: [{ questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 10 }],
};

function setup(over: Partial<AssessmentFormProps> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const props: AssessmentFormProps = {
    mode: "create",
    modules: [{ id: "mod-1", title: "Permissões de arquivos" }],
    students: [],
    initial: ready,
    loadQuestions: vi.fn().mockResolvedValue(questions()),
    onSubmit,
    ...over,
  };
  return { ...render(<AssessmentForm {...props} />), onSubmit };
}

const modality = () => screen.getByLabelText("Modalidade") as HTMLSelectElement;
const type = (value: string) => fireEvent.change(screen.getByLabelText("Tipo da avaliação"), { target: { value } });
const save = () => screen.getByRole("button", { name: "Agendar avaliação" }) as HTMLButtonElement;

// SPEC-076 CA-18, RN-01, RN-02, with SPEC-091 CA-03 (RN-03): the modality in the form, and no requirement of the clearance any more.
describe("AssessmentForm: modality", () => {
  it("starts an exam in person, with no requirement of the clearance to set", () => {
    setup();
    expect(modality().value).toBe("IN_PERSON");
    expect(Array.from(modality().options).map((o) => o.text)).toEqual(["Presencial", "Online"]);
    expect(screen.queryByRole("checkbox", { name: /habilitação/ })).toBeNull();
  });

  it("makes an assignment online and does not let it be in person, saying why", () => {
    setup();
    type("ASSIGNMENT");
    expect(modality().value).toBe("ONLINE");
    const inPerson = Array.from(modality().options).find((o) => o.value === "IN_PERSON")!;
    expect(inPerson.disabled).toBe(true);
    const why = screen.getByText("Uma atividade só pode ser online.");
    expect(modality().getAttribute("aria-describedby")).toBe(why.id);
  });

  it("gives the exam its default back when the type goes back to exam", () => {
    setup();
    type("ASSIGNMENT");
    type("EXAM");
    expect(modality().value).toBe("IN_PERSON");
    expect(screen.queryByText("Uma atividade só pode ser online.")).toBeNull();
  });

  it("sends the modality and never the requirement", async () => {
    const { onSubmit } = setup();
    fireEvent.change(modality(), { target: { value: "ONLINE" } });
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modality: "ONLINE" })));
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("requiresClearance");
  });

  it("starts from what is saved when it edits", () => {
    setup({ mode: "edit", initial: { ...ready, type: "EXAM", modality: "ONLINE" } });
    expect(modality().value).toBe("ONLINE");
  });

  it("locks the modality from the start, with the notice, and does not send it", async () => {
    const { onSubmit } = setup({ mode: "edit", frozen: true, initial: { ...ready, modality: "IN_PERSON" } });
    expect(modality().disabled).toBe(true);
    expect(screen.getByText("A avaliação já começou; a modalidade não pode mais mudar.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("modality");
  });

  it("does not show the notice while the assessment can still change", () => {
    setup();
    expect(screen.queryByText("A avaliação já começou; a modalidade não pode mais mudar.")).toBeNull();
  });
});
