import type { Editor } from "@tiptap/react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { ClassForm } from "./ClassForm";

afterEach(cleanup);

type Host = HTMLElement & { editor: Editor };

const summary = () => screen.getByRole("textbox", { name: "Resumo da disciplina" }) as Host;
const write = (html: string) =>
  act(() => {
    summary().editor.chain().focus().selectAll().insertContent(html).run();
  });
const create = () => fireEvent.click(screen.getByRole("button", { name: "Criar Turma" }));

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Nome da Turma/i), { target: { value: "Turma A" } });
  fireEvent.change(screen.getByLabelText(/Código da Disciplina/i), { target: { value: "SO34E" } });
  fireEvent.change(screen.getByLabelText(/Semestre Letivo/i), { target: { value: "2026/2" } });
  fireEvent.change(screen.getByLabelText(/Data de Início/i), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText(/Data de Término/i), { target: { value: "2026-12-01" } });
}

/** The message under the summary, when there is one. */
const summaryError = () => document.getElementById("summary-error")?.textContent ?? null;

// SPEC-078 CA-09 and CA-11 (section 3.1): the summary is written in the visual editor, with the limit on its visible text.
describe("ClassForm summary", () => {
  it("is written in the visual editor, with no image button and no text box", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    const presentation = screen.getByRole("group", { name: "Apresentação" });
    expect(within(presentation).getByRole("toolbar", { name: "Formatação do texto" })).toBeDefined();
    expect(within(presentation).queryByRole("button", { name: "Inserir imagem" })).toBeNull();
    expect(screen.queryByLabelText(/Resumo da disciplina/i, { selector: "textarea" })).toBeNull();
  });

  it("opens the old plain text as one paragraph for each line", () => {
    render(<ClassForm onSubmit={vi.fn()} initialData={{ summary: "Primeira linha.\nSegunda linha." }} />);
    expect(Array.from(summary().querySelectorAll("p")).map((p) => p.textContent)).toEqual(["Primeira linha.", "Segunda linha."]);
  });

  it("counts the visible text, not the marks around it", () => {
    render(<ClassForm onSubmit={vi.fn()} />);
    write("<p>Linux <strong>na</strong> prática</p>");
    expect(screen.getByText("16/300")).toBeDefined();
  });

  it("sends the html of the editor, and an empty text when the editor is empty", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={onSubmit} />);
    fillRequired();
    write("<p>Linux <strong>na</strong> prática</p>");
    create();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.lastCall?.[0].summary).toBe("<p>Linux <strong>na</strong> prática</p>");

    act(() => {
      summary().editor.chain().selectAll().deleteSelection().run();
    });
    create();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.lastCall?.[0].summary).toBe("");
  });

  it("refuses more than 300 visible characters next to the field, marks the tab and does not send", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={onSubmit} />);
    fillRequired();
    write(`<p>${"a".repeat(301)}</p>`);
    create();

    await waitFor(() => expect(summaryError()).toMatch(/300 caracteres/));
    expect(summary().getAttribute("aria-describedby")).toContain("summary-error");
    expect(screen.getByRole("tab", { name: /Informações/ }).getAttribute("data-invalid")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();

    write(`<p>${"a".repeat(300)}</p>`);
    create();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("refuses a summary whose html is too big even with little text", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ClassForm onSubmit={onSubmit} />);
    fillRequired();
    // 100 links of two letters, 299 characters of text and over 5,000 characters of html
    const links = Array.from({ length: 100 }, (_, i) => `<a href="https://example.test/${i}/${"p".repeat(20)}">aa</a>`).join(" ");
    write(`<p>${links}</p>`);
    create();
    await waitFor(() => expect(summaryError()).toMatch(/formatação demais/));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("puts a summary error from the server on the summary field", async () => {
    const problem = new ApiProblemError({ type: "invalid-summary", status: 400, field: "summary" }, 400);
    render(<ClassForm onSubmit={vi.fn().mockRejectedValue(problem)} />);
    fillRequired();
    create();
    await waitFor(() => expect(summaryError()).toMatch(/300 caracteres/));
    expect(screen.getByRole("tab", { name: /Informações/ }).getAttribute("data-invalid")).toBe("true");
  });
});
