import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIdentity, type IdentitySources } from "./useIdentity";

const sources = (overrides: Partial<IdentitySources> = {}): IdentitySources => ({
  me: vi.fn().mockResolvedValue({ name: "Ana Souza", email: "ana@example.com", role: "STUDENT" }),
  studentProfile: vi.fn().mockResolvedValue({ name: "Ana Maria Souza", academicId: "2345678", avatarUrl: "http://files/ana.png" }),
  ...overrides,
});

// Covers SPEC-016 CA-11: who is shown at the left of the header.
describe("useIdentity", () => {
  it("gives a student the name, the academic ID and the photo of the profile", async () => {
    const { result } = renderHook(() => useIdentity(sources()));
    await waitFor(() => expect(result.current?.academicId).toBe("2345678"));
    expect(result.current).toEqual({ name: "Ana Maria Souza", academicId: "2345678", avatarUrl: "http://files/ana.png" });
  });

  it("shows only the name of a teacher, who has no academic ID or photo, and never asks for a profile", async () => {
    const teacher = sources({ me: vi.fn().mockResolvedValue({ name: "Profa. Sediane", email: "s@utfpr.edu.br", role: "TEACHER" }) });
    const { result } = renderHook(() => useIdentity(teacher));
    await waitFor(() => expect(result.current).toEqual({ name: "Profa. Sediane" }));
    expect(teacher.studentProfile).not.toHaveBeenCalled();
  });

  it("falls back to the e-mail when the account has no name", async () => {
    const { result } = renderHook(() => useIdentity(sources({ me: vi.fn().mockResolvedValue({ email: "x@y.z", role: "ADMIN" }) })));
    await waitFor(() => expect(result.current).toEqual({ name: "x@y.z" }));
  });

  it("keeps the name of the session when the student profile cannot be read", async () => {
    const failing = sources({ studentProfile: vi.fn().mockRejectedValue(new Error("boom")) });
    const { result } = renderHook(() => useIdentity(failing));
    await waitFor(() => expect(failing.studentProfile).toHaveBeenCalled());
    expect(result.current).toEqual({ name: "Ana Souza" });
  });

  it("leaves a profile without academic ID or photo without them", async () => {
    const bare = sources({ studentProfile: vi.fn().mockResolvedValue({ name: "", academicId: "", avatarUrl: "" }) });
    const { result } = renderHook(() => useIdentity(bare));
    await waitFor(() => expect(bare.studentProfile).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toEqual({ name: "Ana Souza", academicId: undefined, avatarUrl: undefined }));
  });

  it("returns nobody for a visitor, without raising", async () => {
    const visitor = sources({ me: vi.fn().mockRejectedValue(new Error("401")) });
    const { result } = renderHook(() => useIdentity(visitor));
    await waitFor(() => expect(result.current).toBeNull());
  });

  // Covers SPEC-007 (navbar): undefined means "still reading", so no one sees a flash of the sign-in buttons.
  it("says it is still reading the session until it knows who is there", async () => {
    let answer: (user: { name: string; email: string; role: "TEACHER" }) => void = () => {};
    const slow = sources({ me: vi.fn().mockReturnValue(new Promise((resolve) => (answer = resolve))) });
    const { result } = renderHook(() => useIdentity(slow));
    expect(result.current).toBeUndefined();
    answer({ name: "Profa. Sediane", email: "s@utfpr.edu.br", role: "TEACHER" });
    await waitFor(() => expect(result.current).toEqual({ name: "Profa. Sediane" }));
  });
});
