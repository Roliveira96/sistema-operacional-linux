import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockMaterialModules } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import MaterialsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("MaterialsPage (/materials)", () => {
  it("renders the header and all material cards from mock data", () => {
    render(<MaterialsPage />);

    expect(screen.getByRole("heading", { level: 1, name: messages.public.materials.title })).toBeTruthy();
    expect(screen.getByText(messages.public.materials.subtitle)).toBeTruthy();

    mockMaterialModules.forEach((mod) => {
      expect(screen.getByRole("heading", { level: 3, name: mod.title })).toBeTruthy();
      expect(screen.getByText(mod.description)).toBeTruthy();
      expect(screen.getAllByText(mod.level).length).toBeGreaterThanOrEqual(1);
    });

    const buttons = screen.getAllByRole("button", { name: messages.public.materials.explore });
    expect(buttons).toHaveLength(mockMaterialModules.length);
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<MaterialsPage />);
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.querySelector("footer")).toBeTruthy();
  });
});
