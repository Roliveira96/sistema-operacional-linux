import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Page from "./page";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("old /students route (SPEC-041 CA-18, D-07)", () => {
  it("redirects to the students tab of the class page", async () => {
    await Page({ params: Promise.resolve({ id: "c-1" }) });
    expect(redirect).toHaveBeenCalledWith("/app/classes/c-1?tab=students");
  });
});
