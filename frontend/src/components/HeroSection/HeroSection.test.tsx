import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { HeroSection } from "./HeroSection";

afterEach(cleanup);

describe("HeroSection", () => {
  it("renders heading h1, badge, subtitle, actions and terminal simulation", () => {
    render(<HeroSection />);

    expect(screen.getByRole("heading", { level: 1, name: messages.public.hero.title })).toBeTruthy();
    expect(screen.getByText(messages.public.hero.badge)).toBeTruthy();
    expect(screen.getByText(messages.public.hero.subtitle)).toBeTruthy();
    expect(screen.getByText(messages.public.hero.terminalTitle)).toBeTruthy();
    expect(screen.getByText(messages.public.hero.ctaPrimary)).toBeTruthy();
    expect(screen.getByText(messages.public.hero.ctaSecondary)).toBeTruthy();
  });

  it("handles custom click handlers for primary and secondary actions", () => {
    const handlePrimary = vi.fn();
    const handleSecondary = vi.fn();

    render(<HeroSection onPrimaryClick={handlePrimary} onSecondaryClick={handleSecondary} />);

    fireEvent.click(screen.getByRole("button", { name: messages.public.hero.ctaPrimary }));
    expect(handlePrimary).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: messages.public.hero.ctaSecondary }));
    expect(handleSecondary).toHaveBeenCalledOnce();
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<HeroSection />);
    expect(container.querySelector("section")).toBeTruthy();
    expect(container.querySelector("h1")).toBeTruthy();
  });
});
