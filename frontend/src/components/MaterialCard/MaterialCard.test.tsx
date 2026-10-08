import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockMaterialModules } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import { MaterialCard } from "./MaterialCard";

afterEach(cleanup);

describe("MaterialCard", () => {
  const sampleModule = mockMaterialModules[0]!;

  it("renders module title, description, level and command highlights", () => {
    render(<MaterialCard module={sampleModule} />);

    expect(screen.getByRole("heading", { level: 3, name: sampleModule.title })).toBeTruthy();
    expect(screen.getByText(sampleModule.description)).toBeTruthy();
    expect(screen.getByText(sampleModule.level)).toBeTruthy();
    expect(screen.getByText(messages.public.materials.lessonsLabel(sampleModule.lessonCount))).toBeTruthy();

    sampleModule.commandHighlights.forEach((cmd) => {
      expect(screen.getByText(cmd)).toBeTruthy();
    });
  });

  it("calls onExplore when clicking action button", () => {
    const handleExplore = vi.fn();
    render(<MaterialCard module={sampleModule} onExplore={handleExplore} />);

    fireEvent.click(screen.getByRole("button", { name: messages.public.materials.explore }));
    expect(handleExplore).toHaveBeenCalledWith(sampleModule.slug);
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<MaterialCard module={sampleModule} />);
    expect(container.querySelector("article")).toBeTruthy();
  });
});
