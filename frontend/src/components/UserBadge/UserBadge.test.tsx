import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/test/domMatchers";
import { initialsOf, UserBadge } from "./UserBadge";

afterEach(cleanup);

// Covers SPEC-016 CA-11.
describe("UserBadge", () => {
  it("shows the photo, the name and the academic ID of a student", () => {
    render(<UserBadge identity={{ name: "Ana Souza", academicId: "2345678", avatarUrl: "http://files/ana.png" }} />);
    expect(screen.getByRole("img", { name: "Foto de Ana Souza" })).toHaveAttribute("src", "http://files/ana.png");
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("RA 2345678")).toBeInTheDocument();
  });

  it("shows the initials when there is no photo, and no academic ID line for a teacher", () => {
    render(<UserBadge identity={{ name: "Sediane Carmem Lunardi" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("SL")).toBeInTheDocument();
    expect(screen.queryByText(/^RA /)).toBeNull();
  });
});

describe("initialsOf", () => {
  it.each([
    ["Ana Souza", "AS"],
    ["ana maria de souza", "AS"],
    ["Ricardo", "R"],
    ["  ", "?"],
    ["", "?"],
  ])("takes the initials of %j as %j", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
