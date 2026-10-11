import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GalleryHtml } from "./GalleryHtml";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

const figure = (n: number, caption = "") =>
  `<figure class="md-image"><img src="http://bucket/conteudo/${String(n).repeat(64)}.avif" alt="${caption}">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
const gallery = `<div class="md-gallery">${figure(1, "Primeira")}${figure(2)}${figure(3, "Terceira")}</div>`;

// Covers SPEC-025 rev. 2 (RN-13, P-08): a gallery opens each picture larger, with arrows to go through them.
describe("GalleryHtml", () => {
  it("shows the html as it is, and a single picture is not a button", () => {
    const { container } = render(<GalleryHtml html={figure(1, "Sozinha")} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("role")).toBeNull();
    expect(img.tabIndex).toBe(-1);
    fireEvent.click(img);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("makes every picture of a gallery a button for the keyboard, named by its caption", () => {
    render(<GalleryHtml html={gallery} />);
    expect(screen.getByRole("button", { name: "Ampliar: Primeira" }).tabIndex).toBe(0);
    expect(screen.getByRole("button", { name: "Ampliar: imagem" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ampliar: Terceira" })).toBeDefined();
  });

  it("opens the clicked picture larger, with its caption and its place among the others", () => {
    render(<GalleryHtml html={gallery} />);
    fireEvent.click(screen.getByRole("button", { name: "Ampliar: Terceira" }));
    const dialog = screen.getByRole("dialog", { name: "Galeria de imagens" });
    expect(within(dialog).getByRole("img", { name: "Terceira" }).getAttribute("src")).toContain("3".repeat(64));
    expect(within(dialog).getByText("3 de 3")).toBeDefined();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("goes through the pictures with the buttons and the arrow keys, and stops at the ends", () => {
    render(<GalleryHtml html={gallery} />);
    fireEvent.click(screen.getByRole("button", { name: "Ampliar: Primeira" }));
    const dialog = screen.getByRole("dialog");
    const prev = within(dialog).getByRole("button", { name: "Imagem anterior" }) as HTMLButtonElement;
    const next = within(dialog).getByRole("button", { name: "Próxima imagem" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(within(dialog).getByText("1 de 3")).toBeDefined();

    fireEvent.click(next);
    expect(within(dialog).getByText("2 de 3")).toBeDefined();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(within(dialog).getByText("3 de 3")).toBeDefined();
    expect(next.disabled).toBe(true);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(within(dialog).getByText("3 de 3")).toBeDefined();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.click(prev);
    expect(within(dialog).getByText("1 de 3")).toBeDefined();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(within(dialog).getByText("1 de 3")).toBeDefined();
  });

  it("opens by keyboard with Enter or Space, and closes with Escape, the button or a click outside, giving the focus back", () => {
    render(<GalleryHtml html={gallery} />);
    const first = screen.getByRole("button", { name: "Ampliar: Primeira" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(first);
    expect(document.body.style.overflow).toBe("");

    fireEvent.keyDown(first, { key: " " });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(first, { key: "Enter" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Another key does nothing.
    fireEvent.keyDown(first, { key: "a" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows no arrows when the gallery has only one picture left to see", () => {
    render(<GalleryHtml html={`<div class="md-gallery">${figure(1, "Só")}</div>`} />);
    fireEvent.click(screen.getByRole("button", { name: "Ampliar: Só" }));
    expect(screen.queryByRole("button", { name: "Próxima imagem" })).toBeNull();
  });
});
