import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudentSummary } from "@/services/studentService";
import { AddStudentsDialog, type AddStudentsDialogProps } from "./AddStudentsDialog";

afterEach(() => {
  cleanup();
});

function student(id: string, name: string, academicId: string): StudentSummary {
  return { id, name, academicId, email: `${academicId}@alunos.utfpr.edu.br`, totalClassesEnrolled: 0, createdAt: "" };
}

const ana = student("s-1", "Ana Lima", "1000001");
const bruno = student("s-2", "Bruno Reis", "1000002");
const carla = student("s-3", "Carla Souza", "1000003");

function setup(overrides: Partial<AddStudentsDialogProps> = {}) {
  const searchStudents = vi.fn(async (search: string) => {
    const all = [ana, bruno, carla];
    const items = search ? all.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())) : all;
    return { items, totalCount: items.length, page: 1, perPage: 20 };
  });
  const enroll = vi.fn().mockResolvedValue({ enrolled: ["s-1", "s-3"], alreadyEnrolled: [], rejected: [] });
  const props: AddStudentsDialogProps = {
    isOpen: true,
    className: "Sistemas Operacionais",
    memberIds: ["s-2"],
    onClose: vi.fn(),
    onEnrolled: vi.fn(),
    onChooseNewStudent: vi.fn(),
    onChooseCsv: vi.fn(),
    searchStudents,
    enroll,
    ...overrides,
  };
  render(<AddStudentsDialog {...props} />);
  return props;
}

describe("AddStudentsDialog (SPEC-041)", () => {
  // CA-03
  it("selects students, keeps the selection across searches and shows the result of the batch", async () => {
    const props = setup();
    const dialog = screen.getByRole("dialog", { name: /Adicionar estudantes/ });

    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Ana Lima/ }));
    fireEvent.change(within(dialog).getByRole("searchbox", { name: /Buscar/ }), { target: { value: "carla" } });
    await waitFor(() => expect(props.searchStudents).toHaveBeenLastCalledWith("carla"));
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Carla Souza/ }));
    expect(within(dialog).getByText("2 selecionados")).toBeDefined();

    fireEvent.change(within(dialog).getByRole("searchbox", { name: /Buscar/ }), { target: { value: "" } });
    await waitFor(() => expect(props.searchStudents).toHaveBeenLastCalledWith(""));
    expect(((await within(dialog).findByRole("checkbox", { name: /Ana Lima/ })) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Matricular 2 estudantes" }));
    await waitFor(() => expect(props.enroll).toHaveBeenCalledWith(["s-1", "s-3"]));
    expect(props.onEnrolled).toHaveBeenCalled();
    expect(await within(dialog).findByText("2 matriculados")).toBeDefined();
  });

  it("shows those already in the class and those rejected in the result", async () => {
    const enroll = vi.fn().mockResolvedValue({
      enrolled: [],
      alreadyEnrolled: ["s-1"],
      rejected: [{ studentId: "s-3", reason: "transferred" }],
    });
    setup({ enroll, memberIds: [] });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ana Lima/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Carla Souza/ }));
    fireEvent.click(screen.getByRole("button", { name: "Matricular 2 estudantes" }));
    expect(await screen.findByText("1 já estava na turma")).toBeDefined();
    expect(screen.getByText(/Carla Souza: transferido para outra turma/)).toBeDefined();
  });

  // CA-04
  it("disables students already in the class", async () => {
    setup();
    const bruno = (await screen.findByRole("checkbox", { name: /Bruno Reis/ })) as HTMLInputElement;
    expect(bruno.disabled).toBe(true);
    expect(screen.getByText("Já na turma")).toBeDefined();
  });

  // CA-08
  it("offers the new student and the CSV paths", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Novo estudante" }));
    expect(props.onChooseNewStudent).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Importar CSV" }));
    expect(props.onChooseCsv).toHaveBeenCalled();
  });

  it("asks before closing with students selected and closes with Escape otherwise", async () => {
    const props = setup();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole("checkbox", { name: /Ana Lima/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Descartar a seleção/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("does not render when closed", () => {
    setup({ isOpen: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the error of the batch and keeps the selection", async () => {
    setup({ enroll: vi.fn().mockRejectedValue(new Error("offline")) });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ana Lima/ }));
    fireEvent.click(screen.getByRole("button", { name: "Matricular 1 estudante" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Não foi possível matricular/);
    expect((screen.getByRole("checkbox", { name: /Ana Lima/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("shows an empty list when the search fails, and names a student without a name by the e-mail", async () => {
    const searchStudents = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ items: [{ ...ana, name: "" }], totalCount: 1, page: 1, perPage: 20 });
    setup({ searchStudents });
    expect(await screen.findByText("Nenhum estudante encontrado.")).toBeDefined();
    fireEvent.change(screen.getByRole("searchbox", { name: /Buscar/ }), { target: { value: "ana" } });
    expect(await screen.findByRole("checkbox", { name: /1000001@alunos/ })).toBeDefined();
  });

  it("keeps selecting when the teacher gives up closing, and unselects a student", async () => {
    const props = setup();
    const ana = await screen.findByRole("checkbox", { name: /Ana Lima/ });
    fireEvent.click(ana);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Continuar selecionando" }));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(ana);
    expect(screen.getByText("0 selecionados")).toBeDefined();
  });

  it("closes with Concluir after the result", async () => {
    const props = setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Ana Lima/ }));
    fireEvent.click(screen.getByRole("button", { name: "Matricular 1 estudante" }));
    fireEvent.click(await screen.findByRole("button", { name: "Concluir" }));
    expect(props.onClose).toHaveBeenCalled();
  });
});
