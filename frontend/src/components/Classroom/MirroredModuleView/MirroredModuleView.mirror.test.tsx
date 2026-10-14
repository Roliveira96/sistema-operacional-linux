import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalStep } from "@/engine/terminalWindow";
import type { ScreenElement, ScreenNode } from "@/engine/terminalScreen";
import { MirroredModuleView } from "./MirroredModuleView";

// The real terminal engine on purpose: what a step run by the teacher's terminal shows must reach the picture that goes to the class.
vi.setConfig({ testTimeout: 30_000 });

afterEach(cleanup);

type Run = (step: TerminalStep) => Promise<number | null>;

const textOf = (node: ScreenNode): string => (typeof node === "string" ? node : (node.children ?? []).map(textOf).join(""));
const hasClass = (node: ScreenElement, name: string) => (node.attrs?.class as string | undefined)?.split(" ").includes(name) ?? false;
const findAll = (node: ScreenNode, test: (element: ScreenElement) => boolean): ScreenElement[] => {
  if (typeof node === "string") return [];
  return [...(test(node) ? [node] : []), ...(node.children ?? []).flatMap((child) => findAll(child, test))];
};

// SPEC-060 CA-01: the example is typed on the screen at the normal speed, and the class sees the typing and the output through the picture
describe("a step run by the terminal of the teacher, as the class sees it", () => {
  it("is typed on the screen, then printed, and both go out in the pictures of the window that the student's copy draws", async () => {
    const pictures: ScreenElement[] = [];
    let runner: Run | null = null;
    render(<MirroredModuleView role="teacher" terminal={{ screen: null }} onScreen={(tree) => pictures.push(tree)} onRunner={(run) => (runner = run)} />);
    await waitFor(() => expect(runner).not.toBeNull());

    // The command has two spaces and the output one, so the output cannot be mistaken for the line that was typed.
    const command = "echo ola  aula";
    const entry = (picture: ScreenElement) => findAll(picture, (element) => hasClass(element, "term-entrada")).map(textOf).join("");
    const done = runner!({ command });

    // While it is being typed the class already has part of the line, and not the output.
    await waitFor(() => expect(pictures.some((picture) => entry(picture).includes("echo ola") && !textOf(picture).includes("ola aula"))).toBe(true));
    expect(await done).toBe(0);

    await waitFor(() => expect(textOf(pictures.at(-1)!)).toContain("ola aula"));
    const last = pictures.at(-1)!;
    expect(textOf(last)).toContain(command);

    // The student's copy draws that picture: it has the typed line and what it printed.
    cleanup();
    render(<MirroredModuleView role="student" terminal={{ screen: last }} />);
    const copy = screen.getByTestId("terminal-mirror").textContent ?? "";
    expect(copy).toContain(command);
    expect(copy).toContain("ola aula");
  });

  it("opens the terminal that the step names, and the class sees the new tab, with the login typed", async () => {
    const pictures: ScreenElement[] = [];
    let runner: Run | null = null;
    render(<MirroredModuleView role="teacher" terminal={{ screen: null }} onScreen={(tree) => pictures.push(tree)} onRunner={(run) => (runner = run)} />);
    await waitFor(() => expect(runner).not.toBeNull());
    expect(await runner!({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } })).toBe(0);
    await waitFor(() => expect(findAll(pictures.at(-1)!, (element) => hasClass(element, "janela-aba"))).toHaveLength(2));
  });

  it("gives null at once, with no wait, while a command still runs in the terminal that the step asks for", async () => {
    let runner: Run | null = null;
    render(<MirroredModuleView role="teacher" terminal={{ screen: null }} onScreen={() => undefined} onRunner={(run) => (runner = run)} />);
    await waitFor(() => expect(runner).not.toBeNull());
    const slow = runner!({ command: "sleep 3" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const started = Date.now();
    expect(await runner!({ command: "echo ola" })).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    expect(await slow).toBe(0);
    expect(await runner!({ command: "echo ola" })).toBe(0);
  });
});
