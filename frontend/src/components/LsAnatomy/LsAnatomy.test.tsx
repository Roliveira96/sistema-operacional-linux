import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { contentMessages } from "@/messages/content.pt-BR";
import { LsAnatomy } from "./LsAnatomy";

afterEach(cleanup);

// Covers SPEC-012 CA-08 for the ls -l anatomy.
describe("LsAnatomy", () => {
  it("shows the annotated line and one legend item per part", () => {
    const { container } = render(<LsAnatomy />);
    expect(container.querySelector("pre")?.textContent).toBe("-rwxr-xr-- 1 maria dev 1024 set 25 10:00 script.sh ");
    expect(screen.getAllByRole("listitem")).toHaveLength(contentMessages.anatomy.parts.length);
  });
});
