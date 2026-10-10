import type { Editor } from "@tiptap/react";
import { act, render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { ModuleForm } from "./ModuleForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockClasses = [
  { id: "c-1", name: "Sistemas Operacionais 1" },
  { id: "c-2", name: "Sistemas Operacionais 2" },
];

type Host = HTMLElement & { editor: Editor };

/** Types into the visual editor of the description (SPEC-010 RN-12). */
async function writeDescription(text: string) {
  const host = (await screen.findByRole("textbox", { name: "Descrição e Ementa" })) as Host;
  act(() => {
    host.editor.chain().focus().selectAll().insertContent(text).run();
  });
}

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name = "Criar Módulo") => fireEvent.click(screen.getByRole("button", { name }));

const stored = {
  id: "m-1",
  title: "Processos",
  description: "Ementa",
  slug: "processos",
  visibility: "PUBLIC" as const,
  status: "ACTIVE" as const,
  activationStart: "2026-03-01T12:00:00Z",
  activationEnd: "2026-06-01T12:00:00Z",
  assignedClassIds: [],
};

describe("ModuleForm", () => {
  it("creates a public module with no dates and no slug", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm onSubmit={onSubmit} />);

    fill(/Título do Módulo/i, "Novo Módulo de Threads");
    await writeDescription("Conceitos de concorrência");
    submit();

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        title: "Novo Módulo de Threads",
        description: "<p>Conceitos de concorrência</p>",
        slug: undefined,
        visibility: "PUBLIC",
        activationStart: undefined,
        activationEnd: undefined,
        classIds: [],
      }),
    );
  });

  it("requires a class for a private module", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm availableClasses={mockClasses} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: /Privado/ }));
    fill(/Título do Módulo/i, "Módulo Privado");
    await writeDescription("Conteúdo restrito");
    submit();

    expect(await screen.findByText("Selecione ao menos uma turma para um módulo privado.")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Sistemas Operacionais 1"));
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ visibility: "PRIVATE", classIds: ["c-1"] })));
  });

  it("blocks an end before the start and shows the message under the end field", async () => {
    const onSubmit = vi.fn();
    render(<ModuleForm onSubmit={onSubmit} />);

    fill(/Título do Módulo/i, "Datas");
    await writeDescription("Descrição");
    fill(/Início da Vigência/i, "2026-10-10T10:00");
    fill(/Término da Vigência/i, "2026-10-09T10:00");

    expect(screen.getByText("O término não pode ser anterior ao início.")).toBeDefined();
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts only a start date, or only an end date", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm onSubmit={onSubmit} />);

    fill(/Título do Módulo/i, "Só início");
    await writeDescription("Descrição");
    fill(/Início da Vigência/i, "2026-10-10T10:00");
    submit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ activationStart: new Date("2026-10-10T10:00").toISOString(), activationEnd: undefined }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Remover data: Início/ }));
    fill(/Término da Vigência/i, "2026-12-10T10:00");
    submit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({ activationStart: undefined, activationEnd: new Date("2026-12-10T10:00").toISOString() }),
      ),
    );
  });

  it("generates and validates the slug", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm onSubmit={onSubmit} />);

    fill(/Título do Módulo/i, "Fundamentos de Processos");
    fireEvent.click(screen.getByRole("button", { name: "Gerar a partir do título" }));
    expect((screen.getByLabelText(/Slug/) as HTMLInputElement).value).toBe("fundamentos-de-processos");

    fill(/Slug/, "ab");
    expect(screen.getByText("O slug precisa ter ao menos 3 caracteres.")).toBeDefined();
    await writeDescription("Descrição");
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("when editing, sends null for a cleared slug and cleared dates", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm isEditing initialData={stored} onSubmit={onSubmit} />);

    // Nothing changed yet, so there is nothing to save.
    expect((screen.getByRole("button", { name: "Salvar Alterações" }) as HTMLButtonElement).disabled).toBe(true);

    fill(/Slug/, "");
    fireEvent.click(screen.getByRole("button", { name: /Remover data: Início/ }));
    fireEvent.click(screen.getByRole("button", { name: /Remover data: Término/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Inativo/ }));
    submit("Salvar Alterações");

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ slug: null, activationStart: null, activationEnd: null, status: "INACTIVE", visibility: "PUBLIC" }),
      ),
    );
  });

  it("shows the stored dates on the wall clock and sends them back unchanged", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm isEditing initialData={stored} onSubmit={onSubmit} />);

    const start = screen.getByLabelText("Início da Vigência") as HTMLInputElement;
    const expected = new Date(stored.activationStart);
    expect(new Date(start.value).getTime()).toBe(expected.getTime() - expected.getSeconds() * 1000);

    await writeDescription("Ementa nova");
    submit("Salvar Alterações");
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ activationStart: stored.activationStart.replace("Z", ".000Z") }),
      ),
    );
  });

  it("maps server problems to the fields", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new ApiProblemError({ type: "slug-taken", title: "Slug taken" }, 409))
      .mockRejectedValueOnce(new ApiProblemError({ type: "invalid-date-range", title: "Range" }, 400));
    render(<ModuleForm isEditing initialData={stored} onSubmit={onSubmit} />);

    fill(/Slug/, "outro-slug");
    submit("Salvar Alterações");
    expect(await screen.findByText("Este slug já é usado por outro módulo. Escolha outro.")).toBeDefined();

    fill(/Slug/, "mais-um");
    submit("Salvar Alterações");
    expect(await screen.findByText("O término não pode ser anterior ao início.")).toBeDefined();
  });
});

describe("ModuleForm, the description (SPEC-010 RN-12, SPEC-019 CA-16 to CA-18)", () => {
  it("opens a description stored as plain text as paragraphs, with nothing to save", async () => {
    render(<ModuleForm isEditing initialData={{ ...stored, description: ["ls · cd — Navegar", "segunda linha"].join(String.fromCharCode(10)) }} onSubmit={vi.fn()} />);
    const editor = (await screen.findByRole("textbox", { name: "Descrição e Ementa" })) as Host;
    expect(editor.querySelectorAll("p")).toHaveLength(2);
    expect(editor.textContent).toContain("ls · cd — Navegar");
    expect((screen.getByRole("button", { name: "Salvar Alterações" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the formatted description as html, with the command mark kept", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ModuleForm onSubmit={onSubmit} />);
    fill(/Título do Módulo/i, "M");
    await writeDescription("<p>Use <code>ls</code> e <strong>cd</strong></p>");
    expect(screen.getByText("11 caracteres")).toBeDefined();
    submit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ description: "<p>Use <code>ls</code> e <strong>cd</strong></p>" })));
  });

  it("does not accept a description with nothing visible in it", async () => {
    const onSubmit = vi.fn();
    render(<ModuleForm onSubmit={onSubmit} />);
    fill(/Título do Módulo/i, "M");
    submit();
    expect(await screen.findByText("A descrição do módulo é obrigatória.")).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the limit error of the server on the description", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiProblemError({ type: "description-too-long", title: "Too long" }, 400));
    render(<ModuleForm onSubmit={onSubmit} />);
    fill(/Título do Módulo/i, "M");
    await writeDescription("texto");
    submit();
    expect(await screen.findByText("A descrição passou do limite de 20.000 caracteres.")).toBeDefined();
  });
});
