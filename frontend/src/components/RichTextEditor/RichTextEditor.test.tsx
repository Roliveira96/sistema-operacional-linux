import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./RichTextEditor";

afterEach(cleanup);

type Host = HTMLElement & { editor: Editor };

async function open(value: string, onChange = vi.fn()) {
  const view = render(<RichTextEditor label="Texto" value={value} onChange={onChange} />);
  const dom = await waitFor(() => {
    const el = view.container.querySelector(".ProseMirror") as Host | null;
    if (!el) throw new Error("editor not ready");
    return el;
  });
  return { ...view, dom, editor: dom.editor, onChange };
}

describe("RichTextEditor", () => {
  it("shows the stored html and exposes an accessible textbox and toolbar", async () => {
    const { dom } = await open("<p>Use <code>ls</code> aqui</p>");
    expect(dom.querySelector("code")?.textContent).toBe("ls");
    expect(screen.getByRole("textbox", { name: "Texto" })).toBeDefined();
    expect(screen.getByRole("toolbar", { name: "Formatação do texto" })).toBeDefined();
    for (const name of ["Negrito", "Itálico", "Comando", "Bloco de código", "Título", "Lista", "Lista numerada", "Citação", "Link", "Desfazer", "Refazer"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
  });

  it("marks the selection as a command with the Comando button and reports it as html", async () => {
    const { editor, onChange } = await open("<p>ls -la</p>");
    act(() => {
      editor.commands.selectAll();
    });
    const button = screen.getByRole("button", { name: "Comando" });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenLastCalledWith("<p><code>ls -la</code></p>");
    await waitFor(() => expect(screen.getByRole("button", { name: "Comando" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("reports an empty editor as an empty string", async () => {
    const { editor, onChange } = await open("<p>x</p>");
    act(() => {
      editor.chain().selectAll().deleteSelection().run();
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(""));
  });

  it("sets and removes a link through the Link row", async () => {
    const { editor, onChange } = await open("<p>docs</p>");
    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    fireEvent.change(screen.getByLabelText("Endereço do link"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('href="https://example.com"')));
    expect(screen.queryByLabelText("Endereço do link")).toBeNull();
  });

  it("applies headings and lists", async () => {
    const { editor, onChange } = await open("<p>item</p>");
    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("<ul>")));
    fireEvent.click(screen.getByRole("button", { name: "Lista" }));
    fireEvent.click(screen.getByRole("button", { name: "Título" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining("<h3>")));
  });
});

// Covers SPEC-035 CA-03 and D-12: an image of the description is sent to the server and goes into the text with its alternative text.
describe("RichTextEditor images", () => {
  const openWith = async (uploadImage?: (file: File) => Promise<{ url: string }>, value = "<p>x</p>") => {
    const onChange = vi.fn();
    const view = render(<RichTextEditor label="Texto" value={value} onChange={onChange} uploadImage={uploadImage} />);
    await waitFor(() => {
      if (!view.container.querySelector(".ProseMirror")) throw new Error("editor not ready");
    });
    return { ...view, onChange };
  };
  const pick = (container: HTMLElement, file: File) =>
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

  it("has no image button without a way to send images", async () => {
    await openWith();
    expect(screen.queryByRole("button", { name: "Inserir imagem" })).toBeNull();
  });

  it("sends the image, asks for its alternative text and inserts it", async () => {
    const hash = "a".repeat(64);
    const uploadImage = vi.fn().mockResolvedValue({ url: `https://cdn.x/lab/conteudo/${hash}.avif` });
    const { container, onChange } = await openWith(uploadImage);
    expect(screen.getByRole("button", { name: "Inserir imagem" })).toBeDefined();
    pick(container, new File(["x"], "diagrama.png", { type: "image/png" }));
    const alt = (await screen.findByRole("textbox", { name: "Texto alternativo da imagem (o que ela mostra)" })) as HTMLInputElement;
    expect(uploadImage).toHaveBeenCalled();
    expect(alt.value).toBe("diagrama");
    fireEvent.change(alt, { target: { value: "Árvore de diretórios" } });
    fireEvent.click(screen.getByRole("button", { name: "Inserir" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining(`src="https://cdn.x/lab/conteudo/${hash}.avif"`)));
    expect(onChange.mock.lastCall![0]).toContain('alt="Árvore de diretórios"');
    expect(container.querySelector(".ProseMirror img")).not.toBeNull();
  });

  it("shows a stored image, refuses a file too big and says when sending fails", async () => {
    const uploadImage = vi.fn().mockRejectedValue(new Error("down"));
    const { container } = await openWith(uploadImage, '<p>x</p><img src="https://cdn.x/a.avif" alt="a">');
    expect(container.querySelector(".ProseMirror img")?.getAttribute("alt")).toBe("a");
    const big = new File(["x"], "big.png", { type: "image/png" });
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
    pick(container, big);
    expect(await screen.findByText("A imagem passa de 10 MB, o limite.")).toBeDefined();
    expect(uploadImage).not.toHaveBeenCalled();
    pick(container, new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByText("Não foi possível enviar a imagem.")).toBeDefined();
  });

  it("can give up an image before inserting it", async () => {
    const uploadImage = vi.fn().mockResolvedValue({ url: "https://cdn.x/a.avif" });
    const { container, onChange } = await openWith(uploadImage);
    pick(container, new File(["x"], "a.png", { type: "image/png" }));
    await screen.findByRole("textbox", { name: "Texto alternativo da imagem (o que ela mostra)" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("textbox", { name: "Texto alternativo da imagem (o que ela mostra)" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
