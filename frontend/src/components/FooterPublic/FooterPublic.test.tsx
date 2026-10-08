import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messages } from "@/messages/pt-BR";
import { FooterPublic } from "./FooterPublic";

afterEach(cleanup);

describe("FooterPublic", () => {
  it("renders campus, course, advisorship, author and copyright", () => {
    render(<FooterPublic />);

    expect(screen.getByText(messages.public.footer.campus)).toBeTruthy();
    expect(screen.getByText(messages.public.footer.course)).toBeTruthy();
    expect(screen.getByText(messages.public.footer.advisorship)).toBeTruthy();
    expect(screen.getByText(messages.public.footer.author)).toBeTruthy();
    expect(screen.getByText(messages.public.footer.tccNotice)).toBeTruthy();
  });

  it.each(["light", "dark"])("renders consistently under %s theme", (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<FooterPublic />);
    expect(container.querySelector("footer")).toBeTruthy();
  });
});
