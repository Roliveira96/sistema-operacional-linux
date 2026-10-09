import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockForm } from "./BlockForm";
import { blockSummary, emptyPayload, type Payload } from "./blockModel";

afterEach(cleanup);

/** Keeps the payload in state, as the panel does, and reports every change. */
function Harness({ type, initial, errors = {}, onChange }: { type: string; initial?: Payload; errors?: Record<string, string>; onChange: (p: Payload) => void }) {
  const [payload, setPayload] = useState<Payload>(initial ?? emptyPayload(type));
  return (
    <BlockForm
      type={type}
      payload={payload}
      errors={errors}
      onChange={(next) => {
        setPayload(next);
        onChange(next);
      }}
    />
  );
}

const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0] as Payload;

describe("BlockForm", () => {
  it("edits the title and the card label of a text block", () => {
    const onChange = vi.fn();
    render(<Harness type="TEXT" onChange={onChange} errors={{ title: "Ruim" }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Título" }), { target: { value: "Processos" } });
    fireEvent.change(screen.getByLabelText("Rótulo curto do card"), { target: { value: "ps" } });
    expect(last(onChange)).toMatchObject({ title: "Processos", command: "ps" });
    expect(screen.getByText("Ruim")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Texto" })).toBeDefined();
  });

  it("chooses the variant of a tip", () => {
    const onChange = vi.fn();
    render(<Harness type="TIP" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Tipo de aviso"), { target: { value: "WARNING" } });
    expect(last(onChange)).toMatchObject({ variant: "WARNING" });
  });

  it("edits command steps: fields, terminal login, answers, order and removal", () => {
    const onChange = vi.fn();
    render(<Harness type="COMMAND" onChange={onChange} errors={{ "steps[0].command": "Obrigatório." }} />);
    expect(screen.getByText("Obrigatório.")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Comando (1)"), { target: { value: "ls" } });
    fireEvent.change(screen.getByLabelText("O que o comando faz (1)"), { target: { value: "lista" } });
    fireEvent.change(screen.getByLabelText("Explicação do resultado (1)"), { target: { value: "veja" } });
    fireEvent.change(screen.getByLabelText("Respostas às perguntas do comando (uma por linha) (1)"), { target: { value: "s\nn" } });
    fireEvent.change(screen.getByLabelText("Terminal (1)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Usuário (1)"), { target: { value: "ana" } });
    fireEvent.change(screen.getByLabelText("Senha (1)"), { target: { value: "123" } });

    expect(last(onChange)).toMatchObject({
      steps: [{ command: "ls", explanation: "lista", outputExplanation: "veja", terminal: 2, login: { user: "ana", password: "123" }, answers: ["s", "n"] }],
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar passo" }));
    fireEvent.change(screen.getByLabelText("Comando (2)"), { target: { value: "pwd" } });
    fireEvent.click(screen.getByRole("button", { name: "Subir passo 2" }));
    expect((last(onChange).steps as { command: string }[]).map((s) => s.command)).toEqual(["pwd", "ls"]);
    fireEvent.click(screen.getByRole("button", { name: "Remover passo 1" }));
    expect((last(onChange).steps as unknown[]).length).toBe(1);
    expect((screen.getByRole("button", { name: "Remover passo 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits the steps of a step-by-step block", () => {
    const onChange = vi.fn();
    render(<Harness type="STEP_BY_STEP" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Passo 1"), { target: { value: "abra" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar passo" }));
    fireEvent.change(screen.getByLabelText("Passo 2"), { target: { value: "feche" } });
    fireEvent.click(screen.getByRole("button", { name: "Descer passo 1" }));
    expect(last(onChange).steps).toEqual(["feche", "abra"]);
  });

  it("edits cards", () => {
    const onChange = vi.fn();
    render(<Harness type="CARDS" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Título do cartão (1)"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Texto do cartão (1)"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar cartão" }));
    expect(last(onChange).cards).toEqual([
      { title: "A", text: "a" },
      { title: "", text: "" },
    ]);
  });

  it("chooses a widget and edits legacy html", () => {
    const widget = vi.fn();
    render(<Harness type="WIDGET" onChange={widget} />);
    fireEvent.change(screen.getByLabelText("Componente"), { target: { value: "LS_ANATOMY" } });
    expect(last(widget)).toMatchObject({ component: "LS_ANATOMY" });
    cleanup();

    const html = vi.fn();
    render(<Harness type="LEGACY_HTML" onChange={html} />);
    fireEvent.change(screen.getByLabelText("Código HTML"), { target: { value: "<h3>x</h3>" } });
    expect(last(html)).toEqual({ html: "<h3>x</h3>" });
  });
});

describe("blockSummary", () => {
  it("summarises each type in one line", () => {
    expect(blockSummary("TEXT", { title: "Título", html: "<p>x</p>" })).toBe("Título");
    expect(blockSummary("TEXT", { html: "<p>só <code>texto</code></p>" })).toBe("só texto");
    expect(blockSummary("COMMAND", { steps: [{ command: "ls" }, { command: "pwd" }] })).toBe("ls (+1)");
    expect(blockSummary("STEP_BY_STEP", { steps: ["um", "dois"] })).toBe("um");
    expect(blockSummary("CARDS", { cards: [{ title: "a" }, { title: "b" }] })).toBe("a · b");
    expect(blockSummary("WIDGET", { component: "LS_ANATOMY" })).toBe("Anatomia do ls -l");
    expect(blockSummary("TEXT", {})).toBe("—");
    expect(blockSummary("TEXT", { html: "x".repeat(200) }).length).toBeLessThanOrEqual(91);
  });

  it("starts every type with something editable", () => {
    for (const type of ["TEXT", "COMMAND", "TIP", "CURIOSITY", "STEP_BY_STEP", "CARDS", "WIDGET", "LEGACY_HTML"]) {
      expect(Object.keys(emptyPayload(type)).length).toBeGreaterThan(0);
    }
  });
});
