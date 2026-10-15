import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserNotice, NoticePermission } from "./browserNotice";
import { NoticeToggle } from "./NoticeToggle";

const UNAVAILABLE = "Este navegador ou este endereço não permite notificações. Use https ou localhost.";
const BLOCKED = "As notificações estão bloqueadas nas configurações do navegador.";

/** The access to the browser, as a double. What `requestPermission` answers is what the person chose in the box of the browser. */
function browser(permission: NoticePermission, answer: NoticePermission = "granted") {
  const state = { permission };
  const notice: BrowserNotice = {
    permission: vi.fn(() => state.permission),
    requestPermission: vi.fn(async () => {
      if (state.permission === "default") state.permission = answer;
      return state.permission;
    }),
    inView: vi.fn(() => false),
    show: vi.fn(),
  };
  return notice;
}

/** The parent that holds the choice, as the panel and the room do. */
function Harness({ notice, initial = true, onChange }: { notice: BrowserNotice; initial?: boolean; onChange?: (on: boolean) => void }) {
  const [enabled, setEnabled] = useState(initial);
  return (
    <NoticeToggle
      notice={notice}
      enabled={enabled}
      onChange={(on) => {
        onChange?.(on);
        setEnabled(on);
      }}
    />
  );
}

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const flush = () => act(async () => undefined);

afterEach(() => cleanup());

// SPEC-064 CA-05: the four states of the button "Notificações"
describe("NoticeToggle, when the browser has no notices", () => {
  it("is a disabled button with the hint, as text on the screen, when the API or the secure context is missing", () => {
    render(<Harness notice={browser("unsupported")} />);
    const toggle = button("Notificações");
    expect(toggle.disabled).toBe(true);
    const hint = screen.getByText(UNAVAILABLE);
    expect(hint.textContent).toBe(UNAVAILABLE);
    expect(toggle.getAttribute("aria-describedby")).toBe(hint.id);
    expect(hint.id).not.toBe("");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
  });

  it("asks for nothing when it is clicked", () => {
    const notice = browser("unsupported");
    render(<Harness notice={notice} />);
    fireEvent.click(button("Notificações"));
    expect(notice.requestPermission).not.toHaveBeenCalled();
  });

  it("is the same disabled button on the server, so the page and the browser agree when it comes alive", () => {
    const html = renderToString(<NoticeToggle notice={browser("granted")} enabled onChange={() => undefined} />);
    expect(html).toContain("disabled");
    expect(html).toContain(UNAVAILABLE);
    expect(html).not.toContain("aria-pressed");
  });
});

describe("NoticeToggle, when the permission was not asked yet", () => {
  it("offers 'Ativar notificações', enabled, with no hint", () => {
    render(<Harness notice={browser("default")} />);
    const toggle = button("Ativar notificações");
    expect(toggle.disabled).toBe(false);
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(BLOCKED)).toBeNull();
  });

  it("asks for the permission only when it is clicked, which is a gesture of the person", () => {
    const notice = browser("default");
    render(<Harness notice={notice} />);
    expect(notice.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(button("Ativar notificações"));
    expect(notice.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("turns the notices on when the permission is given, and becomes the button that turns them on and off", async () => {
    const onChange = vi.fn();
    render(<Harness notice={browser("default", "granted")} initial={false} onChange={onChange} />);
    fireEvent.click(button("Ativar notificações"));
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: "Ativar notificações" })).toBeNull();
    expect(button("Notificações").getAttribute("aria-pressed")).toBe("true");
  });

  it("becomes the blocked button, with its hint, when the person refuses", async () => {
    const onChange = vi.fn();
    render(<Harness notice={browser("default", "denied")} onChange={onChange} />);
    fireEvent.click(button("Ativar notificações"));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Notificações").disabled).toBe(true);
    expect(screen.getByText(BLOCKED)).toBeDefined();
  });

  it("stays as it is when the person closes the box of the browser without answering", async () => {
    const onChange = vi.fn();
    render(<Harness notice={browser("default", "default")} onChange={onChange} />);
    fireEvent.click(button("Ativar notificações"));
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(button("Ativar notificações").disabled).toBe(false);
  });
});

describe("NoticeToggle, when the permission is given", () => {
  it("is a button that tells with aria-pressed whether the notices are on", () => {
    render(<Harness notice={browser("granted")} initial />);
    expect(button("Notificações").getAttribute("aria-pressed")).toBe("true");
    expect(button("Notificações").disabled).toBe(false);
    cleanup();
    render(<Harness notice={browser("granted")} initial={false} />);
    expect(button("Notificações").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(BLOCKED)).toBeNull();
  });

  it("turns the notices off and on again with the clicks, and tells the parent each time", () => {
    const onChange = vi.fn();
    render(<Harness notice={browser("granted")} initial onChange={onChange} />);
    fireEvent.click(button("Notificações"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(button("Notificações").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Notificações"));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(button("Notificações").getAttribute("aria-pressed")).toBe("true");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does not ask for the permission again", () => {
    const notice = browser("granted");
    render(<Harness notice={notice} />);
    fireEvent.click(button("Notificações"));
    expect(notice.requestPermission).not.toHaveBeenCalled();
  });
});

describe("NoticeToggle, when the browser blocked the notices", () => {
  it("is a disabled button with the hint, as text on the screen", () => {
    const notice = browser("denied");
    render(<Harness notice={notice} />);
    const toggle = button("Notificações");
    expect(toggle.disabled).toBe(true);
    const hint = screen.getByText(BLOCKED);
    expect(toggle.getAttribute("aria-describedby")).toBe(hint.id);
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    fireEvent.click(toggle);
    expect(notice.requestPermission).not.toHaveBeenCalled();
  });

  it("gives each button its own hint, so two on a page do not point at the same text", () => {
    render(
      <>
        <Harness notice={browser("denied")} />
        <Harness notice={browser("unsupported")} />
      </>,
    );
    const [first, second] = screen.getAllByRole("button");
    expect(first!.getAttribute("aria-describedby")).not.toBe(second!.getAttribute("aria-describedby"));
  });
});
