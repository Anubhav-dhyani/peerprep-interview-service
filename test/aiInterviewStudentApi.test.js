import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express, { raw } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import AIInterview from "../src/models/AIInterview.js";
import AIInterviewSession from "../src/models/AIInterviewSession.js";
import Resume from "../src/models/Resume.js";
import * as controller from "../src/controllers/aiInterviewStudentController.js";

let mongo, server, base, interviewId;
const studentA = new mongoose.Types.ObjectId().toString();
const studentB = new mongoose.Types.ObjectId().toString();
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "ai_student_test" });
  await Promise.all([AIInterview.init(), AIInterviewSession.init(), Resume.init()]);
  const data = {
    title: "Student practice", role: "Engineer", experience: "junior", difficulty: "easy",
    rules: { language: "English" },
    sections: [{ id: "section", name: "Technical", weight: 100, groups: [{
      id: "group", name: "Projects", source: "manual", weight: 100,
      questions: [
        { id: "specific", kind: "specific", prompt: "Describe a project.", maxFollowUps: 1 },
        { id: "resume", kind: "resume", resumeCount: 1, maxFollowUps: 1 },
      ],
    }] }],
  };
  const interview = await AIInterview.create({
    ownerId: new mongoose.Types.ObjectId(), creationKey: "student-api-test", title: data.title,
    data, publishedSnapshot: { data, revision: 1, at: new Date() }, publishedAt: new Date(), requiresResume: true,
  });
  interviewId = String(interview._id);
  await Resume.create([{ student: studentA, projects: [{ title: "Compiler" }] }, { student: studentB, projects: [{ title: "Search" }] }]);
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("api.openai.com")) return originalFetch(url, options);
    if (String(url).endsWith("/audio/transcriptions")) return { ok: true, json: async () => ({ text: "Recorded answer" }) };
    if (String(url).endsWith("/audio/speech")) return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: '{"question":"How did you verify it?"}' }] }] }) };
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { _id: req.get("X-Student") || studentA }; next(); });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  app.get("/interviews", wrap(controller.listStudentInterviews));
  app.post("/interviews/:id/start", wrap(controller.startStudentInterview));
  app.get("/sessions/:id", wrap(controller.getStudentSession));
  app.get("/sessions/:id/question-audio", wrap(controller.getQuestionAudio));
  app.post("/sessions/:id/transcribe", raw({ type: "audio/webm", limit: "8mb" }), wrap(controller.transcribeStudentAnswer));
  app.post("/sessions/:id/answer", wrap(controller.answerStudentQuestion));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  await new Promise((resolve) => server?.close(resolve) || resolve());
  await mongoose.disconnect();
  await mongo?.stop();
});
const call = async (path, method = "GET", body, student = studentA) => {
  const response = await originalFetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", "X-Student": student },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
};
const record = async (session, student = studentA) => {
  const response = await originalFetch(`${base}/sessions/${session.id}/transcribe`, {
    method: "POST", headers: { "Content-Type": "audio/webm", "X-Interview-Version": String(session.version), "X-Student": student },
    body: new Uint8Array(200),
  });
  return { status: response.status, body: await response.json() };
};

test("resume consent, answer sequencing, and student ownership are enforced", async () => {
  const listed = await call("/interviews");
  assert.equal(listed.body[0].requiresResume, true);
  assert.equal((await call(`/interviews/${interviewId}/start`, "POST", {})).status, 422);
  const started = await call(`/interviews/${interviewId}/start`, "POST", { resumeConsent: true });
  assert.equal(started.status, 201);
  assert.equal(started.body.totalQuestions, 2);
  assert.equal(started.body.plan, undefined);
  assert.equal(started.body.resumeContext, undefined);
  assert.equal((await call(`/sessions/${started.body.id}`, "GET", undefined, studentB)).status, 404);
  assert.equal((await call(`/sessions/${started.body.id}/answer`, "POST", { answer: "typed", version: started.body.version })).status, 422);
  assert.equal((await call(`/sessions/${started.body.id}/answer`, "POST", { version: started.body.version })).status, 422);
  const spoken = await originalFetch(`${base}/sessions/${started.body.id}/question-audio`, {
    headers: { "X-Interview-Version": String(started.body.version) },
  });
  assert.equal(spoken.status, 200);
  assert.equal(spoken.headers.get("content-type"), "audio/mpeg");
  let session = started.body;
  for (let i = 0; i < 4; i++) {
    assert.equal((await record(session, studentB)).status, 404);
    const transcribed = await record(session);
    assert.equal(transcribed.status, 200);
    assert.equal(transcribed.body.transcript, "Recorded answer");
    assert.ok(transcribed.body.transcriptId);
    assert.equal((await call(`/sessions/${session.id}`)).body.pendingTranscript, "Recorded answer");
    assert.equal((await call(`/sessions/${session.id}/answer`, "POST", { version: session.version, transcriptId: "wrong" })).status, 409);
    const next = await call(`/sessions/${session.id}/answer`, "POST", { version: session.version, transcriptId: transcribed.body.transcriptId });
    assert.equal(next.status, 200);
    assert.equal(next.body.pendingTranscript, null);
    assert.equal(next.body.pendingTranscriptId, null);
    if (i === 0) {
      assert.equal(next.body.questionNumber, 1);
      assert.equal(next.body.followUpNumber, 1);
      assert.equal((await call(`/sessions/${session.id}/answer`, "POST", { version: session.version, transcriptId: transcribed.body.transcriptId })).status, 409);
    }
    session = next.body;
  }
  assert.equal(session.status, "completed");
  assert.equal(session.turns.length, 4);
  assert.equal((await call(`/interviews/${interviewId}/start`, "POST", { resumeConsent: true })).body.id, session.id);
  const other = await call(`/interviews/${interviewId}/start`, "POST", { resumeConsent: true }, studentB);
  assert.equal(other.status, 201);
  assert.notEqual(other.body.id, session.id);
  await AIInterview.updateOne({ _id: interviewId }, { $unset: { publishedSnapshot: "", publishedAt: "" } });
  assert.equal((await call("/interviews")).body[0].status, "completed");
  assert.equal((await call("/interviews", "GET", undefined, studentB)).body[0].status, "active");
});
