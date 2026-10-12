import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import type { DescriptiveAnswer, GradingService } from "@/services/gradingService";
import "@/test/domMatchers";
import { AnswerGrading } from "./AnswerGrading";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);
const m = authoringMessages.grading;

const answer = (over: Partial<DescriptiveAnswer> = {}): DescriptiveAnswer => ({
  id: "p1",
  questionId: "q1",
  questionTitle: "Permissions",
  statement: "<p>Explain chmod 750.</p>",
  expectedAnswer: "<p>Owner rwx, group r-x.</p>",
  response: "<p>owner <code>rwx</code></p>",
  studentName: "Alice Smith",
  answeredAt: "2026-10-12T10:00:00Z",
  status: "SUGGESTED",
  suggestion: { score: 75, reason: "The group is missing.", studentNote: "Look at the group." },
  grade: null,
  ...over,
});

const service = (items: DescriptiveAnswer[]) => {
  const s = { list: vi.fn().mockResolvedValue(items), grade: vi.fn() };
  return s as typeof s & GradingService;
};

const open = async (s: ReturnType<typeof service>) => {
  render(<AnswerGrading moduleId="m1" service={s} />);
  await screen.findByRole("heading", { name: m.title });
};

describe("AnswerGrading", () => {
  // Covers SPEC-039 RN-04, RN-05 and CA-10: the teacher sees the answer, the correct one and the suggestion of the AI, with its note to
  // the student already filled in.
  it("lists the answers and shows the suggestion of the AI ready to accept", async () => {
    const s = service([answer(), answer({ id: "p2", studentName: "Bob", status: "PENDING", suggestion: null })]);
    await open(s);
    expect(s.list).toHaveBeenCalledWith("m1", "all");
    expect(screen.getByText(m.mcpHint)).toBeInTheDocument();
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    const first = within(cards[0]!);
    expect(first.getByText("Alice Smith")).toBeInTheDocument();
    expect(first.getByText(m.status.SUGGESTED)).toBeInTheDocument();
    expect(first.getByText("Owner rwx, group r-x.")).toBeInTheDocument();
    expect(first.getByText("rwx")).toBeInTheDocument();
    expect(first.getByText(m.suggested(75))).toBeInTheDocument();
    expect(first.getByText("The group is missing.")).toBeInTheDocument();
    expect((first.getByRole("textbox", { name: m.studentNote }) as HTMLTextAreaElement).value).toBe("Look at the group.");
    expect(first.queryByRole("textbox", { name: m.reason })).toBeNull();
    expect(within(cards[1]!).queryByRole("button", { name: m.useSuggestion(75) })).toBeNull();
    expect(within(cards[1]!).getByText(m.status.PENDING)).toBeInTheDocument();
  });

  // Covers SPEC-039 CA-06: accepting the suggestion sends it as it is; another band is the grade of the teacher.
  it("confirms the suggestion or a band of the teacher, with the notes", async () => {
    const s = service([answer()]);
    s.grade.mockResolvedValue(answer({ status: "GRADED", grade: { score: 75, source: "AI_ACCEPTED", studentNote: "Look at the group.", privateNote: "" } }));
    await open(s);
    const card = within(screen.getByRole("article"));
    const confirm = card.getByRole("button", { name: m.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(card.getByRole("button", { name: m.useSuggestion(75) }));
    expect(card.getByRole("radio", { name: "75%" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(card.getByRole("textbox", { name: m.privateNote }), { target: { value: "check in the next class" } });
    fireEvent.click(confirm);
    expect(s.grade).toHaveBeenCalledWith("p1", { useSuggestion: true, studentNote: "Look at the group.", privateNote: "check in the next class" });
    expect(await card.findByText(m.saved)).toBeInTheDocument();
    expect(card.getByText(m.status.GRADED)).toBeInTheDocument();
    expect(card.getByText(m.gradedAs(75, m.source.AI_ACCEPTED))).toBeInTheDocument();

    fireEvent.click(card.getByRole("radio", { name: "100%" }));
    expect(card.getByRole("textbox", { name: m.reason })).toBeInTheDocument();
  });

  // Covers SPEC-039 CA-11: a revision needs a reason, which goes with the new grade.
  it("asks the reason to revise a confirmed grade", async () => {
    const graded = answer({ status: "GRADED", grade: { score: 50, source: "TEACHER", studentNote: "Ok", privateNote: "secret" } });
    const s = service([graded]);
    s.grade.mockResolvedValue({ ...graded, grade: { ...graded.grade!, score: 100 } });
    await open(s);
    const card = within(screen.getByRole("article"));
    expect(card.getByRole("radio", { name: "50%" })).toHaveAttribute("aria-checked", "true");
    expect((card.getByRole("textbox", { name: m.privateNote }) as HTMLTextAreaElement).value).toBe("secret");
    fireEvent.click(card.getByRole("radio", { name: "100%" }));
    const confirm = card.getByRole("button", { name: m.revise }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(card.getByRole("textbox", { name: m.reason }), { target: { value: "I read the answer again." } });
    fireEvent.click(confirm);
    expect(s.grade).toHaveBeenCalledWith("p1", { score: 100, studentNote: "Ok", privateNote: "secret", reason: "I read the answer again." });
  });

  it("filters by situation and shows the errors of the server", async () => {
    const s = service([answer({ suggestion: null, status: "PENDING" })]);
    s.grade.mockRejectedValue(new ApiProblemError({ type: "validation-error", title: "Bad Request", detail: "x", invalidParams: [{ name: "score", reason: "bad" }] }, 400));
    await open(s);
    fireEvent.click(screen.getByRole("button", { name: m.filters.PENDING }));
    expect(s.list).toHaveBeenLastCalledWith("m1", "PENDING");
    await screen.findAllByRole("article");
    const card = within(screen.getByRole("article"));
    fireEvent.click(card.getByRole("radio", { name: "25%" }));
    fireEvent.click(card.getByRole("button", { name: m.confirm }));
    expect(await card.findByRole("alert")).toHaveTextContent(m.failed);

    s.list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: m.filters.GRADED }));
    expect(await screen.findByText(m.empty)).toBeInTheDocument();
  });

  it("says when the module is not found or not the teacher's", async () => {
    const s = service([]);
    s.list.mockRejectedValue(new ApiProblemError({ type: "forbidden", title: "Forbidden" }, 403));
    render(<AnswerGrading moduleId="m1" service={s} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(m.loadFailed);
  });
});
