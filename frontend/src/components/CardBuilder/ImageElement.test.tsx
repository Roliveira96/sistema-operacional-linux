import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import type { UploadedImage } from "@/services/contentAuthoringService";
import { ImageElement } from "./ImageElement";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const hash = "ab".repeat(32);
const saved: UploadedImage = { url: `http://bucket/linux-lab/conteudo/${hash}.avif`, width: 1220, height: 686, bytes: 49152 };

function Harness({ upload, initial = "", errors = {} }: { upload: (f: File) => Promise<UploadedImage>; initial?: string; errors?: Record<string, string[]> }) {
  const [el, setEl] = useState({ url: initial, caption: "" });
  return <ImageElement n={3} id="el" url={el.url} caption={el.caption} errors={errors} upload={upload} onChange={(p) => setEl((e) => ({ ...e, ...p }))} />;
}

const pick = (file: File) => fireEvent.change(screen.getByLabelText("Enviar imagem 3"), { target: { files: [file] } });
const png = (size = 10) => new File([new Uint8Array(size)], "foto.png", { type: "image/png" });

// Covers SPEC-025 CA-07: the teacher sends the file, sees the preview and the address fills itself.
describe("ImageElement", () => {
  it("sends the file, fills in the address with what the server kept, and shows the preview and the size", async () => {
    const upload = vi.fn().mockResolvedValue(saved);
    render(<Harness upload={upload} />);
    expect(screen.getByRole("button", { name: /Enviar imagem/ })).toBeDefined();
    expect(screen.getByText(/converte para AVIF e reduz para no máximo 1220 px/)).toBeDefined();

    const file = png();
    pick(file);
    expect(await screen.findByText("Imagem guardada: 1220 × 686 px, 48 KB.")).toBeDefined();
    expect(upload).toHaveBeenCalledWith(file);
    expect((screen.getByLabelText("Endereço da imagem 3") as HTMLInputElement).value).toBe(saved.url);
    expect(screen.getByRole("img", { name: "Prévia da imagem 3" }).getAttribute("src")).toBe(saved.url);
    // With an image there, the button offers to replace it.
    expect(screen.getByRole("button", { name: /Trocar imagem/ })).toBeDefined();
  });

  it("says it is sending while the server converts, and does not let a second one start", async () => {
    let finish: (u: UploadedImage) => void = () => {};
    const upload = vi.fn(() => new Promise<UploadedImage>((resolve) => (finish = resolve)));
    render(<Harness upload={upload} />);
    pick(png());
    expect(await screen.findByText("Enviando e convertendo a imagem…")).toBeDefined();
    expect((screen.getByRole("button", { name: /Enviar imagem/ }) as HTMLButtonElement).disabled).toBe(true);
    finish(saved);
    await waitFor(() => expect(screen.queryByText("Enviando e convertendo a imagem…")).toBeNull());
  });

  it("refuses at once what the server would refuse: another type, or more than 10 MB", async () => {
    const upload = vi.fn();
    render(<Harness upload={upload} />);
    pick(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Escolha uma imagem JPEG, PNG, WebP, GIF ou AVIF.");
    pick(new File([new Uint8Array((10 << 20) + 1)], "grande.png", { type: "image/png" }));
    expect(await screen.findByText("A imagem passa de 10 MB.")).toBeDefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows the reason the server gave, or a general one, and keeps the address that was there", async () => {
    const upload = vi.fn()
      .mockRejectedValueOnce(new ApiProblemError({ type: "validation-error", title: "Invalid", detail: "O arquivo não é uma imagem aceita." }, 400))
      .mockRejectedValueOnce(new Error("rede"));
    render(<Harness upload={upload} initial="https://x.com/velha.png" />);
    pick(png());
    expect(await screen.findByText("O arquivo não é uma imagem aceita.")).toBeDefined();
    pick(png());
    expect(await screen.findByText("Não foi possível enviar a imagem. Tente de novo.")).toBeDefined();
    expect((screen.getByLabelText("Endereço da imagem 3") as HTMLInputElement).value).toBe("https://x.com/velha.png");
  });

  // Covers SPEC-025 CA-08, P-06: an address published elsewhere is still accepted, typed by hand.
  it("still accepts an address typed by hand, with its preview, and the caption", () => {
    render(<Harness upload={vi.fn()} />);
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.change(screen.getByLabelText("Endereço da imagem 3"), { target: { value: "https://x.com/a.png" } });
    expect(screen.getByRole("img", { name: "Prévia da imagem 3" }).getAttribute("src")).toBe("https://x.com/a.png");
    fireEvent.change(screen.getByLabelText("Legenda 3"), { target: { value: "Fluxo" } });
    expect((screen.getByLabelText("Legenda 3") as HTMLInputElement).value).toBe("Fluxo");
    // Something that is not an address does not become a picture.
    fireEvent.change(screen.getByLabelText("Endereço da imagem 3"), { target: { value: "javascript:alert(1)" } });
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("opens the file chooser from the button and ignores an empty choice", () => {
    const upload = vi.fn();
    render(<Harness upload={upload} />);
    const field = screen.getByLabelText("Enviar imagem 3") as HTMLInputElement;
    const click = vi.spyOn(field, "click");
    fireEvent.click(screen.getByRole("button", { name: /Enviar imagem/ }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(field, { target: { files: [] } });
    expect(upload).not.toHaveBeenCalled();
  });
});
