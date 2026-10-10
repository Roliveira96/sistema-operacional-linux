import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GalleryImage } from "@/lib/cardModel";
import { ApiProblemError } from "@/services/httpClient";
import type { UploadedImage } from "@/services/contentAuthoringService";
import { ImageElement } from "./ImageElement";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const hash = (c: string) => c.repeat(64);
const kept = (c: string): UploadedImage => ({ url: `http://bucket/linux-lab/conteudo/${hash(c)}.avif`, width: 1220, height: 686, bytes: 49152 });

/** Holds the element the way the card does, and shows what it holds. */
function Harness({ upload, initial = [] }: { upload: (f: File) => Promise<UploadedImage>; initial?: GalleryImage[] }) {
  const [images, setImages] = useState(initial);
  return (
    <>
      <ImageElement n={3} images={images} upload={upload} onChange={(p) => setImages(p.images)} />
      <output aria-label="estado">{JSON.stringify(images.map((i) => [i.url ? "ok" : "pendente", i.caption]))}</output>
    </>
  );
}

const png = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: "image/png" });
const pickMany = (files: File[]) => fireEvent.change(screen.getByLabelText("Adicionar imagens 3"), { target: { files } });
const state = () => JSON.parse(screen.getByLabelText("estado").textContent ?? "[]") as [string, string][];

// Covers SPEC-025 rev. 2 (CA-12 to CA-14, CA-17): the element holds one or more pictures, sent as files, never typed as an address.
describe("ImageElement, the gallery", () => {
  it("has no field to type an address (CA-12)", () => {
    render(<Harness upload={vi.fn()} />);
    expect(screen.queryByLabelText(/Endereço/)).toBeNull();
    expect(screen.queryByPlaceholderText(/endereço/i)).toBeNull();
    expect(screen.getByText("Nenhuma imagem ainda. Use \"Adicionar imagens\".")).toBeDefined();
    expect(screen.getByText("0 de 12 imagens")).toBeDefined();
  });

  it("sends several files one at a time, in the order chosen, and shows each one's state (CA-13)", async () => {
    const order: string[] = [];
    const releases: Record<string, (u: UploadedImage) => void> = {};
    const upload = vi.fn((file: File) => {
      order.push(`start ${file.name}`);
      return new Promise<UploadedImage>((resolve) => (releases[file.name] = resolve));
    });
    render(<Harness upload={upload} />);
    pickMany([png("a.png"), png("b.png"), png("c.png")]);

    // All three appear at once, waiting; only the first is being sent.
    expect(state()).toEqual([["pendente", ""], ["pendente", ""], ["pendente", ""]]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("Enviando e convertendo…")).toHaveLength(3);
    releases["a.png"]!(kept("a"));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(order).toEqual(["start a.png", "start b.png"]);
    releases["b.png"]!(kept("b"));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    releases["c.png"]!(kept("c"));
    await waitFor(() => expect(state().every(([s]) => s === "ok")).toBe(true));
    expect(screen.getAllByText("Pronta: 1220 × 686 px, 48 KB")).toHaveLength(3);
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual(["a", "b", "c"].map((c) => kept(c).url));
    expect(screen.getByText("3 de 12 imagens")).toBeDefined();
  });

  it("keeps the ones that worked when another fails, and says which failed (CA-13)", async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce(kept("a"))
      .mockRejectedValueOnce(new ApiProblemError({ type: "validation-error", title: "Invalid", detail: "O arquivo não é uma imagem aceita." }, 400))
      .mockRejectedValueOnce(new Error("rede"));
    render(<Harness upload={upload} />);
    pickMany([png("a.png"), png("b.png"), png("c.png")]);
    expect(await screen.findByText("b.png: O arquivo não é uma imagem aceita.")).toBeDefined();
    expect(await screen.findByText("c.png: não foi possível enviar. Remova ou troque a imagem.")).toBeDefined();
    expect(state().map(([s]) => s)).toEqual(["ok", "pendente", "pendente"]);
  });

  it("refuses at once another type or a file above 10 MB, and sends the others", async () => {
    const upload = vi.fn().mockResolvedValue(kept("a"));
    render(<Harness upload={upload} />);
    pickMany([new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }), png("grande.png", (10 << 20) + 1), png("boa.png")]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("a.svg: escolha uma imagem JPEG, PNG, WebP, GIF ou AVIF.");
    expect(alert).toHaveTextContent("grande.png: a imagem passa de 10 MB.");
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]![0].name).toBe("boa.png");
    expect(state()).toHaveLength(1);
  });

  it("stops at 12 pictures, takes what fits and says the limit (CA-17)", async () => {
    const upload = vi.fn().mockResolvedValue(kept("a"));
    const full: GalleryImage[] = Array.from({ length: 11 }, (_, i) => ({ id: `i${i}`, url: kept("b").url, caption: "" }));
    render(<Harness upload={upload} initial={full} />);
    pickMany([png("1.png"), png("2.png")]);
    expect(await screen.findByText("O limite é de 12 imagens por elemento.")).toBeDefined();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(state()).toHaveLength(12);
    expect((screen.getByRole("button", { name: /Adicionar imagens/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits the caption, reorders and removes, and the preview follows (CA-14)", () => {
    const initial: GalleryImage[] = [
      { id: "a", url: kept("a").url, caption: "Primeira" },
      { id: "b", url: kept("b").url, caption: "Segunda" },
      { id: "c", url: kept("c").url, caption: "Terceira" },
    ];
    render(<Harness upload={vi.fn()} initial={initial} />);
    fireEvent.change(screen.getByLabelText("Legenda da imagem 2"), { target: { value: "Do meio" } });
    expect(state()).toEqual([["ok", "Primeira"], ["ok", "Do meio"], ["ok", "Terceira"]]);

    expect((screen.getByLabelText("Subir a imagem 1") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Descer a imagem 3") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Descer a imagem 1"));
    expect(state().map(([, c]) => c)).toEqual(["Do meio", "Primeira", "Terceira"]);
    fireEvent.click(screen.getByLabelText("Subir a imagem 3"));
    expect(state().map(([, c]) => c)).toEqual(["Do meio", "Terceira", "Primeira"]);
    expect(screen.getAllByRole("img").map((i) => i.getAttribute("src"))).toEqual([kept("b").url, kept("c").url, kept("a").url]);

    fireEvent.click(screen.getByLabelText("Remover a imagem 2"));
    expect(state().map(([, c]) => c)).toEqual(["Do meio", "Primeira"]);
    expect(screen.getByText("2 de 12 imagens")).toBeDefined();
  });

  it("replaces one picture with another file, keeping its place and its caption", async () => {
    const upload = vi.fn().mockResolvedValue(kept("z"));
    render(<Harness upload={upload} initial={[{ id: "a", url: kept("a").url, caption: "Um" }, { id: "b", url: kept("b").url, caption: "Dois" }]} />);
    const swap = screen.getByLabelText("Trocar 3") as HTMLInputElement;
    const click = vi.spyOn(swap, "click");
    fireEvent.click(screen.getByLabelText("Trocar a imagem 2"));
    expect(click).toHaveBeenCalled();
    fireEvent.change(swap, { target: { files: [png("nova.png")] } });
    await waitFor(() => expect(screen.getAllByRole("img")[1]!.getAttribute("src")).toBe(kept("z").url));
    expect(state()).toEqual([["ok", "Um"], ["ok", "Dois"]]);
    expect(screen.getAllByRole("img")[0]!.getAttribute("src")).toBe(kept("a").url);

    // A refused file does not touch the picture.
    fireEvent.click(screen.getByLabelText("Trocar a imagem 1"));
    fireEvent.change(swap, { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("a.txt: escolha uma imagem");
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not send what was removed while it waited, nor put it back", async () => {
    let release: (u: UploadedImage) => void = () => {};
    const upload = vi.fn(() => new Promise<UploadedImage>((resolve) => (release = resolve)));
    render(<Harness upload={upload} />);
    pickMany([png("a.png"), png("b.png")]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    // b is still in the queue: remove it, then let a finish.
    fireEvent.click(screen.getByLabelText("Remover a imagem 2"));
    release(kept("a"));
    await waitFor(() => expect(state()).toEqual([["ok", ""]]));
    await new Promise((r) => setTimeout(r, 20));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("shows a picture that came from an address of before, and lets it be replaced", () => {
    render(<Harness upload={vi.fn()} initial={[{ id: "a", url: "https://x.com/velha.png", caption: "" }]} />);
    expect(screen.getByRole("img", { name: "Prévia da imagem 1" }).getAttribute("src")).toBe("https://x.com/velha.png");
    expect(screen.getByLabelText("Trocar a imagem 1")).toBeDefined();
    expect(screen.queryByLabelText(/Endereço/)).toBeNull();
  });

  it("opens the file chooser from the button and ignores an empty choice", () => {
    const upload = vi.fn();
    render(<Harness upload={upload} />);
    const field = screen.getByLabelText("Adicionar imagens 3") as HTMLInputElement;
    const click = vi.spyOn(field, "click");
    fireEvent.click(within(document.body).getByRole("button", { name: /Adicionar imagens/ }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(field, { target: { files: [] } });
    expect(upload).not.toHaveBeenCalled();
  });
});
