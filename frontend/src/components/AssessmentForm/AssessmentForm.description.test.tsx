import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { questions } from "@/test/assessmentFixtures";
import { AssessmentForm, type AssessmentFormInitial, type AssessmentFormProps } from "./AssessmentForm";

afterEach(cleanup);

type Host = HTMLElement & { editor: Editor };

const saved: AssessmentFormInitial = {
  title: "Prova 1",
  description: "",
  type: "EXAM",
  maxScore: 10,
  moduleId: "mod-1",
  startsAt: "2026-10-23T09:00:00-03:00",
  endsAt: "2026-10-23T11:00:00-03:00",
  composition: "MANUAL",
  items: [
    { questionId: "q-1", title: "Criar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 5 },
    { questionId: "q-2", title: "Apagar a pasta", kind: "PRACTICAL", difficulty: "EASY", weight: 5 },
  ],
  audience: "ALL_CLASS",
  teacherPrivateNotes: null,
};

function setup(initial: AssessmentFormInitial = {}, over: Partial<AssessmentFormProps> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <AssessmentForm
      mode="edit"
      modules={[{ id: "mod-1", title: "Permissões de arquivos" }]}
      students={[{ id: "s-1", name: "Ana Souza", academicId: "1000001" }]}
      loadQuestions={vi.fn().mockResolvedValue(questions())}
      onSubmit={onSubmit}
      initial={{ ...saved, ...initial }}
      {...over}
    />,
  );
  return { ...view, onSubmit };
}

/** The editor of the instructions, once it is ready. */
async function editorOf(container: HTMLElement) {
  const dom = await waitFor(() => {
    const el = container.querySelector(".ProseMirror") as Host | null;
    if (!el) throw new Error("editor not ready");
    return el;
  });
  return { dom, editor: dom.editor };
}

const save = () => screen.getByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement;
const why = () => document.getElementById(save().getAttribute("aria-describedby")!)?.textContent ?? "";

// SPEC-077 CA-06 and CA-07: the instructions are written in the editor the system already has, with no button for images.
describe("AssessmentForm instructions", () => {
  it("edits the instructions in the visual editor, with its toolbar and without the image button", async () => {
    const { container } = setup();
    await editorOf(container);
    expect(screen.getByRole("textbox", { name: "Instruções gerais" }).getAttribute("contenteditable")).toBe("true");
    expect(screen.getByRole("toolbar", { name: "Formatação do texto" })).toBeDefined();
    expect(screen.queryByRole("button", { name: authoringMessages.questionKinds.image.button })).toBeNull();
    expect(screen.queryByLabelText("Instruções gerais", { selector: "textarea" })).toBeNull();
  });

  it("opens the old plain text as one paragraph for each line", async () => {
    const { container } = setup({ description: "Primeira linha.\nSegunda linha." });
    const { dom } = await editorOf(container);
    expect(Array.from(dom.querySelectorAll("p")).map((p) => p.textContent)).toEqual(["Primeira linha.", "Segunda linha."]);
  });

  it("opens the saved html as it is", async () => {
    const { container } = setup({ description: "<p>Use <code>ls -l</code> e veja:</p><ol><li>Um</li><li>Dois</li></ol>" });
    const { dom } = await editorOf(container);
    expect(dom.querySelector("code")?.textContent).toBe("ls -l");
    expect(dom.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("sends the html of the editor, and an empty text when the editor is empty", async () => {
    const { container, onSubmit } = setup({ description: "<p>Antiga</p>" });
    const { editor } = await editorOf(container);

    act(() => {
      editor.chain().selectAll().insertContent("<p>Nova <strong>regra</strong></p>").run();
    });
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual(expect.objectContaining({ description: "<p>Nova <strong>regra</strong></p>" }));

    act(() => {
      editor.chain().selectAll().deleteSelection().run();
    });
    fireEvent.click(save());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]![0]).toEqual(expect.objectContaining({ description: "" }));
  });

  it("locks the save above 20,000 characters of html and says why, and lets exactly 20,000 through", async () => {
    const { container } = setup();
    const { editor } = await editorOf(container);
    const paragraph = (n: number) => `<p>${"a".repeat(n - "<p></p>".length)}</p>`;

    act(() => {
      editor.chain().selectAll().insertContent(paragraph(20_000)).run();
    });
    await waitFor(() => expect(editor.getHTML().length).toBe(20_000));
    expect(save().disabled).toBe(false);

    act(() => {
      editor.chain().selectAll().insertContent(paragraph(20_001)).run();
    });
    await waitFor(() => expect(save().disabled).toBe(true));
    expect(why()).toContain("instruções");
  });

  it("keeps the instructions editable when the assessment has already started", async () => {
    const { container } = setup({}, { frozen: true });
    await editorOf(container);
    expect(screen.getByRole("textbox", { name: "Instruções gerais" }).getAttribute("contenteditable")).toBe("true");
  });
});
