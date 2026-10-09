import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineIO, EngineSession, OutputChunk } from "@/engine/engine";
import { contentMessages } from "@/messages/content.pt-BR";
import { Terminal, type TerminalHandle } from "./Terminal";

afterEach(cleanup);

const m = contentMessages.practice;

/** Fake engine: echoes commands and exercises the IO hooks on special commands. */
function fakeEngine() {
  const ran: string[] = [];
  let io: EngineIO;
  const session: EngineSession = {
    prompt: () => ({ user: "root", host: "lab", path: "~", isRoot: true }),
    run: async (line: string, write: (c: OutputChunk) => void) => {
      ran.push(line);
      if (line === "passwd") {
        const answer = await io.ask("New password: ", true);
        write({ text: `got ${answer.length} chars\n`, tone: "success" });
      } else if (line === "nano f") {
        const saved = await io.edit({ editor: "nano", path: "/root/f", content: "old", isNew: false, readOnly: false, warning: null });
        write({ text: `saved: ${saved}\n` });
      } else if (line === "clear") {
        io.clear();
      } else {
        write({ text: `out:${line}\n`, tone: "directory" });
      }
    },
    snapshot: () => ({ state: ran.length }),
  };
  const create = vi.fn(async (_snapshot: unknown, ioArg: EngineIO) => {
    io = ioArg;
    return session;
  });
  return { create, ran };
}

async function mount() {
  const engine = fakeEngine();
  const ref = createRef<TerminalHandle>();
  await act(async () => {
    render(<Terminal ref={ref} snapshot={{ s: 1 }} create={engine.create} />);
  });
  const input = screen.getByLabelText(m.inputLabel) as HTMLInputElement;
  const type = async (text: string) => {
    fireEvent.change(screen.getByRole("textbox") ?? input, { target: { value: text } });
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? input, { key: "Enter" });
    });
  };
  return { engine, ref, input, type };
}

// Covers SPEC-014 CA-01 and CA-10 (terminal side).
describe("Terminal", () => {
  it("runs commands, shows prompt and output with tones and exposes the snapshot", async () => {
    const { engine, ref, type } = await mount();
    await type("ls");
    expect(screen.getByRole("log").textContent).toContain("root@lab:~# ls");
    expect(screen.getByText("out:ls").className).toContain("directory");
    expect(engine.ran).toEqual(["ls"]);
    expect(ref.current?.snapshot()).toEqual({ state: 1 });
  });

  it("colors the current prompt like the history prompts for root", async () => {
    const { type } = await mount();
    await type("ls");
    const history = screen.getByText("root@lab:~#", { selector: "pre span span" });
    const current = screen.getByText("root@lab:~#", { selector: "label span" });
    expect(current.className).toBe(history.className);
    expect(current.className).toContain("promptRoot");
  });

  it("navigates the history with the arrow keys and clears with Ctrl+L", async () => {
    const { input, type } = await mount();
    await type("first");
    await type("second");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("second");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("first");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("second");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "l", ctrlKey: true });
    expect(screen.getByRole("log").textContent).toBe("");
  });

  it("answers interactive questions with a hidden input", async () => {
    const { type } = await mount();
    await type("passwd");
    const hidden = screen.getByLabelText(m.hiddenInput) as HTMLInputElement;
    expect(hidden.type).toBe("password");
    fireEvent.change(hidden, { target: { value: "secret" } });
    await act(async () => {
      fireEvent.keyDown(hidden, { key: "Enter" });
    });
    expect(screen.getByRole("log").textContent).toContain("got 6 chars");
    expect(screen.getByRole("log").textContent).not.toContain("secret");
  });

  it("cancels the current line or question with Ctrl+C", async () => {
    const { input, type } = await mount();
    fireEvent.change(input, { target: { value: "half typed" } });
    fireEvent.keyDown(input, { key: "c", ctrlKey: true });
    expect(screen.getByRole("log").textContent).toContain("half typed^C");
    await type("passwd");
    const hidden = screen.getByLabelText(m.hiddenInput);
    await act(async () => {
      fireEvent.keyDown(hidden, { key: "c", ctrlKey: true });
    });
    expect(screen.getByRole("log").textContent).toContain("got 0 chars");
  });

  // Covers SPEC-014 CA-09 (terminal side).
  it("opens the nano dialog and returns the saved text", async () => {
    const { type } = await mount();
    await type("nano f");
    const editor = screen.getByRole("dialog");
    fireEvent.change(screen.getByLabelText(contentMessages.nano.contentLabel), { target: { value: "new text" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: contentMessages.nano.save }));
    });
    expect(editor.isConnected).toBe(false);
    expect(screen.getByRole("log").textContent).toContain("saved: new text");
  });

  it("clears the screen when the engine asks", async () => {
    const { type } = await mount();
    await type("ls");
    await type("clear");
    expect(screen.getByRole("log").textContent).toBe("");
  });

  it("reports engine failures and shows a loading state", async () => {
    const onError = vi.fn();
    const create = vi.fn().mockRejectedValue(new Error("bad snapshot"));
    await act(async () => {
      render(<Terminal snapshot={{}} create={create} onError={onError} />);
    });
    expect(onError).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(m.loadingTerminal);
  });

  it.each(["light", "dark"])("renders the same structure in the %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    await mount();
    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });
});
