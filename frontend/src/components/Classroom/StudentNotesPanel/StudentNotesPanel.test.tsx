import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService, type LiveNoteBlock } from "@/services/classroomService";
import * as imageOptimizer from "./noteImageOptimizer";
import { StudentNotesPanel, STUDENT_NOTES_DOCK_STORAGE_KEY } from "./StudentNotesPanel";

describe("StudentNotesPanel — Caderno Dinâmico Flutuante em Blocos (SPEC-071)", () => {
  const initialBlocks: LiveNoteBlock[] = [
    {
      id: "b-1",
      contentMarkdown: "O comando `sudo` eleva privilégios **temporariamente**.\n\n- Primeiro item\n- Segundo item\n\n![Print](/api/v1/media/notes/img-1)",
      createdAt: "2026-10-16T10:14:22Z",
      updatedAt: "2026-10-16T10:14:22Z",
    },
    {
      id: "b-2",
      contentMarkdown: "Bloco com *itálico*.",
      createdAt: "2026-10-16T10:16:00Z",
      updatedAt: "2026-10-16T10:18:30Z",
    },
  ];

  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(classroomService, "listNoteBlocks").mockResolvedValue([...initialBlocks]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // CA-01: Floating draggable and minimizable widget with pill counter and localStorage persistence
  it("renders as a floating draggable and minimizable widget, persisting position and minimized state in localStorage (CA-01)", async () => {
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const dock = await screen.findByTestId("student-notes-dock");
    expect(dock.style.transform).toContain("translate3d(");

    // Drag the header
    const dragHandle = screen.getByTestId("student-notes-drag-handle");
    fireEvent.pointerDown(dragHandle, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 180 });
    fireEvent.pointerUp(window);

    expect(dock.style.transform).toBe("translate3d(140px, 80px, 0)");
    const savedAfterDrag = JSON.parse(window.localStorage.getItem(STUDENT_NOTES_DOCK_STORAGE_KEY)!);
    expect(savedAfterDrag).toEqual({ x: 140, y: 80, minimized: false });

    // Minimize into a pill showing the note count
    fireEvent.click(screen.getByRole("button", { name: "Minimizar caderno" }));
    const pill = screen.getByRole("button", { name: /Anotações \(2\)/ });
    expect(pill).toBeDefined();

    const savedMinimized = JSON.parse(window.localStorage.getItem(STUDENT_NOTES_DOCK_STORAGE_KEY)!);
    expect(savedMinimized).toEqual({ x: 140, y: 80, minimized: true });

    // Remount and verify it restores position and minimized state from localStorage
    cleanup();
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const restoredPill = await screen.findByRole("button", { name: /Anotações \(2\)/ });
    expect(restoredPill).toBeDefined();
    expect(screen.getByTestId("student-notes-dock").style.transform).toBe("translate3d(140px, 80px, 0)");

    // Expand again
    fireEvent.click(restoredPill);
    expect(await screen.findByLabelText("Nova anotação")).toBeDefined();
  });

  // CA-02: Atomic blocks creation and automatic timestamp display
  it("lists blocks in chronological order with creation timestamps and creates a new atomic block (CA-02)", async () => {
    const createdBlock: LiveNoteBlock = {
      id: "b-3",
      contentMarkdown: "Nova nota sobre `chmod 755`",
      createdAt: "2026-10-16T10:25:00Z",
      updatedAt: "2026-10-16T10:25:00Z",
    };
    const createSpy = vi.spyOn(classroomService, "createNoteBlock").mockResolvedValue(createdBlock);

    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const editor = (await screen.findByLabelText("Nova anotação")) as HTMLTextAreaElement;

    const cardsBefore = screen.getAllByTestId("note-block-card");
    expect(cardsBefore).toHaveLength(2);
    // Block b-2 was edited after creation, so it shows the edited indicator
    expect(within(cardsBefore[1]!).getByText(/editado/i)).toBeDefined();

    fireEvent.change(editor, { target: { value: "Nova nota sobre `chmod 755`" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar anotação" }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("c-1", "s-1", "Nova nota sobre `chmod 755`"));
    expect(editor.value).toBe("");
    const cardsAfter = screen.getAllByTestId("note-block-card");
    expect(cardsAfter).toHaveLength(3);
    expect(within(cardsAfter[2]!).getByText("chmod 755")).toBeDefined();
  });

  // CA-03: Edit an existing block and update its edited timestamp
  it("edits an individual block and displays its updated timestamp (CA-03)", async () => {
    const updatedBlock: LiveNoteBlock = {
      ...initialBlocks[0]!,
      contentMarkdown: "Bloco 1 corrigido com **sucesso**",
      updatedAt: "2026-10-16T10:30:00Z",
    };
    const updateSpy = vi.spyOn(classroomService, "updateNoteBlock").mockResolvedValue(updatedBlock);

    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const cards = await screen.findAllByTestId("note-block-card");

    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Editar anotação" }));
    const editInput = within(cards[0]!).getByLabelText("Editar anotação") as HTMLTextAreaElement;
    expect(editInput.value).toBe(initialBlocks[0]!.contentMarkdown);

    fireEvent.change(editInput, { target: { value: "Bloco 1 corrigido com **sucesso**" } });
    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Salvar edição" }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("c-1", "s-1", "b-1", "Bloco 1 corrigido com **sucesso**"));
    const refreshedCards = screen.getAllByTestId("note-block-card");
    expect(within(refreshedCards[0]!).getByText("sucesso")).toBeDefined();
    expect(within(refreshedCards[0]!).getByText(/editado/i)).toBeDefined();
  });

  // CA-04: Delete an individual block with quick confirmation
  it("deletes an individual block after confirmation (CA-04)", async () => {
    const deleteSpy = vi.spyOn(classroomService, "deleteNoteBlock").mockResolvedValue(undefined);

    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const cards = await screen.findAllByTestId("note-block-card");

    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Excluir anotação" }));
    expect(deleteSpy).not.toHaveBeenCalled();

    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Confirmar exclusão" }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith("c-1", "s-1", "b-1"));
    expect(screen.getAllByTestId("note-block-card")).toHaveLength(1);
  });

  // CA-05: Rich formatting toolbar and Ctrl+B / Ctrl+I keyboard shortcuts
  it("applies Markdown formatting via toolbar buttons and Ctrl+B / Ctrl+I shortcuts (CA-05)", async () => {
    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const editor = (await screen.findByLabelText("Nova anotação")) as HTMLTextAreaElement;

    editor.value = "root";
    fireEvent.change(editor, { target: { value: "root" } });
    editor.setSelectionRange(0, 4);

    // Ctrl+B wraps selection in **...**
    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });
    expect(editor.value).toBe("**root**");

    // Ctrl+I wraps selection in *...*
    editor.setSelectionRange(0, 8);
    fireEvent.keyDown(editor, { key: "i", ctrlKey: true });
    expect(editor.value).toBe("***root***");

    // Inline code button
    fireEvent.change(editor, { target: { value: "ls -la" } });
    editor.setSelectionRange(0, 6);
    fireEvent.click(screen.getByRole("button", { name: "Código inline" }));
    expect(editor.value).toBe("`ls -la`");

    // Bullet list button
    fireEvent.change(editor, { target: { value: "item" } });
    editor.setSelectionRange(0, 4);
    fireEvent.click(screen.getByRole("button", { name: "Lista de marcadores" }));
    expect(editor.value).toBe("- item");
  });

  // CA-06, CA-07, CA-08: Clipboard paste image -> client-side AVIF optimization -> upload -> Markdown insertion
  it("optimizes a pasted clipboard image to AVIF, uploads it and inserts the proxy Markdown link (CA-06, CA-07, CA-08)", async () => {
    const optimizedBlob = new Blob(["avif"], { type: "image/avif" });
    const optSpy = vi.spyOn(imageOptimizer, "optimizeNoteImage").mockResolvedValue({
      blob: optimizedBlob,
      width: 1220,
      height: 680,
      mimeType: "image/avif",
      fileName: "captura.avif",
    });
    const uploadSpy = vi.spyOn(classroomService, "uploadNoteImage").mockResolvedValue({
      imageId: "img-99",
      accessUrl: "/api/v1/media/notes/img-99",
    });

    render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const editor = (await screen.findByLabelText("Nova anotação")) as HTMLTextAreaElement;

    const rawImage = new File(["bitmap"], "screenshot.png", { type: "image/png" });
    fireEvent.paste(editor, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => rawImage,
          },
        ],
      },
    });

    await waitFor(() => expect(optSpy).toHaveBeenCalledWith(rawImage));
    await waitFor(() =>
      expect(uploadSpy).toHaveBeenCalledWith("c-1", "s-1", optimizedBlob, {
        fileName: "captura.avif",
        width: 1220,
        height: 680,
      }),
    );
    await waitFor(() => expect(editor.value).toContain("![Captura](/api/v1/media/notes/img-99)"));
  });

  // CA-09: Safe Markdown rendering (no XSS, responsive proxy images)
  it("renders Markdown formatting and responsive proxy images safely without executing raw HTML or unsafe image URLs (CA-09)", async () => {
    vi.spyOn(classroomService, "listNoteBlocks").mockResolvedValueOnce([
      {
        id: "b-xss",
        contentMarkdown:
          "Texto com **negrito**, *itálico* e `código`.\n\n- Tópico A\n\n![Valida](/api/v1/media/notes/img-1)\n\n![Insegura](javascript:alert(1))\n\n<script>window.__xss = true;</script>",
        createdAt: "2026-10-16T10:14:22Z",
        updatedAt: "2026-10-16T10:14:22Z",
      },
    ]);

    const { container } = render(<StudentNotesPanel classId="c-1" sessionId="s-1" />);
    const card = await screen.findByTestId("note-block-card");

    expect(card.querySelector("strong")?.textContent).toBe("negrito");
    expect(card.querySelector("em")?.textContent).toBe("itálico");
    expect(card.querySelector("code")?.textContent).toBe("código");
    expect(card.querySelector("li")?.textContent).toBe("Tópico A");

    const imgs = card.querySelectorAll("img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute("src")).toBe("/api/v1/media/notes/img-1");
    expect(imgs[0]?.getAttribute("alt")).toBe("Valida");

    // No <script> tag is ever created in the DOM
    expect(container.querySelector("script")).toBeNull();
  });
});
