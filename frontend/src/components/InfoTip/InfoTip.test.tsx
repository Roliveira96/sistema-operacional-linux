import "@/test/domMatchers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoTip } from "./InfoTip";

afterEach(cleanup);

describe("InfoTip", () => {
  it("opens the explanation on click and closes it on a second click, on Escape and outside", () => {
    render(
      <div>
        <InfoTip topic="Snapshot">Prepara a máquina.</InfoTip>
        <p>fora</p>
      </div>,
    );
    const button = screen.getByRole("button", { name: "Para que serve: Snapshot" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button);
    expect(screen.getByRole("note")).toHaveTextContent("Prepara a máquina.");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText("fora"));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
