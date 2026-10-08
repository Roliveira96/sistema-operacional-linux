import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSimulationModes } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import SimulationsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("SimulationsPage (/simulations)", () => {
  it("renders the header and all simulation cards from mock data", () => {
    render(<SimulationsPage />);

    expect(screen.getByRole("heading", { level: 1, name: messages.public.simulations.title })).toBeTruthy();
    expect(screen.getByText(messages.public.simulations.subtitle)).toBeTruthy();

    mockSimulationModes.forEach((sim) => {
      expect(screen.getByRole("heading", { level: 3, name: sim.title })).toBeTruthy();
      expect(screen.getByText(sim.description)).toBeTruthy();
      expect(screen.getAllByText(sim.difficulty).length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByRole("button", { name: messages.public.simulations.start });
    expect(buttons).toHaveLength(mockSimulationModes.length);
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<SimulationsPage />);
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.querySelector("footer")).toBeTruthy();
  });
});
