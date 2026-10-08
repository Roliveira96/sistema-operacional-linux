import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockSimulationModes } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import { SimulationCard } from "./SimulationCard";

afterEach(cleanup);

describe("SimulationCard", () => {
  const sampleSim = mockSimulationModes[0]!;

  it("renders title, duration, question count, and topics", () => {
    render(<SimulationCard simulation={sampleSim} />);

    expect(screen.getByRole("heading", { level: 3, name: sampleSim.title })).toBeTruthy();
    expect(screen.getByText(sampleSim.description)).toBeTruthy();
    expect(screen.getByText(sampleSim.difficulty)).toBeTruthy();
    expect(screen.getByText(new RegExp(`${sampleSim.durationMinutes}`)) ).toBeTruthy();
    expect(screen.getByText(new RegExp(`${sampleSim.questionCount}`)) ).toBeTruthy();

    sampleSim.topicsCovered.forEach((topic) => {
      expect(screen.getByText(topic)).toBeTruthy();
    });
  });

  it("calls onStart with slug when clicking action button", () => {
    const handleStart = vi.fn();
    render(<SimulationCard simulation={sampleSim} onStart={handleStart} />);

    fireEvent.click(screen.getByRole("button", { name: messages.public.simulations.start }));
    expect(handleStart).toHaveBeenCalledWith(sampleSim.slug);
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<SimulationCard simulation={sampleSim} />);
    expect(container.querySelector("article")).toBeTruthy();
  });
});
