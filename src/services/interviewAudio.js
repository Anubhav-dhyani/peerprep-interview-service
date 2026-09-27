import { InterviewRuntimeError } from "./aiInterviewRuntime.js";

const fail = (message) => { throw new InterviewRuntimeError(503, message); };
const formats = new Map([
  ["audio/webm", "webm"], ["audio/mp4", "mp4"],
  ["audio/wav", "wav"], ["audio/mpeg", "mp3"],
]);

export async function transcribeAudio(buffer, contentType) {
  const mime = String(contentType || "").split(";")[0].toLowerCase();
  const extension = formats.get(mime);
  if (!extension) throw new InterviewRuntimeError(415, "Use a supported microphone recording format.");
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 8 * 1024 * 1024)
    throw new InterviewRuntimeError(422, "Record an answer between 100 bytes and 8 MB.");
  if (!process.env.OPENAI_API_KEY) fail("Speech transcription is not configured.");
  const body = new FormData();
  body.set("model", process.env.AI_INTERVIEW_TRANSCRIBE_MODEL || "gpt-transcribe");
  body.set("file", new Blob([buffer], { type: mime }), `answer.${extension}`);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body, signal: AbortSignal.timeout(60000),
    });
  } catch { fail("ANNU could not transcribe your recording. Please try again."); }
  if (!response.ok) fail("ANNU could not transcribe your recording. Please try again.");
  let payload;
  try { payload = await response.json(); } catch { fail("ANNU returned an invalid transcript."); }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text || text.length > 4000) throw new InterviewRuntimeError(422, "The recording did not produce a usable answer. Please record it again.");
  return text;
}

export async function speakQuestion(question) {
  if (!process.env.OPENAI_API_KEY) fail("Speech playback is not configured.");
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_INTERVIEW_TTS_MODEL || "gpt-4o-mini-tts",
        voice: process.env.AI_INTERVIEW_VOICE || "coral",
        input: question.slice(0, 4000), response_format: "mp3",
        instructions: "Speak clearly and professionally as a friendly interviewer. Do not add words to the question.",
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch { fail("ANNU could not speak this question. Please try playback again."); }
  if (!response.ok) fail("ANNU could not speak this question. Please try playback again.");
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 8 * 1024 * 1024) fail("ANNU returned invalid question audio.");
  return audio;
}
