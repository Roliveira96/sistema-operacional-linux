import { httpClient, type HttpClient } from "./httpClient";

export interface SpokenWordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SpeechResult {
  /** MP3 in plain Base64, without the data: prefix. */
  audioBase64: string;
  mimeType: string;
  voice: string;
  words: SpokenWordTiming[];
}

/** Speech endpoint of SPEC-017: text in, audio and word timings out. Needs a session. */
export function createSpeechService(client: HttpClient = httpClient) {
  return {
    synthesize: (text: string, voice?: string) => client.post<SpeechResult>("/speech-syntheses", voice ? { text, voice } : { text }),
  };
}

export type SpeechService = ReturnType<typeof createSpeechService>;

export const speechService = createSpeechService();
