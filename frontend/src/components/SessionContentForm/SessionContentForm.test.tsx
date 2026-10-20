import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";
import { scheduleService, type Session, type SessionContent } from "@/services/scheduleService";
import { SessionContentForm } from "./SessionContentForm";

const readPdfInfo = vi.fn();
vi.mock("@/components/Classroom/SlidePresenter/pdfRenderer", () => ({ readPdfInfo: (file: File) => readPdfInfo(file) }));

const lesson: Session = {
  id: "s-26",
  classId: "c-1",
  date: "2026-10-26",
  startTime: "08:20",
  endTime: "10:00",
  lessonCount: 2,
  mode: "IN_PERSON",
  status: "SCHEDULED",
  origin: "WEEKLY",
  overridden: false,
  onHoliday: false,
};

const modules = [
  { id: "m-1", title: "Linux na prática" },
  { id: "m-2", title: "Redes" },
] as CourseModuleSummary[];

const saved: SessionContent = {
  topic: "Permissões de arquivos",
  description: "<p>Veremos chmod.</p>",
  module: { id: "m-1", title: "Linux na prática" },
  links: [{ name: "Meet", url: "https://meet.google.com/abc", position: 0 }],
};

function setup(content: SessionContent = { links: [] }) {
  vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: modules, total: 2, page: 1, limit: 100 });
  const listDecks = vi.spyOn(classroomService, "listDecks").mockResolvedValue([]);
  vi.spyOn(scheduleService, "materials").mockResolvedValue([]);
  const get = vi.spyOn(scheduleService, "getSessionContent").mockResolvedValue(content);
  const save = vi.spyOn(scheduleService, "saveSessionContent").mockResolvedValue(content);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<SessionContentForm classId="c-1" session={lesson} onSaved={onSaved} onClose={onClose} />);
  return { get, save, listDecks, onSaved, onClose };
}

async function ready() {
  return screen.findByRole("dialog", { name: "Conteúdo da aula de 26/10/2026" });
}

beforeEach(() => {
  readPdfInfo.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-053, section 3.1 (CA-09)
describe("SessionContentForm", () => {
  it("opens with the content of the lesson already filled in", async () => {
    const { get } = setup(saved);
    const dialog = await ready();
    expect(get).toHaveBeenCalledWith("c-1", "s-26");
    await waitFor(() => expect((within(dialog).getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    expect(within(dialog).getByText("Meet")).toBeDefined();
    expect(within(dialog).getByText("https://meet.google.com/abc")).toBeDefined();
    await waitFor(() => expect((within(dialog).getByLabelText("Módulo de ensino") as HTMLSelectElement).value).toBe("m-1"));
    expect(within(dialog).getByRole("textbox", { name: "Descrição do conteúdo" }).textContent).toContain("Veremos chmod.");
  });

  it("lists the modules the teacher can use, with none as an option", async () => {
    setup();
    const dialog = await ready();
    const select = (await within(dialog).findByLabelText("Módulo de ensino")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Nenhum", "Linux na prática", "Redes"]));
  });

  it("saves the topic, the module and the links at once and closes", async () => {
    const { save, onSaved, onClose } = setup(saved);
    const dialog = await ready();
    await waitFor(() => expect((within(dialog).getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    fireEvent.change(within(dialog).getByLabelText("Tema"), { target: { value: "  Usuários e grupos " } });
    fireEvent.change(within(dialog).getByLabelText("Módulo de ensino"), { target: { value: "m-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // the notes of the teacher go along, empty when there are none (SPEC-073 CA-10)
    expect(save).toHaveBeenCalledWith("c-1", "s-26", {
      topic: "Usuários e grupos",
      description: "<p>Veremos chmod.</p>",
      moduleId: "m-2",
      links: [{ name: "Meet", url: "https://meet.google.com/abc" }],
      teacherNotes: "",
      teacherPrivateNotes: "",
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears what is emptied: no module, no links, no topic", async () => {
    const { save } = setup(saved);
    const dialog = await ready();
    await waitFor(() => expect((within(dialog).getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    fireEvent.change(within(dialog).getByLabelText("Tema"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Módulo de ensino"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover link: Meet" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.lastCall?.[2]).toEqual({ topic: "", description: "<p>Veremos chmod.</p>", moduleId: "", links: [], teacherNotes: "", teacherPrivateNotes: "" });
  });

  it("refuses a topic of more than 120 characters next to the field, without calling the server", async () => {
    const { save } = setup();
    const dialog = await ready();
    const topic = within(dialog).getByLabelText("Tema");
    fireEvent.change(topic, { target: { value: "a".repeat(121) } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(within(dialog).getByText("O tema pode ter até 120 caracteres.")).toBeDefined();
    expect(topic.getAttribute("aria-invalid")).toBe("true");
    expect(save).not.toHaveBeenCalled();
  });

  it("adds a link after checking the name and the https address next to each field", async () => {
    setup();
    const dialog = await ready();
    const inLinks = within(within(dialog).getByRole("group", { name: "Links da aula" }));
    fireEvent.click(inLinks.getByRole("button", { name: "Adicionar link" }));
    expect(inLinks.getByText("Informe o nome do link.")).toBeDefined();
    fireEvent.change(inLinks.getByLabelText("Nome do link"), { target: { value: "Slides" } });
    fireEvent.change(inLinks.getByLabelText("Endereço do link"), { target: { value: "http://x.com" } });
    fireEvent.click(inLinks.getByRole("button", { name: "Adicionar link" }));
    expect(inLinks.getByText("O endereço deve começar com https://.")).toBeDefined();
    fireEvent.change(inLinks.getByLabelText("Endereço do link"), { target: { value: " https://slides.example.com/a " } });
    fireEvent.click(inLinks.getByRole("button", { name: "Adicionar link" }));
    expect(inLinks.getByText("https://slides.example.com/a")).toBeDefined();
    expect((inLinks.getByLabelText("Nome do link") as HTMLInputElement).value).toBe("");
  });

  it("stops at 10 links", async () => {
    const links = Array.from({ length: 10 }, (_, i) => ({ name: `L${i}`, url: `https://a.com/${i}`, position: i }));
    setup({ links });
    const dialog = await ready();
    const inLinks = within(within(dialog).getByRole("group", { name: "Links da aula" }));
    await inLinks.findByText("L9");
    fireEvent.change(inLinks.getByLabelText("Nome do link"), { target: { value: "Mais um" } });
    fireEvent.change(inLinks.getByLabelText("Endereço do link"), { target: { value: "https://a.com/x" } });
    fireEvent.click(inLinks.getByRole("button", { name: "Adicionar link" }));
    expect(inLinks.getByText("Uma aula pode ter até 10 links.")).toBeDefined();
    expect(inLinks.queryByText("Mais um")).toBeNull();
  });

  it("puts the problems of the server on the field or at the top, and keeps the dialog open", async () => {
    const { save, onClose } = setup();
    const dialog = await ready();
    save.mockRejectedValueOnce(new ApiProblemError({ type: "invalid-session-content", status: 400, field: "topic" }, 400));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Tema").getAttribute("aria-invalid")).toBe("true"));

    save.mockRejectedValueOnce(new ApiProblemError({ type: "module-not-found", status: 404 }, 404));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/módulo não está mais disponível/));

    save.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/Não foi possível salvar o conteúdo/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables the buttons while it saves", async () => {
    const { save } = setup();
    const dialog = await ready();
    let finish: (c: SessionContent) => void = () => {};
    save.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    const busy = await within(dialog).findByRole("button", { name: "Salvando…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish({ links: [] });
  });

  it("closes with Cancel and with Escape", async () => {
    const { onClose } = setup();
    const dialog = await ready();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("explains when the content cannot be loaded and tries again", async () => {
    vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    const get = vi.spyOn(scheduleService, "getSessionContent").mockRejectedValueOnce(new Error("down")).mockResolvedValue(saved);
    render(<SessionContentForm classId="c-1" session={lesson} onSaved={vi.fn()} onClose={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Não foi possível carregar o conteúdo/);
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect((screen.getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    expect(get).toHaveBeenCalledTimes(2);
  });

});

// SPEC-073 CA-10: the notes of the teacher in the dialog of the content
describe("notes of the teacher (SPEC-073)", () => {
  it("opens with the notes filled in, saves them with the content and closes", async () => {
    const { save, onSaved } = setup({ ...saved, teacherNotes: "<p>Vimos chmod.</p>", teacherPrivateNotes: "<p>Rever o fork.</p>" });
    const dialog = await ready();
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Anotações da aula (a turma vê)" }).textContent).toContain("Vimos chmod."));
    expect(within(dialog).getByRole("textbox", { name: "Anotações privadas (só você vê)" }).textContent).toContain("Rever o fork.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.lastCall?.[2]).toMatchObject({ topic: "Permissões de arquivos", teacherNotes: "<p>Vimos chmod.</p>", teacherPrivateNotes: "<p>Rever o fork.</p>" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("sends empty notes when there are none, and puts a note over the limit next to its field", async () => {
    const { save, onClose } = setup(saved);
    const dialog = await ready();
    await waitFor(() => expect((within(dialog).getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.lastCall?.[2]).toMatchObject({ teacherNotes: "", teacherPrivateNotes: "" });

    save.mockRejectedValueOnce(new ApiProblemError({ type: "content-too-long", status: 400, field: "teacherPrivateNotes" }, 400));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("As anotações podem ter até 20.000 caracteres.")).toBeDefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// SPEC-073 CA-10: each of the three editors shows its name and says who reads what is written in it
describe("labels and help of the editors (SPEC-073 CA-10)", () => {
  const editors = [
    { name: "Descrição do conteúdo", hint: "A turma vê este texto na agenda da turma." },
    { name: "Anotações da aula (a turma vê)", hint: "Registro do que aconteceu na aula: a turma vê assim que você salvar." },
    { name: "Anotações privadas (só você vê)", hint: "Lembretes seus sobre esta aula. Nenhum estudante vê." },
  ];

  it("shows the name of each editor on the screen, and not only to the screen reader", async () => {
    setup();
    const dialog = await ready();
    for (const { name } of editors) {
      // the editor has a label of its own for the screen reader; the one on the screen is the other (the editors open a moment after the dialog)
      await waitFor(() => expect(within(dialog).getAllByText(name), name).toHaveLength(2));
    }
  });

  it("tells who reads what is written, and ties that line to the editor", async () => {
    setup();
    const dialog = await ready();
    for (const { name, hint } of editors) {
      const line = within(dialog).getByText(hint);
      expect(line.id, name).not.toBe("");
      expect((await within(dialog).findByRole("textbox", { name })).getAttribute("aria-describedby"), name).toBe(line.id);
    }
  });

  it("gives each editor a different line, so the three are not alike", async () => {
    setup();
    const dialog = await ready();
    const ids = editors.map(({ hint }) => within(dialog).getByText(hint).id);
    expect(new Set(ids).size).toBe(3);
  });
});

// SPEC-074 CA-10: the materials of the lesson, in four areas, by the phase in which the class sees them
describe("SessionContentForm: materials (SPEC-074 CA-10)", () => {
  it("has the section of the materials with one area for each phase, and reads the materials of the lesson", async () => {
    setup(saved);
    const dialog = await ready();
    expect(await within(dialog).findByRole("heading", { level: 3, name: "Materiais da aula" })).toBeDefined();
    expect(scheduleService.materials).toHaveBeenCalledWith("c-1", "s-26");
    await within(dialog).findByRole("heading", { level: 4, name: "Sempre visível" });
    expect(within(dialog).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Sempre visível",
      "Só durante a aula",
      "Durante e depois da aula",
      "Só depois da aula",
    ]);
    expect(within(dialog).getAllByLabelText("Escolher arquivos")).toHaveLength(4);
  });

  it("does not save the materials with the content: they are saved on the spot", async () => {
    const { save } = setup(saved);
    const dialog = await ready();
    await waitFor(() => expect((within(dialog).getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.keys(save.mock.calls[0]![2])).not.toContain("materials");
  });
});

// SPEC-074 D-08 and CA-18: the presentation left the dialog; the files of the lesson are the materials, and the room projects one of them
describe("SessionContentForm: without a presentation (SPEC-074 CA-18)", () => {
  it("has no field for a presentation and no area to send a PDF, and does not ask for the presentations of the class", async () => {
    const { listDecks } = setup(saved);
    const dialog = await ready();
    await within(dialog).findByRole("heading", { level: 3, name: "Materiais da aula" });
    expect(within(dialog).queryByLabelText("Apresentação (PDF)")).toBeNull();
    expect(within(dialog).queryByLabelText("Enviar PDF")).toBeNull();
    expect(within(dialog).queryByText(/Arraste o PDF aqui/)).toBeNull();
    expect(within(dialog).queryByText(/É a que você projeta/)).toBeNull();
    expect(listDecks).not.toHaveBeenCalled();
  });

  it("saves the content without a presentation, even if the server still brought one", async () => {
    const stale = { ...saved, deck: { id: "d-1", title: "Slides 1", pageCount: 12, downloadUrl: "https://minio/d-1.pdf" } } as unknown as SessionContent;
    const { save } = setup(stale);
    const dialog = await ready();
    await waitFor(() => expect((within(dialog).getByLabelText("Tema") as HTMLInputElement).value).toBe("Permissões de arquivos"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(Object.keys(save.mock.calls[0]![2]).sort()).toEqual(["description", "links", "moduleId", "teacherNotes", "teacherPrivateNotes", "topic"]);
  });
});
