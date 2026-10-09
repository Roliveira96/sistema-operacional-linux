import { describe, expect, it, vi } from "vitest";
import { ApiProblemError, createHttpClient } from "./httpClient";
import { createSpeechService } from "./speechService";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": status === 200 ? "application/json" : "application/problem+json" } });

// Covers SPEC-018 section 5: the frontend consumes the SPEC-017 route as it is.
describe("speechService", () => {
  it("posts the text and returns the audio with the word timings", async () => {
    const result = { audioBase64: "AAA=", mimeType: "audio/mpeg", voice: "pt-BR-FranciscaNeural", words: [{ word: "Olá", startMs: 100, endMs: 400 }] };
    const fetcher = vi.fn().mockResolvedValue(json(result));
    const service = createSpeechService(createHttpClient(fetcher));
    expect(await service.synthesize("Olá")).toEqual(result);
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/speech-syntheses");
    expect(fetcher.mock.calls[0]![1].method).toBe("POST");
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ text: "Olá" }));
  });

  it("sends the voice only when one is asked for", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}));
    await createSpeechService(createHttpClient(fetcher)).synthesize("x", "pt-BR-AntonioNeural");
    expect(fetcher.mock.calls[0]![1].body).toBe(JSON.stringify({ text: "x", voice: "pt-BR-AntonioNeural" }));
  });

  it.each([401, 429, 502, 503, 504])("raises the problem of a %s answer", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(json({ type: "x", title: "x", status }, status));
    const error = await createSpeechService(createHttpClient(fetcher)).synthesize("x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblemError);
    expect((error as ApiProblemError).status).toBe(status);
  });
});
