import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockPlatformMetrics, mockPlatformPillars } from "@/data/mockContent";
import { messages } from "@/messages/pt-BR";
import LandingPage from "./page";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

afterEach(() => {
  cleanup();
  mockPush.mockClear();
});

describe("LandingPage (/) ", () => {
  it("renders Navbar, Hero, Features, Metrics and Footer", () => {
    render(<LandingPage />);

    // Brand and Navbar
    expect(screen.getAllByText(messages.public.nav.brand).length).toBeGreaterThanOrEqual(1);

    // Hero section
    expect(screen.getByRole("heading", { level: 1, name: messages.public.hero.title })).toBeTruthy();
    expect(screen.getByText(messages.public.hero.subtitle)).toBeTruthy();

    // Section headings (h2)
    expect(screen.getByRole("heading", { level: 2, name: messages.public.features.title })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: messages.public.metrics.title })).toBeTruthy();

    // Feature cards (h3)
    mockPlatformPillars.forEach((pillar) => {
      expect(screen.getByRole("heading", { level: 3, name: pillar.title })).toBeTruthy();
      expect(screen.getByText(pillar.description)).toBeTruthy();
    });

    // Metric cards
    mockPlatformMetrics.forEach((metric) => {
      expect(screen.getByText(metric.value)).toBeTruthy();
      expect(screen.getByText(metric.label)).toBeTruthy();
    });

    // Footer
    expect(screen.getByText(messages.public.footer.campus)).toBeTruthy();
  });

  it("navigates to /materials when clicking primary CTA", () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole("button", { name: messages.public.hero.ctaPrimary }));
    expect(mockPush).toHaveBeenCalledWith("/materials");
  });

  it("navigates to /simulations when clicking secondary CTA", () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole("button", { name: messages.public.hero.ctaSecondary }));
    expect(mockPush).toHaveBeenCalledWith("/simulations");
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<LandingPage />);
    expect(container.querySelector("header")).toBeTruthy();
    expect(container.querySelector("main")).toBeTruthy();
    expect(container.querySelector("footer")).toBeTruthy();
  });
});
