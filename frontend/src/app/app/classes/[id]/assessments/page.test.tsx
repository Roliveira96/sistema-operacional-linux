import { afterEach, describe, expect, it, vi } from "vitest";
import AssessmentsPage from "./page";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

afterEach(() => redirect.mockClear());

// SPEC-082 CA-05, D-02: the old address of the list leads to the tab of the page of the class.
describe("assessments page of the class (old address)", () => {
  it("goes to the tab of the assessments of the class", async () => {
    await AssessmentsPage({ params: Promise.resolve({ id: "c-1" }) });
    expect(redirect).toHaveBeenCalledWith("/app/classes/c-1?tab=assessments");
  });
});
