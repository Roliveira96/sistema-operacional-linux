import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitingRoom } from "./WaitingRoom";

afterEach(cleanup);

// SPEC-054 CA-01 and CA-03
describe("WaitingRoom", () => {
  it("tells the student to wait for the teacher, and for how long", () => {
    const { rerender } = render(<WaitingRoom state="WAITING" waitedMinutes={3} onAskAgain={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Aguardando o professor aceitar a sua entrada");
    expect(screen.getByText("Esperando há 3 min")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<WaitingRoom state="WAITING" waitedMinutes={0} onAskAgain={vi.fn()} />);
    expect(screen.getByText("Esperando há menos de 1 min")).toBeDefined();
  });

  it("tells the student the teacher removed him, and lets him ask again", () => {
    const onAskAgain = vi.fn();
    render(<WaitingRoom state="REMOVED" onAskAgain={onAskAgain} />);
    expect(screen.getByText("O professor retirou você da aula")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Pedir para entrar de novo" }));
    expect(onAskAgain).toHaveBeenCalledTimes(1);
  });
});
