import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import type { CurrentUser, Role } from "@/services/authService";
import { classroomService } from "@/services/classroomService";
import { getStudentProfile } from "@/services/studentService";
import { AppShell } from "./AppShell";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/services/studentService", () => ({
  getStudentProfile: vi.fn(),
}));

vi.mock("@/services/classroomService", () => ({
  classroomService: { listMyLive: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/services/classService", () => ({
  classService: { myClasses: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

let mockPathname = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockPathname = "/app";
});

const logout = vi.fn();

function signIn(role: Role, overrides: Partial<CurrentUser> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      userId: "1",
      email: `${role.toLowerCase()}@utfpr.edu.br`,
      role,
      status: "ACTIVE",
      name: role === "STUDENT" ? "Aluno" : "Professora",
      mustChangePassword: false,
      sessionCreatedAt: "2026-10-08T00:00:00Z",
      sessionExpiresAt: "2026-10-08T05:00:00Z",
      ...overrides,
    },
    logout,
    refresh: vi.fn(),
  });
}

const renderShell = () =>
  render(
    <AppShell>
      <div>Conteúdo</div>
    </AppShell>,
  );

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders teacher navigation links including students", () => {
    signIn("TEACHER");
    renderShell();

    expect(screen.getByText(messages.classes.title)).toBeDefined();
    expect(screen.getByText(messages.students.title)).toBeDefined();
    expect(screen.getByText(messages.modules.title)).toBeDefined();
    expect(screen.getByText("Conteúdo")).toBeDefined();
  });

  it("marks current route link with aria-current='page'", () => {
    mockPathname = "/app/classes";
    signIn("TEACHER");
    renderShell();

    const classesLink = screen.getByRole("link", { name: messages.classes.title });
    const studentsLink = screen.getByRole("link", { name: messages.students.title });

    expect(classesLink.getAttribute("aria-current")).toBe("page");
    expect(studentsLink.getAttribute("aria-current")).toBeNull();
  });

  it("marks nested child routes as active for the parent section", () => {
    mockPathname = "/app/classes/cl-123";
    signIn("TEACHER");
    renderShell();

    const classesLink = screen.getByRole("link", { name: messages.classes.title });
    expect(classesLink.getAttribute("aria-current")).toBe("page");
  });

  it("does not render teacher-specific links for students", async () => {
    signIn("STUDENT");
    vi.mocked(getStudentProfile).mockResolvedValue({ id: "1", name: "Aluno", academicId: "1234567", email: "a@b.c", createdAt: "" });
    renderShell();

    expect(screen.queryByText(messages.classes.title)).toBeNull();
    expect(screen.queryByText(messages.students.title)).toBeNull();
    expect(screen.queryByText(messages.modules.title)).toBeNull();
    expect(screen.getByText("Conteúdo")).toBeDefined();
    // SPEC-026 CA-01: the bar shows only the name; the RA is no longer in it.
    expect(await screen.findByRole("button", { name: "Aluno" })).toBeDefined();
    expect(screen.queryByText(/^RA /)).toBeNull();
  });

  // Covers SPEC-030 CA-01: the engine conformance button is the administrator's alone.
  it.each([["ADMIN", true], ["TEACHER", false], ["STUDENT", false]] as const)("%s sees the engine conformance link: %s", (role, visible) => {
    signIn(role);
    vi.mocked(getStudentProfile).mockResolvedValue({ id: "1", name: "Aluno", academicId: "1234567", email: "a@b.c", createdAt: "" });
    renderShell();
    const link = screen.queryByRole("link", { name: messages.conformance.nav });
    expect(link !== null).toBe(visible);
    if (link) expect(link.getAttribute("href")).toBe("/app/admin/conformidade");
  });

  // Covers SPEC-015: the bar follows the pattern of the study screen.
  it("shows the logo of the university and the platform at the left", () => {
    signIn("ADMIN");
    renderShell();

    const brand = screen.getByRole("link", { name: `${messages.public.nav.brand} - ${messages.public.nav.institution}` });
    expect(brand.getAttribute("href")).toBe("/app");
    expect(screen.getByRole("img", { name: messages.public.nav.logoAlt }).getAttribute("src")).toContain("utfpr-logo.svg");
  });

  it("shows only the name of an administrator in the bar and the role inside the account menu", () => {
    signIn("ADMIN", { name: "Administrador Geral" });
    renderShell();

    expect(screen.getByText("Administrador Geral")).toBeDefined();
    expect(screen.queryByText(messages.home.role.ADMIN!)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Administrador Geral" }));
    expect(screen.getByText(messages.home.role.ADMIN!)).toBeDefined();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(getStudentProfile).not.toHaveBeenCalled();
  });

  it("falls back to the e-mail when the account has no name", () => {
    signIn("TEACHER", { name: undefined, email: "prof@utfpr.edu.br" });
    renderShell();
    expect(screen.getByRole("button", { name: "prof@utfpr.edu.br" })).toBeDefined();
  });

  it("shows the photo and the academic ID of a student, keeping the name if the profile fails", async () => {
    signIn("STUDENT");
    vi.mocked(getStudentProfile).mockRejectedValue(new Error("boom"));
    renderShell();

    await waitFor(() => expect(getStudentProfile).toHaveBeenCalled());
    expect(screen.getByText("Aluno")).toBeDefined();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(screen.queryByText(messages.home.role.STUDENT!)).toBeNull();
  });

  it("replaces the old account block by the account menu, with the way out inside it (SPEC-026)", () => {
    signIn("TEACHER");
    renderShell();

    expect(screen.queryByRole("button", { name: messages.auth.logout })).toBeNull();
    expect(screen.getByRole("button", { name: "Professora" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the security link and ends the session on Sair", () => {
    signIn("TEACHER");
    renderShell();

    expect(screen.getByRole("link", { name: messages.home.security }).getAttribute("href")).toBe("/app/profile/security");
    fireEvent.click(screen.getByRole("button", { name: "Professora" }));
    fireEvent.click(screen.getByRole("button", { name: messages.auth.logout }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  // SPEC-042, section 3.1.4: everyone has the calendar; administrators also the holidays.
  it.each([["ADMIN", true], ["TEACHER", false], ["STUDENT", false]] as const)("%s sees Calendário, and Feriados: %s", (role, holidays) => {
    signIn(role);
    vi.mocked(getStudentProfile).mockResolvedValue({ id: "1", name: "Aluno", academicId: "1234567", email: "a@b.c", createdAt: "" });
    renderShell();
    expect(screen.getByRole("link", { name: "Calendário" }).getAttribute("href")).toBe("/app/calendar");
    expect(screen.queryByRole("link", { name: "Feriados" }) !== null).toBe(holidays);
  });

  // SPEC-043: Mobile navigation menu
  describe("Mobile navigation (SPEC-043)", () => {
    it("has a mobile menu toggle button with accessibility attributes", () => {
      signIn("TEACHER");
      renderShell();
      const toggleBtn = screen.getByRole("button", { name: messages.shell.openMenu });
      expect(toggleBtn).toBeDefined();
      expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
      expect(toggleBtn.getAttribute("aria-controls")).toBe("app-mobile-nav");
    });

    it("opens the mobile drawer with links matching the teacher role and closes with Escape", () => {
      signIn("TEACHER");
      renderShell();
      const toggleBtn = screen.getByRole("button", { name: messages.shell.openMenu });
      fireEvent.click(toggleBtn);
      expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("button", { name: messages.shell.closeMenu })).toBeDefined();

      const mobileNav = screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel });
      expect(within(mobileNav).getByRole("link", { name: messages.classes.title })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.students.title })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.modules.title })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.schedule.page.nav })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.home.security })).toBeDefined();
      expect(within(mobileNav).queryByRole("link", { name: messages.conformance.nav })).toBeNull();
      expect(within(mobileNav).queryByRole("link", { name: messages.schedule.holidays.nav })).toBeNull();

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("navigation", { name: messages.shell.mobileNavAriaLabel })).toBeNull();
      expect(screen.getByRole("button", { name: messages.shell.openMenu }).getAttribute("aria-expanded")).toBe("false");
    });

    it("shows admin-specific links in the mobile menu for administrators", () => {
      signIn("ADMIN");
      renderShell();
      fireEvent.click(screen.getByRole("button", { name: messages.shell.openMenu }));
      const mobileNav = screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel });
      expect(within(mobileNav).getByRole("link", { name: messages.conformance.nav })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.schedule.holidays.nav })).toBeDefined();
    });

    it("shows only calendar and security for students in the mobile menu", async () => {
      signIn("STUDENT");
      vi.mocked(getStudentProfile).mockResolvedValue({ id: "1", name: "Aluno", academicId: "1234567", email: "a@b.c", createdAt: "" });
      renderShell();
      fireEvent.click(screen.getByRole("button", { name: messages.shell.openMenu }));
      const mobileNav = screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel });
      expect(within(mobileNav).queryByRole("link", { name: messages.classes.title })).toBeNull();
      expect(within(mobileNav).queryByRole("link", { name: messages.students.title })).toBeNull();
      expect(within(mobileNav).getByRole("link", { name: messages.schedule.page.nav })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: messages.home.security })).toBeDefined();
    });

    it("closes the mobile menu when a mobile nav link is clicked", () => {
      signIn("TEACHER");
      renderShell();
      fireEvent.click(screen.getByRole("button", { name: messages.shell.openMenu }));
      const mobileNav = screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel });
      const classesLink = within(mobileNav).getByRole("link", { name: messages.classes.title });
      fireEvent.click(classesLink);
      expect(screen.queryByRole("navigation", { name: messages.shell.mobileNavAriaLabel })).toBeNull();
    });

    it("closes the mobile menu when clicking the backdrop", () => {
      signIn("TEACHER");
      renderShell();
      fireEvent.click(screen.getByRole("button", { name: messages.shell.openMenu }));
      expect(screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel })).toBeDefined();
      const backdrop = screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel }).parentElement!;
      fireEvent.click(backdrop);
      expect(screen.queryByRole("navigation", { name: messages.shell.mobileNavAriaLabel })).toBeNull();
    });

    it("navigates via calendar link in mobile nav and closes drawer", () => {
      signIn("STUDENT");
      renderShell();
      fireEvent.click(screen.getByRole("button", { name: messages.shell.openMenu }));
      const mobileNav = screen.getByRole("navigation", { name: messages.shell.mobileNavAriaLabel });
      fireEvent.click(within(mobileNav).getByRole("link", { name: messages.schedule.page.nav }));
      expect(screen.queryByRole("navigation", { name: messages.shell.mobileNavAriaLabel })).toBeNull();
    });
  });
});

// SPEC-067: the notice of the live class, for the student, on every screen of the signed-in area
describe("AppShell, live class notice", () => {
  const live = [{ classId: "c-1", className: "Turma A", sessionId: "s-1", title: "Processos", startedAt: "2026-10-15T19:00:00Z" }];

  beforeEach(() => {
    vi.mocked(classroomService.listMyLive).mockResolvedValue(live);
  });

  const enterLink = () => screen.findByRole("link", { name: messages.liveNow.enter });

  // CA-06
  it("shows the notice to the student on the home page and on any other screen", async () => {
    signIn("STUDENT");
    renderShell();
    expect((await enterLink()).getAttribute("href")).toBe("/app/classes/c-1/live");

    cleanup();
    mockPathname = "/app/calendar";
    renderShell();
    expect(await enterLink()).toBeDefined();

    cleanup();
    mockPathname = "/app/classes/c-1";
    renderShell();
    expect(await enterLink()).toBeDefined();
  });

  // CA-09
  it("does not show it inside the live room, where the student already is", async () => {
    mockPathname = "/app/classes/c-1";
    signIn("STUDENT");
    const view = renderShell();
    expect(await enterLink()).toBeDefined();

    mockPathname = "/app/classes/c-1/live";
    view.rerender(
      <AppShell>
        <div>Conteúdo</div>
      </AppShell>,
    );
    expect(screen.queryByRole("link", { name: messages.liveNow.enter })).toBeNull();
  });

  // CA-10
  it.each(["TEACHER", "ADMIN"] as const)("does not show it to the %s, and does not even ask", async (role) => {
    signIn(role);
    renderShell();
    await screen.findByText("Conteúdo");

    expect(screen.queryByRole("link", { name: messages.liveNow.enter })).toBeNull();
    expect(classroomService.listMyLive).not.toHaveBeenCalled();
  });
});

