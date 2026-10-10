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
