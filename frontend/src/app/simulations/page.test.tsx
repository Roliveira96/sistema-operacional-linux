import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import { contentService, type AssessmentTemplateSummary } from "@/services/contentService";
import SimulationsPage from "./page";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const templates: AssessmentTemplateSummary[] = [
  { id: "t1", title: "Linux Básico", description: "Fundamentos — comandos essenciais", durationMinutes: 30, questionCount: 30 },
  { id: "t2", title: "Quiz Certificação", description: "Teórico", durationMinutes: 30, questionCount: 30 },
];

beforeEach(() => push.mockClear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Covers SPEC-012 CA-07.
describe("SimulationsPage (/simulations)", () => {
  it("lists the active assessment templates from the API", async () => {
    vi.spyOn(contentService, "templates").mockResolvedValue(templates);
    render(<SimulationsPage />);

    expect(screen.getByRole("heading", { level: 1, name: messages.public.simulations.title })).toBeTruthy();
    for (const t of templates) {
      expect(await screen.findByRole("heading", { level: 3, name: t.title })).toBeTruthy();
      expect(screen.getByText(t.description)).toBeTruthy();
    }
    const buttons = screen.getAllByRole("button", { name: messages.public.simulations.start });
    expect(buttons).toHaveLength(templates.length);
    fireEvent.click(buttons[0]!);
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("shows loading, empty and error states", async () => {
    vi.spyOn(contentService, "templates").mockResolvedValueOnce([]);
    const { unmount } = render(<SimulationsPage />);
    expect(screen.getByRole("status").textContent).toBe(contentMessages.loading);
    expect(await screen.findByText(contentMessages.simulations.empty)).toBeTruthy();
    unmount();

    vi.spyOn(contentService, "templates").mockRejectedValueOnce(new Error("offline"));
    render(<SimulationsPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(contentMessages.unexpected);
  });

  it.each(["light", "dark"])("renders consistently under %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    vi.spyOn(contentService, "templates").mockResolvedValue(templates);
    const { container } = render(<SimulationsPage />);
    await screen.findByRole("heading", { level: 3, name: templates[0]!.title });
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.querySelector("footer")).toBeTruthy();
  });
});
