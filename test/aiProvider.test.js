import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { generateQuestion } from "../src/services/aiInterviewRuntime.js";
import { speakQuestion, transcribeAudio } from "../src/services/interviewAudio.js";

const originalFetch = globalThis.fetch;
const tracked = [
  "AI_PROVIDER", "AI_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY",
  "AI_INTERVIEW_MODEL", "AI_INTERVIEW_TRANSCRIBE_MODEL", "AI_INTERVIEW_TTS_MODEL", "AI_INTERVIEW_VOICE",
];
const originalEnv = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of tracked) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function useGemini() {
  process.env.AI_PROVIDER = "gemini";
  process.env.AI_API_KEY = "gemini-test-key";
  process.env.AI_INTERVIEW_MODEL = "gemini-question-test";
  process.env.AI_INTERVIEW_TRANSCRIBE_MODEL = "gemini-transcribe-test";
  process.env.AI_INTERVIEW_TTS_MODEL = "gemini-tts-test";
  process.env.AI_INTERVIEW_VOICE = "Kore";
}

test("Gemini generates structured interview questions", async () => {
  useGemini();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"question":"How does event delegation work?"}' }] } }] }),
    };
  };
  const question = await generateQuestion({ kind: "topic", topic: "JavaScript", prompt: "DOM events" });
  assert.equal(question, "How does event delegation work?");
  assert.match(request.url, /gemini-question-test:generateContent$/);
  assert.equal(request.options.headers["x-goog-api-key"], "gemini-test-key");
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(request.body.generationConfig.responseJsonSchema.required, ["question"]);
});

test("Gemini transcribes inline browser audio", async () => {
  useGemini();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "My recorded answer." }] } }] }),
    };
  };
  const transcript = await transcribeAudio(Buffer.alloc(200, 1), "audio/webm;codecs=opus");
  assert.equal(transcript, "My recorded answer.");
  assert.match(request.url, /gemini-transcribe-test:generateContent$/);
  assert.equal(request.body.contents[0].parts[0].inlineData.mimeType, "audio/webm");
  assert.ok(request.body.contents[0].parts[0].inlineData.data.length > 100);
});

test("Gemini PCM speech is wrapped as browser-playable WAV", async () => {
  useGemini();
  const pcm = Buffer.alloc(400, 2);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: {
        mimeType: "audio/L16;codec=pcm;rate=24000",
        data: pcm.toString("base64"),
      } }] } }] }),
    };
  };
  const spoken = await speakQuestion("What did you build?");
  assert.equal(spoken.contentType, "audio/wav");
  assert.equal(spoken.audio.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(spoken.audio.length, pcm.length + 44);
  assert.match(request.url, /gemini-tts-test:generateContent$/);
  assert.equal(request.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
});
