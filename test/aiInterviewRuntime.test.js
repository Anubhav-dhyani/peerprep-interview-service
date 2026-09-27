import assert from "node:assert/strict";
import { test } from "node:test";
import { makePlan, nextQuestion, resumeForInterview } from "../src/services/aiInterviewRuntime.js";

test("specific, topic and resume questions expand into a stable student plan", () => {
  const data = {
    title: "Practice",
    sections: [{ id: "s1", name: "Technical", weight: 100, groups: [{
      id: "g1", name: "APIs", source: "manual", weight: 100,
      questions: [
        { id: "q1", kind: "specific", prompt: "Explain REST.", maxFollowUps: 2 },
        { id: "q2", kind: "topic", prompt: "HTTP caching", maxFollowUps: 1 },
        { id: "q3", kind: "resume", resumeCount: 3, maxFollowUps: 2 },
      ],
    }] }],
  };
  const a = makePlan(data, "student-a");
  assert.deepEqual(a, makePlan(data, "student-a"));
  assert.notDeepEqual(a.map((item) => item.id), makePlan(data, "student-b").map((item) => item.id));
  assert.equal(a.length, 5);
  assert.equal(a.filter((item) => item.kind === "resume").length, 3);
  assert.equal(new Set(a.map((item) => item.id)).size, 5);
  assert.equal(a.reduce((total, item) => total + item.maxFollowUps, 0), 9);
});

test("answer-based follow-ups finish before moving to the next main question", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ question: "How would you validate that answer?" }) }] }] }) };
  };
  try {
    const plan = [
      { id: "q1:0", kind: "specific", topic: "APIs", prompt: "Explain REST.", context: "", followUps: [], maxFollowUps: 2 },
      { id: "q2:0", kind: "specific", topic: "APIs", prompt: "Explain caching.", context: "", followUps: [], maxFollowUps: 0 },
    ];
    const session = { plan, index: 0, followUpIndex: 0, currentQuestion: "Explain REST.", turns: [], resumeContext: "" };
    const first = await nextQuestion(session, "Resources use URLs.", "English");
    assert.equal(first.index, 0);
    assert.equal(first.followUpIndex, 1);
    assert.match(requests[0].input, /Resources use URLs/);
    session.followUpIndex = 1;
    session.currentQuestion = first.currentQuestion;
    session.turns.push({ itemId: "q1:0", question: "Explain REST.", answer: "Resources use URLs.", followUp: false });
    const second = await nextQuestion(session, "Use status codes.", "English");
    assert.equal(second.index, 0);
    assert.equal(second.followUpIndex, 2);
    session.followUpIndex = 2;
    const next = await nextQuestion(session, "Check response headers.", "English");
    assert.equal(next.index, 1);
    assert.equal(next.currentQuestion, "Explain caching.");
    session.index = 1;
    session.followUpIndex = 0;
    assert.equal((await nextQuestion(session, "Use Cache-Control.", "English")).status, "completed");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("resume model context excludes contact details", () => {
  const content = resumeForInterview({ basics: { email: "private@example.com" }, projects: [{ title: "Compiler" }], skills: [] });
  assert.match(content, /Compiler/);
  assert.doesNotMatch(content, /private@example.com/);
});
