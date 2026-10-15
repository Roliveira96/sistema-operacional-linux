import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import { LiveTopicScreen, type TopicLive } from "@/components/TopicStudy/LiveTopicScreen";
import type { LiveModuleContent } from "@/services/classroomService";

// The terminal engine is not loaded: the teacher's window is mounted by a stand-in, and the copy of the student never mounts it.
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

afterEach(cleanup);

const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { title: "Sistema", command: "uname", html: "<p>Sobre o sistema</p>" } },
    {
      id: "b-2",
      type: "COMMAND",
      position: 1,
      payload: {
        steps: [
          { command: "uname -o", explanation: "Mostra o sistema operacional", outputExplanation: "GNU/Linux" },
          { command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" }, expectError: true },
        ],
      },
    },
    { id: "b-3", type: "TEXT", position: 2, payload: { title: "Pasta", command: "pwd", html: "<p>Onde estou</p>" } },
    { id: "b-4", type: "COMMAND", position: 3, payload: { steps: [{ command: "pwd" }] } },
  ],
};

const picture: ScreenElement = { tag: "div", attrs: { class: "janela" }, children: [{ tag: "div", attrs: { class: "term-linha" }, children: ["ls"] }] };

/** What is not in the flow of the stage: the notices that sit over it, and the pointer of the teacher. */
const OVER = "[role='status'], [role='alert'], [data-pointer], [data-laser]";

/** The tag and the classes of an element, as they can be compared: the student's only has `follower` and `fixedDivider`, which say that nobody scrolls or moves it. */
const nameOf = (el: Element) =>
  `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter((name) => name && name !== "follower" && name !== "fixedDivider").join(".")}`;

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
  return render(<LiveTopicScreen live={live} />);
}

const panelOf = (root: Element) => root.querySelector("[data-live-panel]") as Element;
const examples = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
const runButton = (example: Element) => {
  const found = example.querySelector("button");
  expect(found, `the example "${example.textContent}" has no run button`).not.toBeNull();
  return found as HTMLButtonElement;
};

// SPEC-060 CA-02, CA-05, SPEC-057 CA-22: the material has the same layout for the teacher and for the student, run buttons included
describe("the examples of the material, for the teacher and for the student", () => {
  async function both() {
    const teacher = stage("teacher");
    await waitFor(() => expect(teacher.container.querySelector(".janela")).not.toBeNull());
    await act(async () => undefined);
    const forTeacher = {
      flow: flowOf(panelOf(teacher.container)),
      places: examples(teacher.container).map((example) => placeOf(runButton(example), panelOf(teacher.container))),
      buttons: examples(teacher.container).map((example) => runButton(example).outerHTML.replace(/ disabled=""| tabindex="-1"/g, "")),
    };
    teacher.unmount();
    const student = stage("student");
    await act(async () => undefined);
    const forStudent = {
      flow: flowOf(panelOf(student.container)),
      places: examples(student.container).map((example) => placeOf(runButton(example), panelOf(student.container))),
      buttons: examples(student.container).map((example) => runButton(example).outerHTML.replace(/ disabled=""| tabindex="-1"/g, "")),
    };
    return { forTeacher, forStudent, student };
  }

  it("draws a run button in every example, for both", async () => {
    const { forTeacher, forStudent } = await both();
    expect(forTeacher.buttons).toHaveLength(3);
    expect(forStudent.buttons).toHaveLength(3);
  });

  it("has the same elements in the flow of the material, in the same order, run buttons included", async () => {
    const { forTeacher, forStudent } = await both();
    expect(forStudent.flow).toEqual(forTeacher.flow);
    expect(JSON.stringify(forTeacher.flow)).toContain("button.run");
  });

  it("puts each run button in the same place in the flow for the student as for the teacher: first of its example, before the command", async () => {
    const { forTeacher, forStudent } = await both();
    expect(forStudent.places).toEqual(forTeacher.places);
    for (const place of forTeacher.places) expect((place as string[][])[0]).toEqual([]);
  });

  it("draws the button the same for both: only that it is off and out of the tab order is the student's", async () => {
    const { forTeacher, forStudent, student } = await both();
    expect(forStudent.buttons).toEqual(forTeacher.buttons);
    for (const example of examples(student.container)) {
      expect(runButton(example).disabled).toBe(true);
      expect(runButton(example).tabIndex).toBe(-1);
    }
  });

  it("has the example with the explanation, the tag of the terminal and the mark of the error in both, so each row has the same size", async () => {
    const { student } = await both();
    const teacher = stage("teacher");
    const text = (root: Element) => examples(root).map((example) => example.textContent);
    expect(text(student.container)).toEqual(text(teacher.container));
    expect(text(student.container)[1]).toContain("T2");
  });
});
