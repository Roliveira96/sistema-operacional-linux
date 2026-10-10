import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { messages } from "@/messages/pt-BR";
import { BrandMark } from "./BrandMark";

afterEach(cleanup);

describe("BrandMark", () => {
  it("links to the given page with the real logo and the name of the platform", () => {
    render(<BrandMark href="/app" />);
    const link = screen.getByRole("link", { name: `${messages.public.nav.brand} - ${messages.public.nav.institution}` });
    expect(link.getAttribute("href")).toBe("/app");
    expect(screen.getByRole("img", { name: messages.public.nav.logoAlt }).getAttribute("src")).toContain("utfpr-logo.svg");
    expect(screen.getByText(messages.public.nav.brand)).toBeTruthy();
  });
});
