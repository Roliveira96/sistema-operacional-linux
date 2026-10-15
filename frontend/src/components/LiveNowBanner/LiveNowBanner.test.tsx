import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { classroomService, type MyLiveRoom } from "@/services/classroomService";
import { LiveNowBanner } from "./LiveNowBanner";

vi.mock("@/services/classroomService", () => ({ classroomService: { listMyLive: vi.fn() } }));

const listMyLive = vi.mocked(classroomService.listMyLive);

const room = (n: number, over: Partial<MyLiveRoom> = {}): MyLiveRoom => ({
  classId: `c-${n}`,
  className: `Turma ${n}`,
  sessionId: `s-${n}`,
  title: `Aula ${n}`,
  startedAt: "2026-10-15T19:00:00Z",
  ...over,
});

// The visibility of the tab, which jsdom keeps always visible.
let visibility: "visible" | "hidden" = "visible";
function showTab(state: "visible" | "hidden") {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  listMyLive.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

// SPEC-067: the notice of the live class that is going on, for the student
describe("LiveNowBanner", () => {
  // CA-06
  it("shows the live class with its title, its class and the button to enter", async () => {
    listMyLive.mockResolvedValue([room(1)]);
    render(<LiveNowBanner />);
    await flush();

    const notice = screen.getByRole("status");
    expect(within(notice).getByText(messages.liveNow.title("Aula 1"))).toBeDefined();
    expect(within(notice).getByText("Turma 1")).toBeDefined();
    expect(within(notice).getByRole("link", { name: messages.liveNow.enter }).getAttribute("href")).toBe("/app/classes/c-1/live");
  });

  // CA-07, CA-15
  it("shows one line for each class that is live, in the order it was told", async () => {
    listMyLive.mockResolvedValue([room(2), room(1)]);
    render(<LiveNowBanner />);
    await flush();

    const links = screen.getAllByRole("link", { name: messages.liveNow.enter });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/app/classes/c-2/live", "/app/classes/c-1/live"]);
    const lines = screen.getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.textContent).toContain("Aula 2");
    expect(lines[1]?.textContent).toContain("Aula 1");
  });

  // CA-08
  it("shows nothing, and takes no room, while no class is live", async () => {
    listMyLive.mockResolvedValue([]);
    const { container } = render(<LiveNowBanner />);
    await flush();

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  // Goal: it comes and goes by itself, as the class starts and ends
  it("shows the notice when a class starts and takes it away when it ends, without a reload", async () => {
    listMyLive.mockResolvedValueOnce([]).mockResolvedValueOnce([room(1)]).mockResolvedValue([]);
    render(<LiveNowBanner />);
    await flush();
    expect(screen.queryByRole("status")).toBeNull();

    await advance(20_000);
    expect(screen.getByRole("link", { name: messages.liveNow.enter })).toBeDefined();

    await advance(20_000);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // CA-12
  it("hides the notice with no error when the check fails, and tries again on the next one", async () => {
    listMyLive.mockResolvedValueOnce([room(1)]).mockRejectedValueOnce(new Error("offline")).mockResolvedValue([room(1)]);
    const { container } = render(<LiveNowBanner />);
    await flush();
    expect(screen.getByRole("status")).toBeDefined();

    await advance(20_000);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.innerHTML).toBe("");

    await advance(20_000);
    expect(screen.getByRole("status")).toBeDefined();
  });

  // CA-11
  it("checks when it opens and every 20 seconds, and not while the tab is hidden", async () => {
    listMyLive.mockResolvedValue([]);
    render(<LiveNowBanner />);
    await flush();
    expect(listMyLive).toHaveBeenCalledTimes(1);

    await advance(19_999);
    expect(listMyLive).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(listMyLive).toHaveBeenCalledTimes(2);

    act(() => showTab("hidden"));
    await advance(60_000);
    expect(listMyLive).toHaveBeenCalledTimes(2);

    act(() => showTab("visible"));
    await flush();
    expect(listMyLive).toHaveBeenCalledTimes(3);

    await advance(20_000);
    expect(listMyLive).toHaveBeenCalledTimes(4);
  });

  it("stops checking when it leaves the screen", async () => {
    listMyLive.mockResolvedValue([]);
    const view = render(<LiveNowBanner />);
    await flush();
    view.unmount();

    await advance(60_000);
    act(() => showTab("hidden"));
    act(() => showTab("visible"));
    await flush();
    expect(listMyLive).toHaveBeenCalledTimes(1);
  });
});
