const PROVIDERS = new Set(["openai", "gemini"]);

export function getAIConfig() {
  const configuredProvider = String(process.env.AI_PROVIDER || "").trim().toLowerCase();
  const model = String(process.env.AI_INTERVIEW_MODEL || "").trim();
  const inferredProvider = model.startsWith("gemini-") || (!process.env.OPENAI_API_KEY && process.env.GEMINI_API_KEY)
    ? "gemini"
    : "openai";
  const provider = configuredProvider || inferredProvider;
  if (!PROVIDERS.has(provider))
    throw new Error("AI_PROVIDER must be either openai or gemini.");

  const key = String(process.env.AI_API_KEY
    || (provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY)
    || "").trim();
  return {
    provider,
    key,
    questionModel: model || (provider === "gemini" ? "gemini-3.8-flash" : "gpt-4o-mini"),
    transcribeModel: String(process.env.AI_INTERVIEW_TRANSCRIBE_MODEL || "").trim()
      || (provider === "gemini" ? "gemini-3.8-flash" : "gpt-transcribe"),
    ttsModel: String(process.env.AI_INTERVIEW_TTS_MODEL || "").trim()
      || (provider === "gemini" ? "gemini-3.8-flash-tts" : "gpt-4o-mini-tts"),
    voice: String(process.env.AI_INTERVIEW_VOICE || "").trim()
      || (provider === "gemini" ? "Kore" : "coral"),
  };
}

export function validateAIConfig() {
  const config = getAIConfig();
  if (!config.key || /^(your-|<your|replace-)/i.test(config.key))
    throw new Error(`Configure a real ${config.provider === "gemini" ? "Gemini" : "OpenAI"} API key using AI_API_KEY.`);
  return config;
}

export function geminiGenerateUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export async function logProviderFailure(provider, response, operation) {
  let payload = {};
  try { payload = await response.json(); } catch { /* no JSON error body */ }
  console.error("AI provider request failed", {
    provider,
    operation,
    status: response.status,
    code: payload.error?.code || payload.error?.status,
    type: payload.error?.type,
    message: String(payload.error?.message || "").slice(0, 500),
    requestId: response.headers.get("x-request-id") || response.headers.get("x-goog-request-id"),
  });
}

export function geminiText(payload) {
  return payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text?.trim() || "";
}
