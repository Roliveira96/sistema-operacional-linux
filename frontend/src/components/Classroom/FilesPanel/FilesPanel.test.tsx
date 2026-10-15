import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import type { DeckSummary, LiveDeck } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { PdfReadError } from "../SlidePresenter/pdfRenderer";
import { FilesPanel } from "./FilesPanel";

const m = messages.classroom.files;

const decks: DeckSummary[] = [
  { id: "d-2", title: "Esquema", pageCount: 1, kind: "IMAGE", createdAt: "2026-10-15T10:00:00Z" },
  { id: "d-1", title: "Slides de processos", pageCount: 12, kind: "PDF", createdAt: "2026-10-14T10:00:00Z" },
];

const uploaded = (over: Partial<LiveDeck> = {}): LiveDeck => ({ id: "d-3", title: "Aula 3", pageCount: 12, kind: "PDF", downloadUrl: "https://minio/x", ...over });

const pdf = (name = "Aula 3.pdf") => new File(["%PDF-1.7"], name, { type: "application/pdf" });
const png = (name = "Esquema novo.png") => new File(["x"], name, { type: "image/png" });

function setup(over: Record<string, unknown> = {}) {
  const service = { listDecks: vi.fn().mockResolvedValue(decks), uploadDeck: vi.fn().mockResolvedValue(uploaded()) };
  const onProject = vi.fn();
  const readPdf = vi.fn().mockResolvedValue({ pageCount: 12 });
  const view = render(<FilesPanel classId="c-1" onProject={onProject} service={service} readPdf={readPdf} {...over} />);
  return { service, onProject, readPdf, ...view };
}

const input = () => screen.getByLabelText(m.send) as HTMLInputElement;
const choose = (file: File) => fireEvent.change(input(), { target: { files: [file] } });
const flush = () => act(async () => void (await Promise.resolve()));

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

// SPEC-068: the files of the class, sent with the class going on, and projected on the stage
describe("FilesPanel", () => {
  // CA-11
  it("lists the presentations of the class, with name, type and slides, and says how to use PowerPoint", async () => {
    const { service } = setup();
    expect(await screen.findByText("Esquema")).toBeDefined();
    expect(service.listDecks).toHaveBeenCalledWith("c-1");
    const list = screen.getByRole("list", { name: m.listLabel });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText(m.kind.IMAGE)).toBeDefined();
    expect(within(items[0]!).getByText("1 lâmina")).toBeDefined();
    expect(within(items[1]!).getByText("Slides de processos")).toBeDefined();
    expect(within(items[1]!).getByText(m.kind.PDF)).toBeDefined();
    expect(within(items[1]!).getByText("12 lâminas")).toBeDefined();
    expect(screen.getByText(/exporte-a para PDF/)).toBeDefined();
    expect(input().accept).toBe("application/pdf,image/png,image/jpeg,image/webp");
  });

  it("says there is nothing yet, and that the list could not be read", async () => {
    setup({ service: { listDecks: vi.fn().mockResolvedValue([]), uploadDeck: vi.fn() } });
    expect(await screen.findByText(m.empty)).toBeDefined();
    cleanup();
    setup({ service: { listDecks: vi.fn().mockRejectedValue(new Error("offline")), uploadDeck: vi.fn() } });
    expect((await screen.findByRole("alert")).textContent).toBe(m.loadError);
  });

  // CA-06 (the screen side): the project button
  it("projects the presentation of an item", async () => {
    const { onProject } = setup();
    fireEvent.click(await screen.findByRole("button", { name: m.projectLabel("Slides de processos") }));
    expect(onProject).toHaveBeenCalledWith("d-1");
  });

  // CA-01, CA-09: a PDF is read for its pages, sent, shown in the list and projected when it is ready
  it("sends a PDF with its page count, shows it as sending and then in the list, and projects it", async () => {
    let finish!: (deck: LiveDeck) => void;
    const { service, readPdf, onProject } = setup();
    service.uploadDeck.mockReturnValue(new Promise<LiveDeck>((resolve) => (finish = resolve)));
    await screen.findByText("Esquema");
    expect((screen.getByRole("checkbox", { name: m.projectWhenDone }) as HTMLInputElement).checked).toBe(true);

    const file = pdf();
    choose(file);
    await waitFor(() => expect(service.uploadDeck).toHaveBeenCalledWith("c-1", file, "Aula 3", 12));
    expect(readPdf).toHaveBeenCalledWith(file);
    expect(screen.getByText(m.sending)).toBeDefined();
    expect(onProject).not.toHaveBeenCalled();

    await act(async () => finish(uploaded()));
    expect(screen.queryByText(m.sending)).toBeNull();
    expect(screen.getByRole("button", { name: m.projectLabel("Aula 3") })).toBeDefined();
    expect(onProject).toHaveBeenCalledExactlyOnceWith("d-3");
  });

  // CA-02: an image is not read as a PDF, and goes with no page count
  it("sends an image with no page count and projects it", async () => {
    const { service, readPdf, onProject } = setup();
    service.uploadDeck.mockResolvedValue(uploaded({ id: "d-4", title: "Esquema novo", pageCount: 1, kind: "IMAGE" }));
    await screen.findByText("Esquema");

    const file = png();
    choose(file);
    await waitFor(() => expect(onProject).toHaveBeenCalledWith("d-4"));
    expect(service.uploadDeck).toHaveBeenCalledWith("c-1", file, "Esquema novo");
    expect(readPdf).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: m.projectLabel("Esquema novo") })).toBeDefined();
  });

  it("sends a file that is dropped on the section, the same way", async () => {
    const { service } = setup();
    await screen.findByText("Esquema");
    const file = png("Solta.png");
    fireEvent.drop(screen.getByRole("region", { name: m.title }), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(service.uploadDeck).toHaveBeenCalledWith("c-1", file, "Solta"));
  });

  // CA-09: with the option off the file is kept, and nothing goes to the stage
  it("keeps the file and does not project it when the option is off", async () => {
    const { service, onProject } = setup();
    await screen.findByText("Esquema");
    fireEvent.click(screen.getByRole("checkbox", { name: m.projectWhenDone }));
    choose(pdf());
    await screen.findByRole("button", { name: m.projectLabel("Aula 3") });
    expect(service.uploadDeck).toHaveBeenCalledTimes(1);
    expect(onProject).not.toHaveBeenCalled();
  });

  // CA-09, CA-11: a failed upload stays in the list with its reason, is not projected, and can be tried again
  it("shows the reason of a failed upload in the item, does not project it, and sends it again on request", async () => {
    const { service, onProject } = setup();
    service.uploadDeck.mockRejectedValueOnce(new ApiProblemError({ type: "deck-limit-exceeded" }, 409));
    await screen.findByText("Esquema");

    choose(pdf());
    expect((await screen.findByRole("alert")).textContent).toContain(m.errors.deckLimit);
    expect(onProject).not.toHaveBeenCalled();

    service.uploadDeck.mockResolvedValueOnce(uploaded());
    fireEvent.click(screen.getByRole("button", { name: m.retry }));
    await waitFor(() => expect(onProject).toHaveBeenCalledWith("d-3"));
    expect(service.uploadDeck).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // CA-11: each failure says what to do, in Portuguese, in the item
  it.each([
    ["a PDF over the limit", pdf(), new ApiProblemError({ type: "file-too-large" }, 413), m.errors.tooBigPdf],
    ["an image over the limit", png(), new ApiProblemError({ type: "file-too-large" }, 413), m.errors.tooBigImage],
    ["a file the server does not accept", png(), new ApiProblemError({ type: "invalid-file" }, 400), m.errors.format],
    ["a PDF the server cannot read", pdf(), new ApiProblemError({ type: "invalid-pdf" }, 400), m.errors.pdfRead],
    ["a connection that dropped", pdf(), new Error("offline"), m.errors.send],
  ])("says what went wrong with %s", async (_name, file, failure, text) => {
    const { service } = setup();
    service.uploadDeck.mockRejectedValue(failure);
    await screen.findByText("Esquema");
    choose(file);
    expect((await screen.findByRole("alert")).textContent).toContain(text);
  });

  // CA-03 (the screen side): what is not a PDF or an image is not even sent
  it("does not send a PowerPoint file, nor any other format, and says which ones are accepted", async () => {
    const { service } = setup();
    await screen.findByText("Esquema");
    choose(new File(["PK"], "aula.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
    expect((await screen.findByRole("alert")).textContent).toContain(m.errors.format);
    choose(new File(["GIF89a"], "animacao.gif", { type: "image/gif" }));
    await flush();
    expect(service.uploadDeck).not.toHaveBeenCalled();
  });

  it("does not send a PDF that cannot be read, a PDF with too many pages, nor a file over the limit", async () => {
    const { service, readPdf } = setup();
    await screen.findByText("Esquema");

    readPdf.mockRejectedValueOnce(new PdfReadError("password"));
    choose(pdf("protegido.pdf"));
    expect((await screen.findByRole("alert")).textContent).toContain(m.errors.pdfRead);

    readPdf.mockResolvedValueOnce({ pageCount: 101 });
    choose(pdf("enorme.pdf"));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes(m.errors.tooManyPages))).toBe(true));

    const big = pdf("grande.pdf");
    Object.defineProperty(big, "size", { value: 25 * 1024 * 1024 + 1 });
    choose(big);
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes(m.errors.tooBigPdf))).toBe(true));
    const heavy = png("pesada.png");
    Object.defineProperty(heavy, "size", { value: 10 * 1024 * 1024 + 1 });
    choose(heavy);
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes(m.errors.tooBigImage))).toBe(true));
    expect(service.uploadDeck).not.toHaveBeenCalled();
  });
});
