import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/domMatchers";
import { messages } from "@/messages/pt-BR";
import { classService, type MyClass, type MyClassesResult } from "@/services/classService";
import { AccountMenu, type AccountMenuProps } from "./AccountMenu";

let pathname: string | null = "/app";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const m = messages.account;
const teacher = { name: "Profa. Sediane Lunardi", email: "sediane@utfpr.edu.br", role: "TEACHER" as const };
const student = { name: "Ana Souza", email: "ana@example.com", role: "STUDENT" as const };

const cls = (n: number, extra: Partial<MyClass> = {}): MyClass => ({
  id: `id-${n}`,
  name: `Turma ${n}`,
  courseCode: `SO${n}`,
  semester: "2026/2",
  relation: "TEACHER",
  ...extra,
});
const list = (n: number, total = n, extra: Partial<MyClass> = {}): MyClassesResult => ({
  items: Array.from({ length: n }, (_, i) => cls(i + 1, extra)),
  total,
});

function setup(props: Partial<AccountMenuProps> = {}) {
  const loadClasses = vi.fn().mockResolvedValue(list(2));
  const logout = vi.fn();
  const view = render(<AccountMenu user={teacher} loadClasses={loadClasses} logout={logout} {...props} />);
  const trigger = () => screen.getByRole("button", { name: (props.user ?? teacher).name });
  const panel = () => screen.queryByRole("region", { name: m.region });
  return { ...view, loadClasses, logout, trigger, panel };
}

beforeEach(() => {
  pathname = "/app";
});
afterEach(cleanup);

describe("AccountMenu", () => {
  // CA-01
  it("CA-01 closed state shows only the initials and the name, nothing else", () => {
    const { trigger, panel } = setup();
    expect(trigger().textContent).toContain("PL");
    expect(screen.getByText(teacher.name)).toBeInTheDocument();
    expect(screen.queryByText(teacher.email)).toBeNull();
    expect(screen.queryByText(messages.auth.logout)).toBeNull();
    expect(screen.queryByText(m.myProfile)).toBeNull();
    expect(panel()).toBeNull();
  });

  it("CA-01 shows the photo with the name as alt text when there is one", () => {
    setup({ user: { ...student, avatarUrl: "http://files/ana.png" } });
    expect(screen.getByRole("img", { name: "Foto de Ana Souza" })).toHaveAttribute("src", "http://files/ana.png");
  });

  // CA-02 and CA-03
  it("CA-02 opens the panel with email, classes, profile and logout, and CA-03 closes on a second click", async () => {
    const { trigger, panel } = setup();
    fireEvent.click(trigger());
    expect(panel()).toBeInTheDocument();
    expect(within(panel()!).getByText(teacher.email)).toBeInTheDocument();
    expect(within(panel()!).getByRole("heading", { name: m.myClasses })).toBeInTheDocument();
    expect(within(panel()!).getByRole("link", { name: m.myProfile })).toBeInTheDocument();
    expect(within(panel()!).getByRole("button", { name: messages.auth.logout })).toBeInTheDocument();
    await screen.findByText("Turma 1");
    fireEvent.click(trigger());
    expect(panel()).toBeNull();
  });

  it("CA-03 closes on Esc and gives the focus back to the button", () => {
    const { trigger, panel } = setup();
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(panel());
    fireEvent.keyDown(document, { key: "Enter" });
    expect(panel()).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("CA-03 closes on a click outside but not on a click inside", () => {
    const { trigger, panel } = setup();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByText(teacher.email));
    expect(panel()).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(panel()).toBeNull();
  });

  it("CA-03 closes when an item is chosen", async () => {
    const { trigger, panel } = setup();
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("link", { name: /Turma 1/ }));
    expect(panel()).toBeNull();
  });

  it("CA-03 closes when the route changes", () => {
    const { trigger, panel, rerender, loadClasses, logout } = setup();
    fireEvent.click(trigger());
    pathname = "/app/classes";
    rerender(<AccountMenu user={teacher} loadClasses={loadClasses} logout={logout} />);
    expect(panel()).toBeNull();
  });

  it("CA-10 Tab past the last item closes the panel without trapping the focus", () => {
    const { trigger, panel } = setup();
    fireEvent.click(trigger());
    const out = screen.getByRole("button", { name: messages.auth.logout });
    fireEvent.focusOut(out, { relatedTarget: trigger() });
    expect(panel()).toBeInTheDocument();
    fireEvent.focusOut(out, { relatedTarget: document.body });
    expect(panel()).toBeNull();
  });

  // CA-04 and CA-05
  it("CA-04 the profile button leads to /app/profile and closes the panel", () => {
    const { trigger, panel } = setup();
    fireEvent.click(trigger());
    const link = screen.getByRole("link", { name: m.myProfile });
    expect(link).toHaveAttribute("href", "/app/profile");
    fireEvent.click(link);
    expect(panel()).toBeNull();
  });

  it("CA-05 Sair ends the session and closes the panel", () => {
    const { trigger, panel, logout } = setup();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: messages.auth.logout }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  // CA-06
  it("CA-06 shows the skeleton while loading, the classes after, and loads only once", async () => {
    let answer: (r: MyClassesResult) => void = () => {};
    const loadClasses = vi.fn().mockReturnValue(new Promise<MyClassesResult>((r) => (answer = r)));
    const { trigger } = setup({ loadClasses });
    fireEvent.click(trigger());
    expect(screen.getByTestId("classes-skeleton")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("link", { name: m.myProfile })).toBeInTheDocument();
    await act(async () => answer(list(1)));
    expect(screen.queryByTestId("classes-skeleton")).toBeNull();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.getByText("Turma 1")).toBeInTheDocument();
    expect(loadClasses).toHaveBeenCalledTimes(1);
  });

  it("CA-06 shows the error with Tentar de novo, keeps profile and logout, and retries", async () => {
    const loadClasses = vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(list(1));
    const { trigger } = setup({ loadClasses });
    fireEvent.click(trigger());
    expect(await screen.findByText(m.error)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: m.myProfile })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: messages.auth.logout })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: m.retry }));
    expect(await screen.findByText("Turma 1")).toBeInTheDocument();
    expect(screen.queryByText(m.error)).toBeNull();
    expect(loadClasses).toHaveBeenCalledTimes(2);
  });

  it("CA-06 uses the real service when no loader is injected", async () => {
    const spy = vi.spyOn(classService, "myClasses").mockResolvedValue(list(1));
    render(<AccountMenu user={teacher} logout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: teacher.name }));
    expect(await screen.findByText("Turma 1")).toBeInTheDocument();
    spy.mockRestore();
  });

  // CA-07
  it("CA-07 shows the empty message", async () => {
    const { trigger } = setup({ loadClasses: vi.fn().mockResolvedValue(list(0)) });
    fireEvent.click(trigger());
    expect(await screen.findByText(m.empty)).toBeInTheDocument();
  });

  // CA-08
  it("CA-08 shows up to 5 classes with name, code and semester, and a teacher gets links and Ver todas", async () => {
    const { trigger } = setup({ loadClasses: vi.fn().mockResolvedValue(list(7, 7)) });
    fireEvent.click(trigger());
    await screen.findByText("Turma 1");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("Turma 6")).toBeNull();
    expect(screen.getByText("SO1 · 2026/2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Turma 2/ })).toHaveAttribute("href", "/app/classes/id-2");
    expect(screen.getByRole("link", { name: m.seeAll })).toHaveAttribute("href", "/app/classes");
  });

  it("CA-08 does not show Ver todas to a teacher with 5 classes or fewer", async () => {
    const { trigger } = setup({ loadClasses: vi.fn().mockResolvedValue(list(5)) });
    fireEvent.click(trigger());
    await screen.findByText("Turma 5");
    expect(screen.queryByRole("link", { name: m.seeAll })).toBeNull();
  });

  it("CA-08 a student sees plain text, the pending tag and the count instead of a link", async () => {
    const items = [cls(1, { relation: "STUDENT", enrollmentStatus: "ACTIVE" }), cls(2, { relation: "STUDENT", enrollmentStatus: "PENDING_MODERATION" })];
    const { trigger } = setup({ user: student, loadClasses: vi.fn().mockResolvedValue({ items, total: 8 }) });
    fireEvent.click(trigger());
    await screen.findByText("Turma 1");
    expect(screen.queryByRole("link", { name: /Turma 1/ })).toBeNull();
    expect(screen.getAllByText(m.pending)).toHaveLength(1);
    expect(screen.getByText(m.count(2, 8))).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: m.seeAll })).toBeNull();
  });

  it("CA-08 a student with 5 classes or fewer sees no count", async () => {
    const { trigger } = setup({ user: student, loadClasses: vi.fn().mockResolvedValue(list(3, 3, { relation: "STUDENT" })) });
    fireEvent.click(trigger());
    await screen.findByText("Turma 3");
    expect(screen.queryByText(/Mostrando/)).toBeNull();
  });

  // CA-09
  it("CA-09 an administrator sees the role instead of the classes and nothing is requested", () => {
    const { trigger, loadClasses } = setup({ user: { name: "Admin", email: "a@utfpr.edu.br", role: "ADMIN" } });
    fireEvent.click(trigger());
    expect(screen.queryByRole("heading", { name: m.myClasses })).toBeNull();
    expect(screen.getByText(messages.home.role.ADMIN!)).toBeInTheDocument();
    expect(loadClasses).not.toHaveBeenCalled();
  });

  // Engine conformance moved into the account menu (ajustes gerais): the administrator reaches it from here.
  it("an administrator sees the engine conformance link that leads to /app/admin/conformidade and closes the panel", () => {
    const { trigger, panel } = setup({ user: { name: "Admin", email: "a@utfpr.edu.br", role: "ADMIN" } });
    fireEvent.click(trigger());
    const link = screen.getByRole("link", { name: messages.conformance.nav });
    expect(link).toHaveAttribute("href", "/app/admin/conformidade");
    fireEvent.click(link);
    expect(panel()).toBeNull();
  });

  it.each(["TEACHER", "STUDENT"] as const)("does not show the engine conformance link to a %s", (role) => {
    const user = role === "TEACHER" ? teacher : student;
    const { trigger } = setup({ user });
    fireEvent.click(trigger());
    expect(screen.queryByRole("link", { name: messages.conformance.nav })).toBeNull();
  });

  it("shows no email line when the session has none", () => {
    const { trigger } = setup({ user: { name: "Sem Email" } });
    fireEvent.click(trigger());
    expect(screen.queryByText(/@/)).toBeNull();
  });

  // CA-10
  it("CA-10 exposes aria-expanded, aria-controls and a named region", async () => {
    const { trigger, panel } = setup();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger().getAttribute("aria-controls")).toBe(panel()!.id);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByRole("list")).toBeInTheDocument();
  });
});

// The stylesheet is not applied in jsdom, so CA-11 and CA-12 are checked on the rules themselves.
describe("AccountMenu styles", () => {
  const scss = readFileSync(path.resolve(import.meta.dirname, "AccountMenu.module.scss"), "utf8");

  it("CA-11 animates only when the user does not ask for reduced motion", () => {
    const all = scss.match(/animation:/g) ?? [];
    const guarded = scss.match(/@media \(prefers-reduced-motion: no-preference\) \{\s*animation:/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(guarded).toHaveLength(all.length);
  });

  it("CA-12 hides the name from the bar below 640px and keeps the 44px target and 320px panel", () => {
    const { trigger } = setup();
    expect(screen.getByText(teacher.name).className).toBe("name");
    expect(trigger()).toBeInTheDocument();
    expect(scss).toMatch(/\.name \{\s*display: none;/);
    expect(scss).toMatch(/@include from\("sm"\)/);
    expect(scss).toContain("min-height: 44px");
    expect(scss).toContain("min(20rem, 100vw - 2rem)");
  });

  it("CA-12 shows the name in the panel", async () => {
    const { trigger } = setup();
    fireEvent.click(trigger());
    await waitFor(() => expect(document.querySelector(".fullName")?.textContent).toBe(teacher.name));
  });
});
