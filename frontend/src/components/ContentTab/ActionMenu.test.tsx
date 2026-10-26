import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionMenu, type MenuAction } from "./ActionMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(actions: MenuAction[], wide?: boolean) {
  render(
    <>
      <p id="why">Cancelada: só leitura</p>
      <ActionMenu label="Mais ações de Prova 1" text={wide ? "Mais ações" : "⋯"} actions={actions} wide={wide} />
    </>,
  );
  return screen.getByRole("button", { name: "Mais ações de Prova 1" });
}

// SPEC-080 CA-05 (section 6): an action the phase does not allow stays in the menu, off, with its reason; the menu keeps doing what it did.
describe("ActionMenu", () => {
  it("runs the action that is chosen and closes", () => {
    const onSelect = vi.fn();
    const button = setup([{ key: "a", label: "Reagendar", onSelect }]);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Reagendar" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps an off action in the menu, readable and reachable, tied to its reason, and does not run it", () => {
    const onSelect = vi.fn();
    const button = setup([
      { key: "p", label: "Pré-visualizar", onSelect: vi.fn() },
      { key: "r", label: "Reagendar", onSelect, disabled: true, describedBy: "why" },
    ]);
    fireEvent.click(button);
    const off = screen.getByRole("menuitem", { name: "Reagendar" });
    expect(off.getAttribute("aria-disabled")).toBe("true");
    expect(off.getAttribute("aria-describedby")).toBe("why");

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(off); // it takes the focus, so a screen reader can say why it is off

    fireEvent.click(off);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeDefined(); // and the menu stays open
  });

  it("does not mark an action that is on", () => {
    const button = setup([{ key: "p", label: "Pré-visualizar", onSelect: vi.fn() }]);
    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: "Pré-visualizar" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("can show its text on the button, not only the three dots", () => {
    const button = setup([{ key: "p", label: "Pré-visualizar", onSelect: vi.fn() }], true);
    expect(button.textContent).toBe("Mais ações");
  });
});

// A menu inside a box that scrolls sideways (the list of assessments) was cut by that box. A floating menu is placed on the window, under its
// button, so no box can cut it; it turns upward when it does not fit below, and leaves when the page moves.
describe("ActionMenu floating", () => {
  const rect = (over: Partial<DOMRect>) => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...over }) as DOMRect;

  /** The button is at the given place, the menu is as tall as asked and the window is 1024 by 768. */
  function layout(trigger: Partial<DOMRect>, menuHeight: number, menuWidth = 0, windowWidth = 1024) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return this.getAttribute("aria-haspopup") === "menu" ? rect(trigger) : rect({});
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(menuHeight);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(menuWidth);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: windowWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  }

  const open = (floating: boolean) => {
    render(<ActionMenu label="Mais ações de Prova 1" text="Mais ações" wide floating={floating} actions={[{ key: "a", label: "Reagendar", onSelect: vi.fn() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Mais ações de Prova 1" }));
    return screen.getByRole("menu");
  };

  it("is placed on the window, under the button and on its right edge", () => {
    layout({ top: 56, bottom: 100, left: 800, right: 900 }, 150);
    const menu = open(true);
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.top).toBe("104px");
    expect(menu.style.bottom).toBe("auto");
    expect(menu.style.right).toBe("124px");
  });

  it("opens above the button when it does not fit below and there is more room above", () => {
    layout({ top: 700, bottom: 744, left: 800, right: 900 }, 150);
    const menu = open(true);
    expect(menu.style.position).toBe("fixed");
    expect(menu.style.top).toBe("auto");
    expect(menu.style.bottom).toBe("72px");
  });

  // A card on a narrow window puts the button at the left, so a menu on the right edge of the button would leave through the left of the window.
  it("starts at the left edge of the button when it would leave the window on the left", () => {
    layout({ top: 56, bottom: 100, left: 30, right: 138 }, 150, 240, 400);
    const menu = open(true);
    expect(menu.style.left).toBe("30px");
    expect(menu.style.right).toBe("auto");
  });

  it("is kept inside the window when it would also leave on the right", () => {
    layout({ top: 56, bottom: 100, left: 100, right: 130 }, 150, 240, 300);
    const menu = open(true);
    expect(menu.style.left).toBe("52px");
    expect(menu.style.right).toBe("auto");
  });

  it("closes when the window is resized or the page scrolls, and not when the menu itself scrolls", () => {
    layout({ top: 56, bottom: 100, left: 800, right: 900 }, 150);
    const menu = open(true);
    fireEvent.scroll(menu);
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mais ações de Prova 1" }));
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is placed by the style sheet, as before, when it is not floating", () => {
    layout({ top: 56, bottom: 100, left: 800, right: 900 }, 150);
    const menu = open(false);
    expect(menu.style.position).toBe("");
    expect(menu.style.top).toBe("");
  });
});
