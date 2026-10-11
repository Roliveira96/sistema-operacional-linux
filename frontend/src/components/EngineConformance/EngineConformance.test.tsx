import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConformanceReport, ItemResult } from "@/engine/conformance";
import { EngineConformance } from "./EngineConformance";

afterEach(cleanup);

const pass = (name: string): ItemResult => ({ item: { name, kind: "command", group: "arquivos", command: name }, passed: true });
const fail = (name: string): ItemResult => ({
  item: { name, kind: "program", group: "programas", command: name },
  passed: false,
  failure: { command: `${name} -x`, expected: "status 0", got: "status 2: erro" },
});
const report = (results: ItemResult[], uncovered: string[] = []): ConformanceReport => {
  const failed = results.filter((r) => !r.passed).length;
  return { results, passed: results.length - failed, failed, uncovered, conformant: failed === 0 && uncovered.length === 0 && results.length > 0 };
};

describe("EngineConformance", () => {
  // Covers SPEC-030 CA-03: the verification starts by itself and shows the progress.
  it("starts on its own and shows the progress, announcing it every 10%", async () => {
    let finish: (value: ConformanceReport) => void = () => {};
    const verify = vi.fn((onProgress?: (p: { done: number; total: number; current: string }) => void) => {
      onProgress?.({ done: 25, total: 100, current: "grep" });
      return new Promise<ConformanceReport>((resolve) => (finish = resolve));
    });
    render(<EngineConformance verify={verify} />);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("25 de 100 itens · grep")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Verificação em 20%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Executar de novo" })).toHaveProperty("disabled", true);
    finish(report([pass("ls")]));
    await screen.findByText("Em conformidade");
  });

  it("says the engine is being prepared until the first item runs", () => {
    render(<EngineConformance verify={() => new Promise(() => {})} />);
    expect(screen.getAllByText("Preparando o motor…").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  // Covers SPEC-030 CA-04: the green seal only when everything passed.
  it("shows the seal of conformance and the totals", async () => {
    render(<EngineConformance verify={async () => report([pass("ls"), pass("cat")])} />);
    expect(await screen.findByText("Em conformidade")).toBeInTheDocument();
    expect(screen.getByText("Verificados").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Com falha").nextSibling).toHaveTextContent("0");
    // Nothing failed, so the filter does not hide the table.
    expect(screen.getByRole("checkbox", { name: "Só falhas" })).toHaveProperty("disabled", true);
    expect(screen.getByText("cat")).toBeInTheDocument();
  });

  // Covers SPEC-030 CA-05, CA-15: the failures come first, with the detail, and the filter starts on them.
  it("shows the failures with the command, the expectation and the answer, and filters", async () => {
    render(<EngineConformance verify={async () => report([pass("ls"), fail("sshd"), pass("cat")])} />);
    expect(await screen.findByText("Fora de conformidade: 1 item falhou")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).queryByText("ls")).not.toBeInTheDocument();
    expect(within(table).getByText("sshd -x")).toBeInTheDocument();
    expect(within(table).getByText("status 0")).toBeInTheDocument();
    expect(within(table).getByText("status 2: erro")).toBeInTheDocument();
    expect(within(table).getByText("Programa")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Só falhas" }));
    const names = within(screen.getByRole("table")).getAllByRole("rowheader").map((cell) => cell.textContent);
    expect(names).toEqual(["sshd", "ls", "cat"]);

    fireEvent.change(screen.getByLabelText("Buscar por nome"), { target: { value: "CA" } });
    expect(within(screen.getByRole("table")).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["cat"]);
    fireEvent.change(screen.getByLabelText("Buscar por nome"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum item encontrado.")).toBeInTheDocument();
  });

  it("is not conformant when a name of the catalog has no item", async () => {
    render(<EngineConformance verify={async () => report([pass("ls")], ["nproc"])} />);
    expect(await screen.findByText("Fora de conformidade: 1 item falhou")).toBeInTheDocument();
    expect(screen.getByText("Sem verificação no manifesto: nproc.")).toBeInTheDocument();
  });

  // Covers SPEC-030 CA-07: an error of the engine shows the error and no seal.
  it("shows the error and no seal when the engine breaks, and tries again", async () => {
    const verify = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(report([pass("ls")]));
    render(<EngineConformance verify={verify} />);
    expect(await screen.findByText("Não foi possível verificar o motor: boom")).toBeInTheDocument();
    expect(screen.queryByText("Em conformidade")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Em conformidade")).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  // Covers SPEC-030 CA-08: running again starts from zero.
  it("runs again from zero", async () => {
    const verify = vi.fn().mockResolvedValueOnce(report([fail("sshd")])).mockResolvedValueOnce(report([pass("sshd")]));
    render(<EngineConformance verify={verify} />);
    await screen.findByText("Fora de conformidade: 1 item falhou");
    fireEvent.click(screen.getByRole("button", { name: "Executar de novo" }));
    await waitFor(() => expect(screen.getByText("Em conformidade")).toBeInTheDocument());
    expect(screen.queryByText("sshd -x")).not.toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("does not show a late result after it is closed", async () => {
    let finish: (value: ConformanceReport) => void = () => {};
    const { unmount } = render(<EngineConformance verify={() => new Promise((resolve) => (finish = resolve))} />);
    unmount();
    finish(report([pass("ls")]));
    expect(screen.queryByText("Em conformidade")).not.toBeInTheDocument();
  });
});
