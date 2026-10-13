import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClassGroup } from "@/services/classService";
import { InviteLinkCard } from "./InviteLinkCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const now = new Date(2026, 9, 13, 12, 0);
const base: ClassGroup = {
  id: "c-1",
  teacherId: "t-1",
  name: "SO",
  courseCode: "SO34E",
  semester: "2026/2",
  startDate: new Date(2026, 7, 1).toISOString(),
  endDate: new Date(2026, 11, 1).toISOString(),
  enableVirtualClassroom: false,
  enableInviteLink: true,
  inviteLinkToken: "tok123",
  inviteLinkStart: new Date(2026, 9, 1, 8, 0).toISOString(),
  inviteLinkEnd: new Date(2026, 9, 20, 18, 30).toISOString(),
  status: "ACTIVE",
  isExpiringSoon: false,
  createdAt: "",
  updatedAt: "",
};

describe("InviteLinkCard (SPEC-041 CA-09)", () => {
  it("shows the link and its expiry, copies it and announces it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<InviteLinkCard classGroup={base} now={now} />);

    const field = screen.getByLabelText("Link de convite") as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/invite/tok123`);
    expect(field.readOnly).toBe(true);
    expect(screen.getByText(/Expira em 20\/10\/2026 às 18:30/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/tok123`));
    const status = screen.getByRole("status");
    await waitFor(() => expect(status.textContent).toBe("Link copiado"));
  });

  it.each([
    ["disabled", { enableInviteLink: false }, /desabilitado/],
    ["not open yet", { inviteLinkStart: new Date(2026, 9, 14).toISOString() }, /ainda não está aberto/],
    ["expired", { inviteLinkEnd: new Date(2026, 9, 12).toISOString() }, /expirou/],
    ["class not active", { status: "DRAFT" as const }, /não está ativa/],
  ])("explains why the link is not available when %s", (_, change, reason) => {
    render(<InviteLinkCard classGroup={{ ...base, ...change }} now={now} />);
    expect(screen.queryByRole("button", { name: "Copiar link" })).toBeNull();
    expect(screen.getByText(reason)).toBeDefined();
    expect(screen.getByRole("link", { name: /Configurar link de convite/ }).getAttribute("href")).toBe("/app/classes/c-1/settings");
  });
});
