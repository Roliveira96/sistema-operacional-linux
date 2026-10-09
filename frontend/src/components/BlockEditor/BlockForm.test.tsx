import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlockForm } from "./BlockForm";
import { KINDS, blockSummary, kindOf, newBlockOf, type Kind, type Payload } from "./blockModel";

afterEach(cleanup);

/** Keeps the payload in state, as the panel does, and reports every change. */
function Harness({ kind, errors = {}, onChange }: { kind: Kind; errors?: Record<string, string>; onChange: (p: Payload) => void }) {
  const [payload, setPayload] = useState<Payload>(newBlockOf(kind).payload);
  return (
    <BlockForm
      kind={kind}
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
  it("asks only for the formatted text in an HTML / Texto block (CA-24)", () => {
    render(<Harness kind="HTML" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Texto" })).toBeDefined();
    expect(screen.queryByLabelText("Título principal do card")).toBeNull();
    expect(screen.queryByLabelText("Tag / Pill (badge)")).toBeNull();
  });

  it("edits the pill and the title of a card", () => {
    const onChange = vi.fn();
    render(<Harness kind="CARD" onChange={onChange} errors={{ title: "Ruim" }} />);
    fireEvent.change(screen.getByLabelText("Título principal do card"), { target: { value: "Processos" } });
    fireEvent.change(screen.getByLabelText("Tag / Pill (badge)"), { target: { value: "ps" } });
    expect(last(onChange)).toMatchObject({ title: "Processos", command: "ps" });
    expect(screen.getByText("Ruim")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Texto" })).toBeDefined();
  });

  it("starts a tip, an exam alert and a real-world box with the right variant and title", () => {
    expect(newBlockOf("TIP")).toEqual({ type: "TIP", payload: { variant: "DEFAULT", title: "", html: "" } });
    expect(newBlockOf("EXAM")).toEqual({ type: "TIP", payload: { variant: "WARNING", title: "Cai na prova", html: "" } });
    expect(newBlockOf("REAL")).toEqual({ type: "CURIOSITY", payload: { title: "Na vida real", html: "" } });

    const onChange = vi.fn();
    render(<Harness kind="TIP" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Certificação"), { target: { value: "LPIC-1 102.4" } });
    expect(last(onChange)).toMatchObject({ variant: "DEFAULT", title: "LPIC-1 102.4" });
  });

  it("edits command steps: fields, terminal login, answers, order and removal", () => {
    const onChange = vi.fn();
    render(<Harness kind="COMMAND" onChange={onChange} errors={{ "steps[0].command": "Obrigatório." }} />);
    expect(screen.getByText("Obrigatório.")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Linha de comando (1)"), { target: { value: "ls" } });
    fireEvent.change(screen.getByLabelText("Descrição explicativa (antes de rodar) (1)"), { target: { value: "lista" } });
    fireEvent.change(screen.getByLabelText("Descrição oculta pós-execução (mostrada depois que o aluno roda) (1)"), { target: { value: "veja" } });
    fireEvent.change(screen.getByLabelText("Terminal (1)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Respostas às perguntas do comando (uma por linha) (1)"), { target: { value: "s\nn" } });
    fireEvent.change(screen.getByLabelText("Usuário (1)"), { target: { value: "ana" } });
    fireEvent.change(screen.getByLabelText("Senha (1)"), { target: { value: "123" } });

    expect(last(onChange)).toMatchObject({
      steps: [{ command: "ls", explanation: "lista", outputExplanation: "veja", terminal: 2, login: { user: "ana", password: "123" }, answers: ["s", "n"] }],
    });

    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar passo" }));
    fireEvent.change(screen.getByLabelText("Linha de comando (2)"), { target: { value: "pwd" } });
    fireEvent.click(screen.getByRole("button", { name: "Subir passo 2" }));
    expect((last(onChange).steps as { command: string }[]).map((s) => s.command)).toEqual(["pwd", "ls"]);
    fireEvent.click(screen.getByRole("button", { name: "Remover passo 1" }));
    expect((last(onChange).steps as unknown[]).length).toBe(1);
    expect((screen.getByRole("button", { name: "Remover passo 1" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("edits the steps of a step-by-step block", () => {
    const onChange = vi.fn();
    render(<Harness kind="STEPS" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Passo 1"), { target: { value: "abra" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar passo" }));
    fireEvent.change(screen.getByLabelText("Passo 2"), { target: { value: "feche" } });
    fireEvent.click(screen.getByRole("button", { name: "Descer passo 1" }));
    expect(last(onChange).steps).toEqual(["feche", "abra"]);
  });

  it("edits cards", () => {
    const onChange = vi.fn();
    render(<Harness kind="CARDS" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Título do cartão (1)"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Texto do cartão (1)"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar cartão" }));
    expect(last(onChange).cards).toEqual([
      { title: "A", text: "a" },
      { title: "", text: "" },
    ]);
  });

  it("chooses a widget and edits advanced html", () => {
    const widget = vi.fn();
    render(<Harness kind="WIDGET" onChange={widget} />);
    fireEvent.change(screen.getByLabelText("Componente"), { target: { value: "LS_ANATOMY" } });
    expect(last(widget)).toMatchObject({ component: "LS_ANATOMY" });
    cleanup();

    const html = vi.fn();
    render(<Harness kind="RAW_HTML" onChange={html} />);
    fireEvent.change(screen.getByLabelText("Código HTML"), { target: { value: "<h3>x</h3>" } });
    expect(last(html)).toEqual({ html: "<h3>x</h3>" });
  });
});

describe("kinds", () => {
  it("tells the kind of a stored block, and every kind round-trips", () => {
    expect(kindOf("TEXT", { html: "<p>x</p>" })).toBe("HTML");
    expect(kindOf("TEXT", { title: "Card", html: "<p>x</p>" })).toBe("CARD");
    expect(kindOf("TIP", { variant: "WARNING" })).toBe("EXAM");
    expect(kindOf("TIP", { variant: "DEFAULT" })).toBe("TIP");
    expect(kindOf("CURIOSITY", {})).toBe("REAL");
    expect(kindOf("LEGACY_HTML", {})).toBe("RAW_HTML");
    for (const kind of KINDS) {
      const { type, payload } = newBlockOf(kind);
      // A new card has no title yet, so it reads as plain text until the title is filled.
      const expected = kind === "CARD" ? "HTML" : kind;
      expect(kindOf(type, payload)).toBe(expected);
    }
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
});
