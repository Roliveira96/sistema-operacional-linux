import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContentAuthoringService, missingTests } from "./contentAuthoringService";
import { ApiProblemError, createHttpClient, type HttpClient } from "./httpClient";

describe("contentAuthoringService", () => {
  let client: HttpClient;
  let service: ReturnType<typeof createContentAuthoringService>;

  beforeEach(() => {
    client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as HttpClient;
    service = createContentAuthoringService(client);
  });

  it("lists the blocks of a module", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ blocks: [{ id: "b" }] });
    expect(await service.list("m 1")).toEqual([{ id: "b" }]);
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m%201/blocks");
  });

  // Covers SPEC-025: the file goes to the server as a multipart form, in the field the server reads.
  it("sends an image of the content as a form and returns where it was kept", async () => {
    const saved = { url: "http://bucket/conteudo/abc.avif", width: 1220, height: 686, bytes: 4821 };
    vi.mocked(client.post).mockResolvedValueOnce(saved);
    const file = new File(["x"], "foto.png", { type: "image/png" });
    expect(await service.uploadImage(file)).toEqual(saved);
    const [path, body] = vi.mocked(client.post).mock.calls[0]!;
    expect(path).toBe("/teacher/content/images");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBeInstanceOf(File);
    expect(((body as FormData).get("file") as File).name).toBe("foto.png");
  });

  it("saves a whole card and returns its blocks", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [{ id: "b1" }] });
    const request = { replaceIds: ["b1"], blocks: [{ id: "b1", updatedAt: "2026-10-09T12:00:00Z", type: "TEXT", payload: { html: "x" } }] };
    expect(await service.saveCard("m", request)).toEqual([{ id: "b1" }]);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/cards", request);
  });

  it("reads the blocks with the snapshot of the module and stores a new one (SPEC-021)", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ blocks: [{ id: "b" }], setup: { summary: "s", steps: [{ command: "mkdir /x" }] } });
    expect(await service.content("m 1")).toEqual({ blocks: [{ id: "b" }], setup: { summary: "s", steps: [{ command: "mkdir /x" }] } });
    vi.mocked(client.get).mockResolvedValueOnce({ blocks: [], setup: null });
    expect((await service.content("m")).setup).toBeUndefined();

    vi.mocked(client.put).mockResolvedValueOnce({ setup: { steps: [{ command: "ls" }] } });
    expect(await service.setModuleSetup("m 1", { summary: " ", steps: [{ command: " ls " }] })).toEqual({ summary: "", steps: [{ command: "ls" }] });
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m%201/setup", { steps: [{ command: "ls" }] });
  });

  it("inactivates the blocks of a card", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [] });
    await service.setCardActive("m", ["a", "b"], false);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/cards/active", { blockIds: ["a", "b"], active: false });
  });

  it("reorders the blocks", async () => {
    vi.mocked(client.put).mockResolvedValueOnce({ blocks: [] });
    await service.reorder("m", ["b2", "b1"]);
    expect(client.put).toHaveBeenCalledWith("/teacher/modules/m/blocks/order", { blockIds: ["b2", "b1"] });
  });

  // SPEC-024 RN-13: versions carry the test flags, results are registered, a 409 names the missing tests.
  it("reads the versions with the flags of the tests, false when the server does not say", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ versions: [], hasUnpublishedChanges: true, moduleTestPassed: true, exerciseBankTestPassed: true });
    expect(await service.versions("m 1")).toEqual({ versions: [], hasUnpublishedChanges: true, moduleTestPassed: true, exerciseBankTestPassed: true });
    expect(client.get).toHaveBeenCalledWith("/teacher/modules/m%201/versions");
    vi.mocked(client.get).mockResolvedValueOnce({ versions: [], hasUnpublishedChanges: false });
    expect(await service.versions("m")).toMatchObject({ moduleTestPassed: false, exerciseBankTestPassed: false });
  });

  it("registers the result of a test through a fake fetch and gets the 201 body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "r1", kind: "MODULE", passed: true, contentHash: "h", createdAt: "x" }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    const real = createContentAuthoringService(createHttpClient(fetcher as unknown as typeof fetch));
    expect(await real.registerTestResult("m 1", { kind: "MODULE", passed: true, summary: { a: 1 } })).toMatchObject({ id: "r1", contentHash: "h" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/v1/teacher/modules/m%201/test-results");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ kind: "MODULE", passed: true, summary: { a: 1 } });
  });

  it("raises the 409 module-not-tested and lists the missing tests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: "module-not-tested", title: "x", status: 409, missingTests: ["MODULE", "bogus", "EXERCISE_BANK"] }), {
        status: 409,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    const real = createContentAuthoringService(createHttpClient(fetcher as unknown as typeof fetch));
    const error = await real.publish("m", "").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblemError);
    expect(missingTests(error)).toEqual(["MODULE", "EXERCISE_BANK"]);
    expect(missingTests(new ApiProblemError({ type: "no-changes", title: "x", missingTests: ["MODULE"] }, 409))).toEqual([]);
    expect(missingTests(new ApiProblemError({ type: "module-not-tested", title: "x" }, 409))).toEqual([]);
    expect(missingTests(new Error("x"))).toEqual([]);
  });
});
