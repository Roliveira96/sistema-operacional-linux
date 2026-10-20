import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import type { MaterialInput, SessionMaterial } from "@/services/scheduleService";
import { SessionMaterials } from "./SessionMaterials";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const material = (over: Partial<SessionMaterial> & Pick<SessionMaterial, "id" | "title" | "visibility">): SessionMaterial => ({
  position: 0,
  kind: "REFERENCE",
  releaseAt: null,
  source: "LINK",
  url: "https://example.com/doc",
  visibleNow: true,
  ...over,
});

const initial: SessionMaterial[] = [
  material({ id: "a", position: 0, title: "Roteiro", kind: "SLIDES", visibility: "ALWAYS", source: "FILE", url: undefined, fileName: "roteiro.pdf", contentType: "application/pdf", sizeBytes: 2 * 1024 * 1024, pageCount: 12 }),
  material({ id: "b", position: 1, title: "Lista 1", kind: "EXERCISES", visibility: "DURING_CLASS", visibleNow: false, hiddenUntil: "CLASS_START" }),
  material({ id: "c", position: 2, title: "Resolução", kind: "EXERCISE_SOLUTION", visibility: "AFTER_CLASS", visibleNow: false, hiddenUntil: "CLASS_END", url: "https://docs.example.org/res" }),
  material({ id: "d", position: 3, title: "Apoio", kind: "REFERENCE", visibility: "DURING_AND_AFTER", visibleNow: false, hiddenUntil: "2026-10-19T11:00:00-03:00", releaseAt: "2026-10-19T11:00:00-03:00" }),
  material({ id: "e", position: 4, title: "Lista 2", kind: "EXERCISES", visibility: "DURING_CLASS", visibleNow: false, hiddenUntil: "CLASS_START" }),
];

function fakeService(start: SessionMaterial[] = initial) {
  let list = start.map((m) => ({ ...m }));
  let next = 0;
  const service = {
    materials: vi.fn(async () => list.map((m) => ({ ...m }))),
    addFileMaterial: vi.fn(async (_c: string, _s: string, file: File, input: MaterialInput, pages?: number) => {
      const created = material({ id: `new-${next++}`, position: list.length, title: input.title, kind: input.kind, visibility: input.visibility, source: "FILE", url: undefined, fileName: file.name, contentType: file.type, sizeBytes: file.size, pageCount: pages ?? 1 });
      list = [...list, created];
      return created;
    }),
    addLinkMaterial: vi.fn(async (_c: string, _s: string, input: MaterialInput & { url: string }) => {
      const created = material({ id: `new-${next++}`, position: list.length, title: input.title, kind: input.kind, visibility: input.visibility, url: input.url });
      list = [...list, created];
      return created;
    }),
    updateMaterial: vi.fn(async (_c: string, _s: string, id: string, patch: Partial<SessionMaterial>) => {
      list = list.map((m) => (m.id === id ? { ...m, ...patch } : m));
      return list.find((m) => m.id === id)!;
    }),
    releaseMaterial: vi.fn(async (_c: string, _s: string, id: string) => {
      list = list.map((m) => (m.id === id ? { ...m, visibleNow: true, hiddenUntil: undefined, releaseAt: "2026-10-19T09:00:00-03:00" } : m));
      return list.find((m) => m.id === id)!;
    }),
    deleteMaterial: vi.fn(async (_c: string, _s: string, id: string) => {
      list = list.filter((m) => m.id !== id);
    }),
  };
  return { service, set: (next: SessionMaterial[]) => (list = next) };
}

const readPdf = vi.fn(async () => ({ pageCount: 7 }));

async function setup(start: SessionMaterial[] = initial) {
  readPdf.mockClear();
  const fake = fakeService(start);
  render(<SessionMaterials classId="c-1" sessionId="s-26" service={fake.service} readPdf={readPdf} />);
  await screen.findByRole("heading", { name: "Sempre visível" });
  return fake;
}

const zone = (name: string) => screen.getByRole("region", { name });
const row = (title: string) => screen.getByRole("group", { name: title });
const pdf = (name = "lista.pdf", size = 1024) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const png = (name = "quadro.png") => new File([new Uint8Array(10)], name, { type: "image/png" });

const ZONES = ["Sempre visível", "Só durante a aula", "Durante e depois da aula", "Só depois da aula"];

// SPEC-074 CA-10: the section of the materials, with one area for each phase
describe("SessionMaterials: the four areas (SPEC-074 CA-10)", () => {
  it("has one area for each phase, in the order of the phases, each with the materials of its phase in the order of the teacher", async () => {
    await setup();
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(ZONES);
    expect(within(zone("Sempre visível")).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Roteiro"]);
    expect(within(zone("Só durante a aula")).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Lista 1", "Lista 2"]);
    expect(within(zone("Durante e depois da aula")).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Apoio"]);
    expect(within(zone("Só depois da aula")).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Resolução"]);
  });

  it("says what each phase means, and has the way to send a file and to add a link in each", async () => {
    await setup();
    for (const name of ZONES) {
      const area = zone(name);
      expect(within(area).getByText("Solte os arquivos aqui")).toBeDefined();
      expect(within(area).getByLabelText("Escolher arquivos")).toBeDefined();
      expect(within(area).getByRole("button", { name: "Adicionar link" })).toBeDefined();
    }
    expect(within(zone("Só depois da aula")).getByText(/Bom para a resolução dos exercícios/)).toBeDefined();
  });

  it("shows what each material is: the file with its size and pages, the link with its site, and why it is hidden", async () => {
    await setup();
    expect(within(row("Roteiro")).getByText(/roteiro\.pdf/)).toBeDefined();
    expect(within(row("Roteiro")).getByText(/2,0 MB/)).toBeDefined();
    expect(within(row("Roteiro")).getByText(/12 páginas/)).toBeDefined();
    expect(within(row("Resolução")).getByText(/docs\.example\.org/)).toBeDefined();
    expect(within(row("Roteiro")).queryByText(/Oculto/)).toBeNull();
    expect(within(row("Lista 1")).getByText("Oculto até o início da aula")).toBeDefined();
    expect(within(row("Resolução")).getByText("Oculto até o fim da aula")).toBeDefined();
    expect(within(row("Apoio")).getByText("Oculto até 19/10 11:00")).toBeDefined();
  });

  it("tells the reasons of a lesson that is over or canceled", async () => {
    await setup([
      material({ id: "x", position: 0, title: "Só na hora", visibility: "DURING_CLASS", visibleNow: false, hiddenUntil: "CLASS_OVER" }),
      material({ id: "y", position: 1, title: "Cancelada", visibility: "AFTER_CLASS", visibleNow: false, hiddenUntil: "CLASS_CANCELED" }),
    ]);
    expect(within(row("Só na hora")).getByText("Oculto: a aula já terminou")).toBeDefined();
    expect(within(row("Cancelada")).getByText("Oculto: a aula foi cancelada")).toBeDefined();
  });

  it("tells when the materials cannot be read, and reads them again", async () => {
    const fake = fakeService();
    fake.service.materials.mockRejectedValueOnce(new Error("down"));
    render(<SessionMaterials classId="c-1" sessionId="s-26" service={fake.service} readPdf={readPdf} />);
    expect(await screen.findByText("Não foi possível carregar os materiais da aula.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { name: "Sempre visível" })).toBeDefined();
    expect(fake.service.materials).toHaveBeenCalledTimes(2);
  });
});

describe("SessionMaterials: sending files by the button (SPEC-074 CA-10)", () => {
  it("sends a PDF to the phase of the area, with the pages the browser read and the title from the name of the file", async () => {
    const { service } = await setup();
    const file = pdf("Lista de exercícios 3.pdf");
    fireEvent.change(within(zone("Só durante a aula")).getByLabelText("Escolher arquivos"), { target: { files: [file] } });
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(1));
    expect(readPdf).toHaveBeenCalledWith(file);
    expect(service.addFileMaterial).toHaveBeenCalledWith("c-1", "s-26", file, { title: "Lista de exercícios 3", kind: "EXERCISES", visibility: "DURING_CLASS" }, 7);
    expect(await within(zone("Só durante a aula")).findByRole("group", { name: "Lista de exercícios 3" })).toBeDefined();
  });

  it("sends an image with no page count, and starts the kind from the phase of the area", async () => {
    const { service } = await setup();
    const expected: Array<[string, string]> = [
      ["Sempre visível", "SLIDES"],
      ["Só durante a aula", "EXERCISES"],
      ["Durante e depois da aula", "EXERCISES"],
      ["Só depois da aula", "EXERCISE_SOLUTION"],
    ];
    for (const [name, kind] of expected) {
      fireEvent.change(within(zone(name)).getByLabelText("Escolher arquivos"), { target: { files: [png(`${kind}.png`)] } });
      await waitFor(() => expect(service.addFileMaterial).toHaveBeenLastCalledWith("c-1", "s-26", expect.any(File), expect.objectContaining({ kind }), undefined));
    }
    expect(readPdf).not.toHaveBeenCalled();
  });

  it("sends several files in the order they were chosen, one after the other, each with its state", async () => {
    const { service } = await setup([]);
    const releases: Array<() => void> = [];
    service.addFileMaterial.mockImplementation(
      (_c, _s, file, input) =>
        new Promise((resolve) => {
          releases.push(() => resolve(material({ id: file.name, position: 0, title: input.title, visibility: input.visibility, source: "FILE", url: undefined, fileName: file.name })));
        }),
    );
    fireEvent.change(within(zone("Sempre visível")).getByLabelText("Escolher arquivos"), { target: { files: [png("um.png"), png("dois.png"), png("tres.png")] } });

    const area = zone("Sempre visível");
    expect(await within(area).findAllByText("Enviando…")).toHaveLength(3);
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(1));
    expect(service.addFileMaterial.mock.calls[0]![2].name).toBe("um.png");
    releases[0]!();
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(2));
    expect(service.addFileMaterial.mock.calls[1]![2].name).toBe("dois.png");
    expect(within(area).getAllByText("Enviando…")).toHaveLength(2);
    releases[1]!();
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(3));
    releases[2]!();
    await waitFor(() => expect(within(area).queryByText("Enviando…")).toBeNull());
    expect(within(area).getAllByRole("group")).toHaveLength(3);
  });

  it("refuses in the browser what is not a PDF or an image, what is too big and a PDF it cannot read, and goes on with the others", async () => {
    const { service } = await setup([]);
    readPdf.mockRejectedValueOnce(new Error("password"));
    const area = zone("Sempre visível");
    const files = [
      new File(["x"], "notas.txt", { type: "text/plain" }),
      pdf("grande.pdf", 26 * 1024 * 1024),
      new File([new Uint8Array(11 * 1024 * 1024)], "foto.png", { type: "image/png" }),
      pdf("protegido.pdf"),
      png("ok.png"),
    ];
    fireEvent.change(within(area).getByLabelText("Escolher arquivos"), { target: { files } });

    expect(await within(area).findByText(/notas\.txt/)).toBeDefined();
    expect(within(area).getByText("Formato não aceito. Envie um PDF ou uma imagem PNG, JPEG ou WebP.")).toBeDefined();
    expect(within(area).getByText("O PDF pode ter até 25 MB.")).toBeDefined();
    expect(within(area).getByText("A imagem pode ter até 10 MB.")).toBeDefined();
    expect(await within(area).findByText("Não foi possível ler o PDF. Ele pode estar corrompido ou protegido por senha.")).toBeDefined();
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(1));
    expect(service.addFileMaterial.mock.calls[0]![2].name).toBe("ok.png");

    readPdf.mockResolvedValueOnce({ pageCount: 101 });
    fireEvent.change(within(area).getByLabelText("Escolher arquivos"), { target: { files: [pdf("longo.pdf")] } });
    expect(await within(area).findByText("O PDF pode ter até 100 páginas.")).toBeDefined();
    expect(service.addFileMaterial).toHaveBeenCalledTimes(1);
  });

  it("shows the problem of the server next to the file, can dismiss it, and keeps sending the others", async () => {
    const { service } = await setup([]);
    service.addFileMaterial.mockRejectedValueOnce(new ApiProblemError({ type: "material-limit-exceeded", title: "x", status: 409 }, 409));
    service.addFileMaterial.mockRejectedValueOnce(new ApiProblemError({ type: "file-too-large", title: "x", status: 413 }, 413));
    service.addFileMaterial.mockRejectedValueOnce(new Error("offline"));
    const area = zone("Sempre visível");
    fireEvent.change(within(area).getByLabelText("Escolher arquivos"), { target: { files: [png("a.png"), png("b.png"), png("c.png"), png("d.png")] } });

    expect(await within(area).findByText("Esta aula já tem 50 materiais.")).toBeDefined();
    expect(await within(area).findByText("O arquivo passa do limite do formato (25 MB para PDF, 10 MB para imagem).")).toBeDefined();
    expect(await within(area).findByText("Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.")).toBeDefined();
    await waitFor(() => expect(within(area).getAllByRole("group")).toHaveLength(1));
    fireEvent.click(within(area).getAllByRole("button", { name: "Dispensar" })[0]!);
    expect(within(area).queryByText("Esta aula já tem 50 materiais.")).toBeNull();
  });
});

// SPEC-074 CA-13: dragging and dropping
describe("SessionMaterials: dragging and dropping files (SPEC-074 CA-13)", () => {
  const files = (list: File[]) => ({ dataTransfer: { files: list, types: ["Files"] } });

  it("highlights the area under the file, and only that one, and goes back when the file leaves", async () => {
    await setup();
    const during = zone("Só durante a aula");
    expect(within(during).queryByText("Solte para enviar")).toBeNull();
    fireEvent.dragEnter(during, files([pdf()]));
    expect(within(during).getByText("Solte para enviar")).toBeDefined();
    expect(within(zone("Sempre visível")).queryByText("Solte para enviar")).toBeNull();
    fireEvent.dragLeave(during, { ...files([pdf()]), relatedTarget: document.body });
    expect(within(during).queryByText("Solte para enviar")).toBeNull();
    expect(within(during).getByText("Solte os arquivos aqui")).toBeDefined();
  });

  it("does not highlight for what is dragged and is not a file", async () => {
    await setup();
    fireEvent.dragEnter(zone("Sempre visível"), { dataTransfer: { files: [], types: ["text/plain"] } });
    expect(within(zone("Sempre visível")).queryByText("Solte para enviar")).toBeNull();
  });

  it("sends the files dropped on an area as materials of the phase of that area", async () => {
    const { service } = await setup();
    const during = zone("Só depois da aula");
    fireEvent.dragEnter(during, files([pdf("resolucao.pdf"), png("gabarito.png")]));
    fireEvent.drop(during, files([pdf("resolucao.pdf"), png("gabarito.png")]));
    expect(within(during).queryByText("Solte para enviar")).toBeNull();

    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(2));
    expect(service.addFileMaterial.mock.calls[0]![3]).toEqual({ title: "resolucao", kind: "EXERCISE_SOLUTION", visibility: "AFTER_CLASS" });
    expect(service.addFileMaterial.mock.calls[0]![4]).toBe(7);
    expect(service.addFileMaterial.mock.calls[1]![3]).toEqual({ title: "gabarito", kind: "EXERCISE_SOLUTION", visibility: "AFTER_CLASS" });
    expect(await within(during).findByRole("group", { name: "gabarito" })).toBeDefined();
  });

  it("refuses the file that is not valid, shows it next to it, and sends the others dropped with it", async () => {
    const { service } = await setup();
    const area = zone("Sempre visível");
    fireEvent.drop(area, files([new File(["x"], "video.mp4", { type: "video/mp4" }), png("ok.png")]));
    expect(await within(area).findByText(/video\.mp4/)).toBeDefined();
    expect(within(area).getByText("Formato não aceito. Envie um PDF ou uma imagem PNG, JPEG ou WebP.")).toBeDefined();
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(1));
  });

  it("keeps the browser from opening a file dropped outside the areas, while the section is on the screen", async () => {
    await setup();
    const over = fireEvent.dragOver(document.body, files([pdf()]));
    const dropped = fireEvent.drop(document.body, files([pdf()]));
    expect(over).toBe(false);
    expect(dropped).toBe(false);
    cleanup();
    expect(fireEvent.drop(document.body, files([pdf()]))).toBe(true);
  });

  it("lets what is not a file be dragged as it always was", async () => {
    await setup();
    expect(fireEvent.drop(document.body, { dataTransfer: { files: [], types: ["text/plain"] } })).toBe(true);
  });
});

describe("SessionMaterials: links (SPEC-074 CA-02, CA-10)", () => {
  it("adds a link to the phase of the area, with the kind that starts the phase", async () => {
    const { service } = await setup();
    const area = zone("Só durante a aula");
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar link" }));
    fireEvent.change(within(area).getByLabelText("Título do link"), { target: { value: "Documentação" } });
    fireEvent.change(within(area).getByLabelText("Endereço do link"), { target: { value: " https://example.com/doc " } });
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(service.addLinkMaterial).toHaveBeenCalledTimes(1));
    expect(service.addLinkMaterial).toHaveBeenCalledWith("c-1", "s-26", { url: "https://example.com/doc", title: "Documentação", kind: "EXERCISES", visibility: "DURING_CLASS" });
    expect(await within(area).findByRole("group", { name: "Documentação" })).toBeDefined();
    expect(within(area).queryByLabelText("Título do link")).toBeNull();
  });

  it("checks the title and the address before sending, and leaves the form for who gives up", async () => {
    const { service } = await setup();
    const area = zone("Sempre visível");
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar link" }));
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar" }));
    expect(within(area).getByText("Informe o título do material.")).toBeDefined();
    expect(within(area).getByText("Informe o endereço do link.")).toBeDefined();
    fireEvent.change(within(area).getByLabelText("Título do link"), { target: { value: "x" } });
    fireEvent.change(within(area).getByLabelText("Endereço do link"), { target: { value: "http://example.com" } });
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar" }));
    expect(within(area).getByText("O endereço deve começar com https://.")).toBeDefined();
    expect(service.addLinkMaterial).not.toHaveBeenCalled();
    fireEvent.click(within(area).getByRole("button", { name: "Cancelar" }));
    expect(within(area).queryByLabelText("Título do link")).toBeNull();
  });

  it("shows the problem of the server on the form of the link", async () => {
    const { service } = await setup();
    service.addLinkMaterial.mockRejectedValueOnce(new ApiProblemError({ type: "material-limit-exceeded", title: "x", status: 409 }, 409));
    const area = zone("Sempre visível");
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar link" }));
    fireEvent.change(within(area).getByLabelText("Título do link"), { target: { value: "x" } });
    fireEvent.change(within(area).getByLabelText("Endereço do link"), { target: { value: "https://example.com" } });
    fireEvent.click(within(area).getByRole("button", { name: "Adicionar" }));
    expect(await within(area).findByText("Esta aula já tem 50 materiais.")).toBeDefined();
  });
});

describe("SessionMaterials: editing a material, saved on the spot (SPEC-074 CA-03, CA-05, CA-10)", () => {
  it("saves the title when the field is left, and only when it changed", async () => {
    const { service } = await setup();
    const title = within(row("Roteiro")).getByLabelText("Título") as HTMLInputElement;
    fireEvent.blur(title);
    expect(service.updateMaterial).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: "  Roteiro novo  " } });
    fireEvent.blur(title);
    await waitFor(() => expect(service.updateMaterial).toHaveBeenCalledWith("c-1", "s-26", "a", { title: "Roteiro novo" }));
    expect(await screen.findByRole("group", { name: "Roteiro novo" })).toBeDefined();
  });

  it("does not save an empty title, and says so on the material", async () => {
    const { service } = await setup();
    const title = within(row("Roteiro")).getByLabelText("Título") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.blur(title);
    expect(within(row("Roteiro")).getByText("Informe o título do material (até 120 caracteres).")).toBeDefined();
    expect(service.updateMaterial).not.toHaveBeenCalled();
  });

  it("saves the kind when it is chosen", async () => {
    const { service } = await setup();
    const kind = within(row("Roteiro")).getByLabelText("Tipo") as HTMLSelectElement;
    expect(Array.from(kind.options).map((o) => o.textContent)).toEqual(["Slides", "Exercícios", "Resolução dos exercícios", "Referência"]);
    expect(kind.value).toBe("SLIDES");
    fireEvent.change(kind, { target: { value: "REFERENCE" } });
    await waitFor(() => expect(service.updateMaterial).toHaveBeenCalledWith("c-1", "s-26", "a", { kind: "REFERENCE" }));
  });

  it("moves the material to the area of the phase that is chosen", async () => {
    const { service } = await setup();
    const phase = within(row("Roteiro")).getByLabelText("Fase") as HTMLSelectElement;
    expect(Array.from(phase.options).map((o) => o.textContent)).toEqual(ZONES);
    fireEvent.change(phase, { target: { value: "AFTER_CLASS" } });
    await waitFor(() => expect(service.updateMaterial).toHaveBeenCalledWith("c-1", "s-26", "a", { visibility: "AFTER_CLASS" }));
    await waitFor(() => expect(within(zone("Só depois da aula")).getByRole("group", { name: "Roteiro" })).toBeDefined());
    expect(within(zone("Sempre visível")).queryByRole("group", { name: "Roteiro" })).toBeNull();
  });

  it("has the release only in the phases that include the time after the lesson, saves it, when the field is left, with the offset of the school, and clears it", async () => {
    const { service } = await setup();
    expect(within(row("Roteiro")).queryByLabelText("Liberar em")).toBeNull();
    expect(within(row("Lista 1")).queryByLabelText("Liberar em")).toBeNull();
    const release = within(row("Resolução")).getByLabelText("Liberar em") as HTMLInputElement;
    expect(release.type).toBe("datetime-local");
    expect(release.value).toBe("");
    expect((within(row("Apoio")).getByLabelText("Liberar em") as HTMLInputElement).value).toBe("2026-10-19T11:00");

    fireEvent.change(release, { target: { value: "2026-10-20T14:30" } });
    expect(service.updateMaterial).not.toHaveBeenCalled(); // typing is not saving: it is saved when the field is left
    fireEvent.blur(release);
    await waitFor(() => expect(service.updateMaterial).toHaveBeenCalledWith("c-1", "s-26", "c", { releaseAt: "2026-10-20T14:30:00-03:00" }));
    const apoio = within(row("Apoio")).getByLabelText("Liberar em");
    fireEvent.change(apoio, { target: { value: "" } });
    fireEvent.blur(apoio);
    await waitFor(() => expect(service.updateMaterial).toHaveBeenCalledWith("c-1", "s-26", "d", { releaseAt: null }));
  });

  it("releases a hidden material now, and only a hidden one can be", async () => {
    const { service } = await setup();
    expect(within(row("Roteiro")).queryByRole("button", { name: "Liberar agora" })).toBeNull();
    fireEvent.click(within(row("Resolução")).getByRole("button", { name: "Liberar agora" }));
    await waitFor(() => expect(service.releaseMaterial).toHaveBeenCalledWith("c-1", "s-26", "c"));
    await waitFor(() => expect(within(row("Resolução")).queryByText("Oculto até o fim da aula")).toBeNull());
    expect(within(row("Resolução")).queryByRole("button", { name: "Liberar agora" })).toBeNull();
  });

  it("moves a material up and down inside its area, and the first and the last cannot go further", async () => {
    const { service } = await setup();
    expect((within(row("Lista 1")).getByRole("button", { name: "Subir" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row("Lista 2")).getByRole("button", { name: "Descer" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row("Roteiro")).getByRole("button", { name: "Subir" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(row("Roteiro")).getByRole("button", { name: "Descer" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(row("Lista 1")).getByRole("button", { name: "Descer" }));
    await waitFor(() => expect(service.updateMaterial).toHaveBeenCalledWith("c-1", "s-26", "b", { position: 4 }));
    await waitFor(() => expect(service.materials).toHaveBeenCalledTimes(2));
  });

  it("removes a material", async () => {
    const { service } = await setup();
    fireEvent.click(within(row("Apoio")).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(service.deleteMaterial).toHaveBeenCalledWith("c-1", "s-26", "d"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Apoio" })).toBeNull());
  });

  it("says on the material when it could not be saved, and puts the field back", async () => {
    const { service } = await setup();
    service.updateMaterial.mockRejectedValueOnce(new Error("offline"));
    const kind = within(row("Roteiro")).getByLabelText("Tipo") as HTMLSelectElement;
    fireEvent.change(kind, { target: { value: "REFERENCE" } });
    expect(await within(row("Roteiro")).findByText("Não foi possível salvar. Tente de novo.")).toBeDefined();
    expect((within(row("Roteiro")).getByLabelText("Tipo") as HTMLSelectElement).value).toBe("SLIDES");

    service.deleteMaterial.mockRejectedValueOnce(new ApiProblemError({ type: "material-not-found", title: "x", status: 404 }, 404));
    fireEvent.click(within(row("Roteiro")).getByRole("button", { name: "Remover" }));
    expect(await within(row("Roteiro")).findByText("Este material não existe mais. Feche e abra o conteúdo da aula.")).toBeDefined();
  });
});

// SPEC-074 CA-14 and D-06: the area to send files with no phase chosen, where they start in "Só durante a aula"
describe("SessionMaterials: the area Enviar arquivos (SPEC-074 CA-14)", () => {
  const files = (list: File[]) => ({ dataTransfer: { files: list, types: ["Files"] } });
  const area = () => screen.getByText("Arraste os arquivos aqui ou clique para escolher");

  it("has an area at the top to choose several files at once", async () => {
    await setup();
    const input = screen.getByLabelText("Enviar arquivos") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("application/pdf,image/png,image/jpeg,image/webp");
  });

  it("sends each chosen file, one after the other, to the phase Durante a aula, with the kind that starts that phase", async () => {
    const { service } = await setup([]);
    const slides = pdf("Slides 1.pdf");
    fireEvent.change(screen.getByLabelText("Enviar arquivos"), { target: { files: [slides, png("quadro.png")] } });
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(2));
    expect(readPdf).toHaveBeenCalledWith(slides);
    expect(service.addFileMaterial.mock.calls[0]![3]).toEqual({ title: "Slides 1", kind: "EXERCISES", visibility: "DURING_CLASS" });
    expect(service.addFileMaterial.mock.calls[0]![4]).toBe(7);
    expect(service.addFileMaterial.mock.calls[1]![3]).toEqual({ title: "quadro", kind: "EXERCISES", visibility: "DURING_CLASS" });
    const during = zone("Só durante a aula");
    expect(await within(during).findByRole("group", { name: "quadro" })).toBeDefined();
    expect(within(during).getByRole("group", { name: "Slides 1" })).toBeDefined();
  });

  it("takes the files dropped on it, lights up while the files are over it, and sends them the same way", async () => {
    const { service } = await setup([]);
    const label = area().closest("label")!;
    expect(label.getAttribute("data-dragging")).toBeNull();
    fireEvent.dragEnter(area(), files([pdf("a.pdf")]));
    expect(label.getAttribute("data-dragging")).toBe("true");
    fireEvent.drop(area(), files([pdf("a.pdf"), pdf("b.pdf")]));
    expect(label.getAttribute("data-dragging")).toBeNull();
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(2));
    expect(service.addFileMaterial.mock.calls.map((c) => c[3])).toEqual([
      { title: "a", kind: "EXERCISES", visibility: "DURING_CLASS" },
      { title: "b", kind: "EXERCISES", visibility: "DURING_CLASS" },
    ]);
  });

  it("refuses what is not valid, next to the file, and sends the others", async () => {
    const { service } = await setup([]);
    fireEvent.drop(area(), files([new File(["x"], "video.mp4", { type: "video/mp4" }), png("ok.png")]));
    const during = zone("Só durante a aula");
    expect(await within(during).findByText(/video\.mp4/)).toBeDefined();
    expect(within(during).getByText("Formato não aceito. Envie um PDF ou uma imagem PNG, JPEG ou WebP.")).toBeDefined();
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(1));
  });

  it("does not take what is dragged and is not a file", async () => {
    await setup([]);
    fireEvent.dragEnter(area(), { dataTransfer: { files: [], types: ["text/plain"] } });
    expect(area().closest("label")!.getAttribute("data-dragging")).toBeNull();
  });

  it("leaves the four areas as they are: a file dropped on one of them keeps the phase of that one", async () => {
    const { service } = await setup([]);
    fireEvent.drop(zone("Só depois da aula"), files([pdf("resolucao.pdf")]));
    await waitFor(() => expect(service.addFileMaterial).toHaveBeenCalledTimes(1));
    expect(service.addFileMaterial.mock.calls[0]![3]).toEqual({ title: "resolucao", kind: "EXERCISE_SOLUTION", visibility: "AFTER_CLASS" });
  });
});
