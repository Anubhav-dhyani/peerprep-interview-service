import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { requireInterviewServiceToken } from "../src/services/interviewServiceAuth.js";

const previousSecret = process.env.INTERVIEW_SERVICE_SECRET;
let server, base;
before(async () => {
  process.env.INTERVIEW_SERVICE_SECRET = "handoff-test-secret-at-least-32-characters";
  const app = express();
  app.get("/internal", requireInterviewServiceToken, (req, res) => res.json({ studentId: req.user._id }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server?.close(resolve) || resolve());
  if (previousSecret === undefined) delete process.env.INTERVIEW_SERVICE_SECRET;
  else process.env.INTERVIEW_SERVICE_SECRET = previousSecret;
});

test("only short-lived student-scoped PeerPrep tokens enter the runtime", async () => {
  const token = jwt.sign({ sub: "507f1f77bcf86cd799439011", role: "student" }, process.env.INTERVIEW_SERVICE_SECRET, {
    algorithm: "HS256", audience: "peerprep-interview-runtime", issuer: "peerprep-api", expiresIn: "30s",
  });
  assert.equal((await fetch(`${base}/internal`)).status, 401);
  const accepted = await fetch(`${base}/internal`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { studentId: "507f1f77bcf86cd799439011" });
  const wrongAudience = jwt.sign({ sub: "507f1f77bcf86cd799439011", role: "student" }, process.env.INTERVIEW_SERVICE_SECRET, {
    algorithm: "HS256", audience: "another-service", issuer: "peerprep-api", expiresIn: "30s",
  });
  assert.equal((await fetch(`${base}/internal`, { headers: { Authorization: `Bearer ${wrongAudience}` } })).status, 401);
});
