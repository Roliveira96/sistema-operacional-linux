import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaseResult, ConformanceReport, SuiteResult, VerifyOptions } from "@/engine/conformance";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { EngineConformance } from "./EngineConformance";

afterEach(cleanup);

const ok = (command: string, output = "saida"): CaseResult => ({ command, passed: true, status: 0, output, truncated: false, expected: "status 0" });
const bad = (command: string): CaseResult => ({ command, passed: false, status: 2, output: "erro do motor", truncated: false, expected: "status 0" });
const suite = (name: string, cases: CaseResult[], kind: "command" | "program" = "command"): SuiteResult => ({
  suite: { name, kind, group: kind === "command" ? "arquivos" : "programas", cases: [] },
  passed: cases.every((test) => test.passed),
  cases,
});
const report = (suites: SuiteResult[], uncovered: string[] = []): ConformanceReport => {
  const all = suites.flatMap((s) => s.cases);
  const casesFailed = all.filter((test) => !test.passed).length;
  const failed = suites.filter((s) => !s.passed).length;
  return { suites, passed: suites.length - failed, failed, casesPassed: all.length - casesFailed, casesFailed, transcript: "$ ls\nsaida\n[exit 0 · ok]\n\n", uncovered, conformant: failed === 0 && uncovered.length === 0 && suites.length > 0 };
};
/** Opens the screen and starts the verification, as the administrator does (CA-03). */
const view = (ui: React.ReactElement) => {
  const rendered = render(ui);
  fireEvent.click(screen.getByRole("button", { name: "Iniciar a verificação" }));
  return rendered;
};
const names = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded")).map((b) => b.getAttribute("aria-label"));

describe("EngineConformance", () => {
  // Covers SPEC-030 CA-03: opening the screen runs nothing; the administrator chooses to start.
  it("does not run on opening: it explains the size of the verification and waits for the start", () => {
    const verify = vi.fn(() => new Promise<ConformanceReport>(() => {}));
    render(<EngineConformance verify={verify} />);
    expect(verify).not.toHaveBeenCalled();
    expect(screen.getByText(/A verificação executa, neste navegador, \d+ comandos e programas do simulador com [\d.]+ casos de teste/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar a verificação" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Executar de novo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(document.querySelector('[aria-label="Terminal da verificação, ao vivo"]')).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar a verificação" }));
    expect(verify).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Iniciar a verificação" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  // Covers SPEC-030 CA-03: the verification starts by itself and shows the progress in cases.
  it("shows the progress in cases after the start, announcing it every 10%", async () => {
    let finish: (value: ConformanceReport) => void = () => {};
    const verify = vi.fn((onProgress?: (p: { done: number; total: number; current: string }) => void) => {
      onProgress?.({ done: 250, total: 1000, current: "ls -la" });
      return new Promise<ConformanceReport>((resolve) => (finish = resolve));
    });
    view(<EngineConformance verify={verify} />);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("250 de 1000 casos · ls -la")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Verificação em 20%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executar de novo" })).toHaveProperty("disabled", true);
    finish(report([suite("ls", [ok("ls")])]));
    await screen.findByText("Em conformidade");
  });

  // Covers SPEC-030 CA-22, RN-15: the live terminal is on the screen, with no control that slows it or turns the typing off.
  it("gives the engine a place for the live terminal and offers no speed control", async () => {
    let received: { host?: HTMLElement } = {};
    const verify = vi.fn((_: unknown, options?: VerifyOptions) => {
      received = options ?? {};
      return new Promise<ConformanceReport>(() => {});
    });
    view(<EngineConformance verify={verify} />);
    const terminal = screen.getByRole("region", { name: "Terminal da verificação, ao vivo" });
    expect(terminal).not.toHaveAttribute("hidden");
    expect(received.host).toBe(terminal);
    expect(received).not.toHaveProperty("speed");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  // Covers SPEC-030 CA-23, RN-16: the terminal stays on the screen after the run, with a hint to copy, and closes when the screen runs again or goes away.
  it("keeps the terminal on the screen when the result is shown, and closes it on running again and on leaving", async () => {
    const destroy = vi.fn();
    const verify = vi.fn(async (_: unknown, options?: VerifyOptions) => {
      options?.onWindow?.({ destroy } as unknown as TerminalWindow);
      return report([suite("ls", [ok("ls")])]);
    });
    const { unmount } = view(<EngineConformance verify={verify} />);
    await screen.findByText("Em conformidade");
    expect(screen.getByRole("region", { name: "Terminal da verificação, ao vivo" })).not.toHaveAttribute("hidden");
    expect(screen.getByText(/Selecione o texto para copiar/)).toBeInTheDocument();
    expect(destroy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Executar de novo" }));
    await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
    await screen.findByText("Em conformidade");
    unmount();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it("says the engine is being prepared until the first case runs", () => {
    view(<EngineConformance verify={() => new Promise(() => {})} />);
    expect(screen.getAllByText("Preparando o motor…").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  // Covers SPEC-030 CA-04: the green seal only when everything passed; CA-16: the totals count cases.
  it("shows the seal of conformance and the totals of commands and cases", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls"), ok("ls -a")]), suite("cat", [ok("cat a.txt")])])} />);
    expect(await screen.findByText("Em conformidade")).toBeInTheDocument();
    expect(screen.getByText("Comandos e programas").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Casos executados").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Casos com falha").nextSibling).toHaveTextContent("0");
    // Nothing failed, so the filter does not hide the list.
    expect(screen.getByRole("checkbox", { name: "Só falhas" })).toHaveProperty("disabled", true);
    expect(names()).toEqual(["Casos de ls", "Casos de cat"]);
  });

  // Covers SPEC-030 CA-16, CA-18: a suite opens to show every case with the command, what was expected and what the engine answered.
  it("opens and closes a suite to show all of its cases", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls"), ok("ls -la /tmp/lab", "a.txt")])])} />);
    await screen.findByText("Em conformidade");
    const toggle = screen.getByRole("button", { name: "Casos de ls" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("ls -la /tmp/lab")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("list", { name: "Casos executados de ls" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("ls -la /tmp/lab")).toBeInTheDocument();
    expect(within(list).getAllByText(/Esperado: status 0 · código 0/)).toHaveLength(2);
    expect(within(list).getByText("a.txt")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole("list", { name: "Casos executados de ls" })).not.toBeInTheDocument();
  });

  // Covers SPEC-030 CA-05, CA-18, CA-15: the failing suites come first and open, and the filter starts on them.
  it("puts the failing suite first and open, with the failed case and what the engine answered", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls")]), suite("sshd", [ok("sshd -t"), bad("sshd -x")], "program"), suite("cat", [ok("cat a.txt")])])} />);
    expect(await screen.findByText("Fora de conformidade: 1 caso falhou")).toBeInTheDocument();
    expect(names()).toEqual(["Casos de sshd"]);
    const toggle = screen.getByRole("button", { name: "Casos de sshd" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("1 de 2 casos aprovados")).toBeInTheDocument();
    expect(screen.getByText("sshd -x")).toBeInTheDocument();
    expect(screen.getByText("erro do motor")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Só falhas" }));
    expect(names()).toEqual(["Casos de sshd", "Casos de ls", "Casos de cat"]);
    fireEvent.click(screen.getByRole("button", { name: "Fechar todos" }));
    expect(screen.queryByRole("list", { name: "Casos executados de sshd" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir todos" }));
    expect(screen.getAllByRole("list", { name: /Casos executados de/ })).toHaveLength(3);
  });

  // Covers SPEC-030 CA-19: the search finds by the name of the suite and by the command of any case, without running again.
  it("searches by the name of the command and by the text of a case", async () => {
    const verify = vi.fn(async () => report([suite("ls", [ok("ls"), ok("ls -la")]), suite("grep", [ok("grep -n apple frutas.txt")]), suite("cat", [ok("cat a.txt")])]));
    view(<EngineConformance verify={verify} />);
    await screen.findByText("Em conformidade");
    fireEvent.change(screen.getByLabelText("Buscar por comando ou caso"), { target: { value: "-LA" } });
    expect(names()).toEqual(["Casos de ls"]);
    fireEvent.change(screen.getByLabelText("Buscar por comando ou caso"), { target: { value: "cat" } });
    expect(names()).toEqual(["Casos de cat"]);
    fireEvent.change(screen.getByLabelText("Buscar por comando ou caso"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum comando encontrado.")).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  // Covers SPEC-030 CA-20: an output that was cut says so.
  it("warns when the output of a case was cut", async () => {
    const cut: CaseResult = { ...ok("cat grande.txt", "x".repeat(50)), truncated: true };
    view(<EngineConformance verify={async () => report([suite("cat", [cut])])} />);
    await screen.findByText("Em conformidade");
    fireEvent.click(screen.getByRole("button", { name: "Casos de cat" }));
    expect(screen.getByText("Saída cortada em 2000 caracteres.")).toBeInTheDocument();
  });

  it("is not conformant when a name of the catalog has no suite", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls")])], ["nproc"])} />);
    expect(await screen.findByText("Fora de conformidade: 1 caso falhou")).toBeInTheDocument();
    expect(screen.getByText("Sem suíte no manifesto: nproc.")).toBeInTheDocument();
  });

  // Covers SPEC-030 CA-07: an error of the engine shows the error and no seal.
  it("shows the error and no seal when the engine breaks, and tries again", async () => {
    const verify = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(report([suite("ls", [ok("ls")])]));
    view(<EngineConformance verify={verify} />);
    expect(await screen.findByText("Não foi possível verificar o motor: boom")).toBeInTheDocument();
    expect(screen.queryByText("Em conformidade")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Em conformidade")).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  // Covers SPEC-030 CA-08: running again starts from zero.
  it("runs again from zero", async () => {
    const verify = vi.fn().mockResolvedValueOnce(report([suite("sshd", [bad("sshd -x")], "program")])).mockResolvedValueOnce(report([suite("sshd", [ok("sshd -t")], "program")]));
    view(<EngineConformance verify={verify} />);
    await screen.findByText("Fora de conformidade: 1 caso falhou");
    fireEvent.click(screen.getByRole("button", { name: "Executar de novo" }));
    await waitFor(() => expect(screen.getByText("Em conformidade")).toBeInTheDocument());
    expect(screen.queryByText("sshd -x")).not.toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  // Covers SPEC-030 CA-24, RN-17: copy every command, or only the failures, to export them.
  it("copies every command with its state, or only the failures", async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls -la"), bad("ls /x")])])} copyText={copyText} />);
    await screen.findByText("Fora de conformidade: 1 caso falhou");
    fireEvent.click(screen.getByRole("button", { name: "Copiar todos os comandos" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    expect(copyText.mock.calls[0]![0]).toContain("[ok] $ ls -la");
    expect(copyText.mock.calls[0]![0]).toContain("[FAILED] $ ls /x");
    expect(await screen.findByText("Copiado: copiar todos os comandos.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copiar só as falhas" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(2));
    expect(copyText.mock.calls[1]![0]).not.toContain("ls -la");
    expect(copyText.mock.calls[1]![0]).toContain("[FAILED] $ ls /x");
  });

  it("disables copying only the failures when nothing failed, and says when it could not copy", async () => {
    const copyText = vi.fn().mockRejectedValue(new Error("denied"));
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls")])])} copyText={copyText} />);
    await screen.findByText("Em conformidade");
    expect(screen.getByRole("button", { name: "Copiar só as falhas" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Copiar todos os comandos" }));
    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument();
  });

  // Covers SPEC-030 CA-26, RN-19: the terminal, everything that was printed, goes to a text file to analyse.
  it("downloads everything the terminal printed as a text file", async () => {
    const download = vi.fn();
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls")])])} download={download} />);
    await screen.findByText("Em conformidade");
    fireEvent.click(screen.getByRole("button", { name: "Baixar o terminal (.txt)" }));
    expect(download).toHaveBeenCalledTimes(1);
    const [filename, text] = download.mock.calls[0]!;
    expect(filename).toMatch(/^terminal-conformidade-\d{4}-\d{2}-\d{2}-\d{4}\.txt$/);
    expect(text).toContain("# Terminal of the engine conformance (SPEC-030)");
    expect(text).toContain("$ ls\nsaida\n[exit 0 · ok]");
  });

  // Covers SPEC-030 CA-27, RN-20: every command, or only the failures, goes to a text file.
  it("downloads every command, or only the failures, as a text file", async () => {
    const download = vi.fn();
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls -la"), bad("ls /x")])])} download={download} />);
    await screen.findByText("Fora de conformidade: 1 caso falhou");
    fireEvent.click(screen.getByRole("button", { name: "Baixar todos os comandos (.txt)" }));
    expect(download.mock.calls[0]![0]).toMatch(/^comandos-conformidade-\d{4}-\d{2}-\d{2}-\d{4}\.txt$/);
    expect(download.mock.calls[0]![1]).toContain("[ok] $ ls -la");
    fireEvent.click(screen.getByRole("button", { name: "Baixar só as falhas (.txt)" }));
    expect(download.mock.calls[1]![0]).toMatch(/^falhas-conformidade-/);
    expect(download.mock.calls[1]![1]).not.toContain("ls -la");
    expect(download.mock.calls[1]![1]).toContain("[FAILED] $ ls /x");
  });

  it("disables downloading only the failures when nothing failed", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls")])])} />);
    await screen.findByText("Em conformidade");
    expect(screen.getByRole("button", { name: "Baixar só as falhas (.txt)" })).toHaveProperty("disabled", true);
  });

  // Covers SPEC-030 CA-28, RN-20: with "only failures" the passed cases leave the suite; the search narrows the cases too.
  it("hides the passed cases while only failures is on, and shows them again when it is off", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [ok("ls -la"), bad("ls /x")])])} />);
    await screen.findByText("Fora de conformidade: 1 caso falhou");
    expect(screen.getByText("ls /x")).toBeInTheDocument();
    expect(screen.queryByText("ls -la")).not.toBeInTheDocument();
    expect(screen.getByText("mostrando 1 de 2 casos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Só falhas" }));
    expect(screen.getByText("ls -la")).toBeInTheDocument();
    expect(screen.queryByText("mostrando 1 de 2 casos")).not.toBeInTheDocument();
  });

  it("narrows the cases by the search, unless the name of the suite matches", async () => {
    view(<EngineConformance verify={async () => report([suite("ls", [bad("ls -la"), bad("ls /x")])])} />);
    await screen.findByText("Fora de conformidade: 2 casos falharam");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "/x" } });
    expect(screen.queryByText("ls -la")).not.toBeInTheDocument();
    expect(screen.getByText("ls /x")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ls" } });
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  // Covers SPEC-032 CA-01, CA-04: the quick mode is off by default, goes to the run when chosen, and is locked while it runs.
  it("offers the quick mode, off by default, and locks it while the verification runs", async () => {
    let finish: (value: ConformanceReport) => void = () => {};
    const verify = vi.fn((...args: [unknown?, VerifyOptions?]) => new Promise<ConformanceReport>((resolve) => ((finish = resolve), void args)));
    render(<EngineConformance verify={verify as never} />);
    const quick = screen.getByRole("checkbox", { name: "Modo rápido (sem animação de digitação)" });
    expect(quick).toHaveProperty("checked", false);
    fireEvent.click(quick);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar a verificação" }));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    expect(verify.mock.calls[0]![1]?.instant).toBe(true);
    expect(quick).toHaveProperty("disabled", true);
    finish(report([suite("ls", [ok("ls")])]));
    await screen.findByText("Em conformidade");
    expect(quick).toHaveProperty("disabled", false);
  });

  it("does not show a late result after it is closed", async () => {
    let finish: (value: ConformanceReport) => void = () => {};
    const { unmount } = view(<EngineConformance verify={() => new Promise((resolve) => (finish = resolve))} />);
    unmount();
    finish(report([suite("ls", [ok("ls")])]));
    expect(screen.queryByText("Em conformidade")).not.toBeInTheDocument();
  });
});
