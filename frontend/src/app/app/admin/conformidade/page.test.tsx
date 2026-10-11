import "@/test/domMatchers";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConformancePage from "./page";

const replace = vi.fn();
let role = "ADMIN";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { role } }) }));
const EngineConformance = vi.hoisted(() => vi.fn(() => <p>verificação em curso</p>));
vi.mock("@/components/EngineConformance/EngineConformance", () => ({ EngineConformance }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConformancePage (/app/admin/conformidade)", () => {
  // Covers SPEC-030 CA-03: the administrator gets the verification.
  it("opens the verification for the administrator", () => {
    role = "ADMIN";
    render(<ConformancePage />);
    expect(screen.getByText("verificação em curso")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  // Covers SPEC-030 CA-02, RN-09: anyone else goes back to the start and nothing runs.
  it.each(["TEACHER", "STUDENT"])("sends %s back to the start without running anything", (other) => {
    role = other;
    render(<ConformancePage />);
    expect(replace).toHaveBeenCalledWith("/app");
    expect(EngineConformance).not.toHaveBeenCalled();
  });
});
