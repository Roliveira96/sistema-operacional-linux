import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import { LiveTopicScreen, type TopicLive } from "@/components/TopicStudy/LiveTopicScreen";
import type { LiveModuleContent } from "@/services/classroomService";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import type { PdfLoader } from "../SlidePresenter/pdfRenderer";

// The terminal engine is not loaded: the teacher's window is mounted by a stand-in, and the copy of the student never mounts it.
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

afterEach(cleanup);

const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { title: "Primeiro", command: "Um", html: "<p>Primeiro bloco</p>" } },
    { id: "b-2", type: "TEXT", position: 1, payload: { title: "Segundo", command: "Dois", html: "<p>Segundo bloco</p>" } },
  ],
};

const picture: ScreenElement = { tag: "div", attrs: { class: "janela" }, children: [{ tag: "div", attrs: { class: "term-linha" }, children: ["ls"] }] };

/** What is not in the flow of the stage: the notices that sit over it, and the pointer of the teacher. */
const OVER = "[role='status'], [role='alert'], [data-pointer], [data-laser]";

/** The tag and the classes of an element, as they can be compared: the student's only has `follower`, which says that nobody scrolls it. */
const nameOf = (el: Element) =>
  `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter((name) => name && name !== "follower").join(".")}`;

/** What the browser puts in the flow, in a way that can be compared: the tag and class of an element, and its children. */
function flowOf(el: Element): unknown {
  return [nameOf(el), ...Array.from(el.children).filter((child) => !child.matches(OVER)).map(flowOf)];
}

/** How many elements come before `el` in the flow of each of its ancestors, up to `root`: where it stands, with no layout to measure it by. */
function placeOf(el: Element, root: Element): unknown[] {
  const place: unknown[] = [];
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    const before = Array.from(node.parentElement!.children).slice(0, Array.from(node.parentElement!.children).indexOf(node));
    place.push(before.filter((sibling) => !sibling.matches(OVER)).map(nameOf));
  }
  return place;
}

describe("the module in the stage, for the teacher and for the student", () => {
  beforeEach(() => {
    vi.mocked(mountTerminalWindow).mockImplementation(async (container) => {
      // The teacher's engine puts its window in the element it is given.
      const window_ = document.createElement("div");
      window_.className = "janela";
      container.append(window_);
      return { setSpeed: vi.fn(), destroy: vi.fn() } as never;
    });
  });

  function stage(role: "teacher" | "student") {
    const live: TopicLive = { module: module_, role, terminal: { screen: picture }, focusBlockId: null };
    const view = render(<LiveTopicScreen live={live} />);
    return view;
  }

  // CA-22: the terminal is where it is for the teacher, whatever he is, so the pointer and the selection of the teacher fall on it
  it("puts the terminal in the same place in the flow for the student as for the teacher", async () => {
    const teacher = stage("teacher");
    await waitFor(() => expect(teacher.container.querySelector(".janela")).not.toBeNull());
    await act(async () => undefined);
    const teacherWindow = teacher.container.querySelector("[class*='window']") as Element;
    const teacherPlace = placeOf(teacherWindow, teacher.container);
    teacher.unmount();

    const student = stage("student");
    await act(async () => undefined);
    const studentWindow = student.container.querySelector("[data-testid='terminal-mirror']") as Element;
    expect(studentWindow).not.toBeNull();
    expect(placeOf(studentWindow, student.container)).toEqual(teacherPlace);
  });

  it("has the same structure around the terminal for both: the terminal pane holds the window and nothing else in the flow", async () => {
    const teacher = stage("teacher");
    await waitFor(() => expect(teacher.container.querySelector(".janela")).not.toBeNull());
    const teacherPane = teacher.container.querySelector("main > div:last-child") as Element;
    expect(Array.from(teacherPane.firstElementChild!.children).filter((child) => !child.matches(OVER))).toHaveLength(1);
    teacher.unmount();

    const student = stage("student");
    const studentPane = student.container.querySelector("main > div:last-child") as Element;
    // The pane holds one view, and the view holds the window: no warning, no label, no strip above it.
    expect(studentPane.children).toHaveLength(1);
    const view = studentPane.firstElementChild!;
    expect(Array.from(view.children).filter((child) => !child.matches(OVER)).map((child) => child.getAttribute("data-testid"))).toEqual(["terminal-mirror"]);
  });

  it("has nothing in the student's view of the module that the teacher's has not, in the material and around it", async () => {
    const teacher = stage("teacher");
    await waitFor(() => expect(teacher.container.querySelector(".janela")).not.toBeNull());
    const material = (root: Element) => flowOf(root.querySelector("[data-live-panel]")!);
    const header = (root: Element) => flowOf(root.querySelector("header")!);
    const teacherStructure = { material: material(teacher.container), header: header(teacher.container) };
    teacher.unmount();
    const student = stage("student");
    expect({ material: material(student.container), header: header(student.container) }).toEqual(teacherStructure);
  });

  it("shows no text that says the copy is read only, which pushes the terminal down", () => {
    stage("student");
    expect(screen.queryByText(/Você acompanha o terminal do professor/)).toBeNull();
    expect(screen.queryByText(/teclado fica travado/)).toBeNull();
  });
});

describe("the slides in the stage, for the teacher and for the student", () => {
  const loader: PdfLoader = { load: vi.fn().mockResolvedValue({ pageCount: 3, render: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() }) };
  const slides = (canControl: boolean) =>
    render(
      <SlidePresenter
        bare
        deck={{ downloadUrl: "https://x", pageCount: 3 }}
        slide={1}
        canControl={canControl}
        cursor={{ x: 10, y: 10, laser: false, visible: true }}
        strokes={[]}
        onSlide={vi.fn()}
        onCursor={vi.fn()}
        onDraw={vi.fn()}
        onClear={vi.fn()}
        loader={loader}
      />,
    );

  it("draws the same elements in the flow, apart from the way each of them scrolls", async () => {
    const teacher = slides(true);
    await act(async () => undefined);
    const teacherFlow = flowOf(teacher.container.firstElementChild!);
    teacher.unmount();
    const student = slides(false);
    await act(async () => undefined);
    expect(flowOf(student.container.firstElementChild!)).toEqual(teacherFlow);
  });
});
