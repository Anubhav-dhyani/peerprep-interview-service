import { InterviewRuntimeError } from "./aiInterviewRuntime.js";
import { geminiGenerateUrl, geminiText, getAIConfig, logProviderFailure } from "./aiProvider.js";

const fail = (message) => { throw new InterviewRuntimeError(503, message); };
const formats = new Map([
  ["audio/webm", "webm"], ["audio/mp4", "mp4"],
  ["audio/wav", "wav"], ["audio/mpeg", "mp3"],
]);

function pcmToWav(pcm, sampleRate = 24000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function browserAudio(buffer, mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" || mime.includes("wav"))
    return { audio: buffer, contentType: "audio/wav" };
  if (mime.includes("l16") || mime.includes("pcm")) {
    const sampleRate = Number.parseInt(mime.match(/rate=(\d+)/)?.[1] || "24000", 10);
    return { audio: pcmToWav(buffer, sampleRate), contentType: "audio/wav" };
  }
  return { audio: buffer, contentType: mime.split(";")[0] || "audio/wav" };
}

export async function transcribeAudio(buffer, contentType) {
  const mime = String(contentType || "").split(";")[0].toLowerCase();
  const extension = formats.get(mime);
  if (!extension) throw new InterviewRuntimeError(415, "Use a supported microphone recording format.");
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 8 * 1024 * 1024)
    throw new InterviewRuntimeError(422, "Record an answer between 100 bytes and 8 MB.");
  const config = getAIConfig();
  if (!config.key) fail("Speech transcription is not configured.");
  if (config.provider === "gemini") {
    let response;
    try {
      response = await fetch(geminiGenerateUrl(config.transcribeModel), {
        method: "POST",
        headers: { "x-goog-api-key": config.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { inlineData: { mimeType: mime, data: buffer.toString("base64") } },
            { text: "Transcribe the candidate's spoken interview answer exactly. Return only the transcript, without commentary, speaker labels, timestamps, or Markdown." },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: 4096 },
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch { fail("ANNU could not transcribe your recording. Please try again."); }
    if (!response.ok) {
      await logProviderFailure(config.provider, response, "transcription");
      fail("ANNU could not transcribe your recording. Please try again.");
    }
    let payload;
    try { payload = await response.json(); } catch { fail("ANNU returned an invalid transcript."); }
    const text = geminiText(payload);
    if (!text || text.length > 4000)
      throw new InterviewRuntimeError(422, "The recording did not produce a usable answer. Please record it again.");
    return text;
  }
  const body = new FormData();
  body.set("model", config.transcribeModel);
  body.set("file", new Blob([buffer], { type: mime }), `answer.${extension}`);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${config.key}` },
      body, signal: AbortSignal.timeout(60000),
    });
  } catch { fail("ANNU could not transcribe your recording. Please try again."); }
  if (!response.ok) {
    await logProviderFailure(config.provider, response, "transcription");
    fail("ANNU could not transcribe your recording. Please try again.");
  }
  let payload;
  try { payload = await response.json(); } catch { fail("ANNU returned an invalid transcript."); }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text || text.length > 4000) throw new InterviewRuntimeError(422, "The recording did not produce a usable answer. Please record it again.");
  return text;
}

export async function speakQuestion(question) {
  const config = getAIConfig();
  if (!config.key) fail("Speech playback is not configured.");
  let response;
  try {
    response = config.provider === "gemini"
      ? await fetch(geminiGenerateUrl(config.ttsModel), {
        method: "POST",
        headers: { "x-goog-api-key": config.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Speak clearly and professionally as a friendly interviewer. Read exactly this question and add no other words:\n\n${question.slice(0, 4000)}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } },
          },
        }),
        signal: AbortSignal.timeout(45000),
      })
      : await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ttsModel,
        voice: config.voice,
        input: question.slice(0, 4000), response_format: "mp3",
        instructions: "Speak clearly and professionally as a friendly interviewer. Do not add words to the question.",
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch { fail("ANNU could not speak this question. Please try playback again."); }
  if (!response.ok) {
    await logProviderFailure(config.provider, response, "text-to-speech");
    fail("ANNU could not speak this question. Please try playback again.");
  }
  if (config.provider === "gemini") {
    let payload;
    try { payload = await response.json(); } catch { fail("ANNU returned invalid question audio."); }
    const part = payload.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
    const audio = part?.inlineData?.data ? Buffer.from(part.inlineData.data, "base64") : Buffer.alloc(0);
    if (!audio.length || audio.length > 8 * 1024 * 1024) fail("ANNU returned invalid question audio.");
    return browserAudio(audio, part?.inlineData?.mimeType);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || audio.length > 8 * 1024 * 1024) fail("ANNU returned invalid question audio.");
  return { audio, contentType: "audio/mpeg" };
}
