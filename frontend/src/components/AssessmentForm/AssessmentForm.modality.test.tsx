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
const requires = () => screen.queryByRole("checkbox", { name: "Exigir habilitação dos alunos" }) as HTMLInputElement | null;
const type = (value: string) => fireEvent.change(screen.getByLabelText("Tipo da avaliação"), { target: { value } });
const save = () => screen.getByRole("button", { name: "Agendar avaliação" }) as HTMLButtonElement;

// SPEC-076 CA-18, RN-01, RN-02, RN-03: the modality and the requirement of the clearance in the form.
describe("AssessmentForm: modality and clearance", () => {
  it("starts an exam in person and asking for the clearance", () => {
    setup();
    expect(modality().value).toBe("IN_PERSON");
    expect(Array.from(modality().options).map((o) => o.text)).toEqual(["Presencial", "Online"]);
    expect(requires()!.checked).toBe(true);
  });

  it("makes an assignment online, without the clearance, and does not let it be in person, saying why", () => {
    setup();
    type("ASSIGNMENT");
    expect(modality().value).toBe("ONLINE");
    expect(requires()).toBeNull();
    const inPerson = Array.from(modality().options).find((o) => o.value === "IN_PERSON")!;
    expect(inPerson.disabled).toBe(true);
    const why = screen.getByText("Uma atividade só pode ser online.");
    expect(modality().getAttribute("aria-describedby")).toBe(why.id);
  });

  it("gives the exam its defaults back when the type goes back to exam", () => {
    setup();
    type("ASSIGNMENT");
    type("EXAM");
    expect(modality().value).toBe("IN_PERSON");
    expect(requires()!.checked).toBe(true);
    expect(screen.queryByText("Uma atividade só pode ser online.")).toBeNull();
    expect(Array.from(modality().options).find((o) => o.value === "IN_PERSON")!.disabled).toBe(false);
  });

  it("offers the requirement only to an in-person assessment: an online exam has none", async () => {
    const { onSubmit } = setup();
    fireEvent.change(modality(), { target: { value: "ONLINE" } });
    expect(requires()).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modality: "ONLINE", requiresClearance: false })));
  });

  it("asks for the clearance again when the exam comes back to in person", () => {
    setup();
    fireEvent.change(modality(), { target: { value: "ONLINE" } });
    fireEvent.change(modality(), { target: { value: "IN_PERSON" } });
    expect(requires()!.checked).toBe(true);
  });

  it("lets the teacher drop the requirement of an in-person exam", async () => {
    const { onSubmit } = setup();
    fireEvent.click(requires()!);
    expect(requires()!.checked).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modality: "IN_PERSON", requiresClearance: false })));
  });

  it("sends the modality and the requirement of an exam as they are", async () => {
    const { onSubmit } = setup();
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ modality: "IN_PERSON", requiresClearance: true })));
  });

  it("starts from what is saved when it edits", () => {
    setup({ mode: "edit", initial: { ...ready, type: "EXAM", modality: "ONLINE", requiresClearance: false } });
    expect(modality().value).toBe("ONLINE");
    expect(requires()).toBeNull();
  });

  it("keeps an in-person exam that does not require the clearance as it was saved", () => {
    setup({ mode: "edit", initial: { ...ready, modality: "IN_PERSON", requiresClearance: false } });
    expect(modality().value).toBe("IN_PERSON");
    expect(requires()!.checked).toBe(false);
  });

  it("locks both fields from the start, with the notice, and sends neither", async () => {
    const { onSubmit } = setup({ mode: "edit", frozen: true, initial: { ...ready, modality: "IN_PERSON", requiresClearance: true } });
    expect(modality().disabled).toBe(true);
    expect(requires()!.disabled).toBe(true);
    expect(screen.getByText("A avaliação já começou; a modalidade não pode mais mudar.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("modality");
    expect(onSubmit.mock.calls[0]![0]).not.toHaveProperty("requiresClearance");
  });

  it("does not show the notice while the assessment can still change", () => {
    setup();
    expect(screen.queryByText("A avaliação já começou; a modalidade não pode mais mudar.")).toBeNull();
  });
});
