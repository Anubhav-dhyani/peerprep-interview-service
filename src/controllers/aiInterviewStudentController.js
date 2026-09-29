import mongoose from "mongoose";
import crypto from "node:crypto";
import AIInterview from "../models/AIInterview.js";
import AIInterviewSession from "../models/AIInterviewSession.js";
import Resume from "../models/Resume.js";
import { makePlan, mainQuestion, nextQuestion, resumeForInterview, InterviewRuntimeError } from "../services/aiInterviewRuntime.js";
import { transcribeAudio, speakQuestion } from "../services/interviewAudio.js";

const fail = (status, message) => { throw new InterviewRuntimeError(status, message); };
const id = (value) => {
  if (!mongoose.isValidObjectId(value)) fail(400, "Invalid interview identifier.");
  return value;
};
const visible = (session) => ({
  id: session._id,
  interviewId: session.interviewId,
  status: session.status,
  version: session.version,
  question: session.status === "active" ? session.currentQuestion : null,
  section: session.plan[session.index]?.section || null,
  topic: session.plan[session.index]?.topic || null,
  questionNumber: Math.min(session.index + 1, session.plan.length),
  totalQuestions: session.plan.length,
  followUpNumber: session.followUpIndex,
  pendingTranscript: session.pendingTranscript?.version === session.version
    && Date.now() - new Date(session.pendingTranscript.at).getTime() < 15 * 60 * 1000
    ? session.pendingTranscript.text : null,
  pendingTranscriptId: session.pendingTranscript?.version === session.version
    && Date.now() - new Date(session.pendingTranscript.at).getTime() < 15 * 60 * 1000
    ? session.pendingTranscript.id : null,
  turns: session.turns.map(({ question, answer, followUp }) => ({ question, answer, followUp })),
});

export async function listStudentInterviews(req, res) {
  const published = await AIInterview.find({ lifecycle: "draft", publishedSnapshot: { $exists: true } })
    .select("title role companyName publishedAt requiresResume")
    .sort({ publishedAt: -1 }).limit(100).lean();
  const sessions = await AIInterviewSession.find({ studentId: req.user._id })
    .select("interviewId status").sort({ updatedAt: -1 }).limit(100).lean();
  const publishedIds = new Set(published.map((doc) => String(doc._id)));
  const extraIds = sessions.map((session) => session.interviewId).filter((value) => !publishedIds.has(String(value)));
  const extra = extraIds.length ? await AIInterview.find({ _id: { $in: extraIds } })
    .select("title role companyName").lean() : [];
  const docs = [...published, ...extra];
  const byId = new Map(sessions.map((session) => [String(session.interviewId), session.status]));
  res.json(docs.map((doc) => ({
    id: doc._id, title: doc.title, role: doc.role, companyName: doc.companyName,
    requiresResume: Boolean(doc.requiresResume),
    status: byId.get(String(doc._id)) || "not_started",
  })));
}

export async function startStudentInterview(req, res) {
  const interviewId = id(req.params.id);
  const existing = await AIInterviewSession.findOne({ interviewId, studentId: req.user._id }).lean();
  if (existing) return res.json(visible(existing));
  const interview = await AIInterview.findOne({ _id: interviewId, lifecycle: "draft", publishedSnapshot: { $exists: true } }).lean();
  if (!interview) fail(404, "This interview is not available.");
  const data = interview.publishedSnapshot.data;
  const plan = makePlan(data, String(req.user._id));
  if (!plan.length) fail(422, "This interview has no questions.");
  const resume = plan.some((item) => item.kind === "resume")
    ? await Resume.findOne({ student: req.user._id }).lean()
    : null;
  const resumeContext = resumeForInterview(resume);
  const hasResumeDetails = resume && ["education", "experience", "projects", "skills", "achievements", "customSections"]
    .some((key) => Array.isArray(resume[key]) && resume[key].length > 0);
  if (plan.some((item) => item.kind === "resume") && !hasResumeDetails)
    fail(422, "Add content to your resume before starting this interview.");
  if (plan.some((item) => item.kind === "resume") && req.body?.resumeConsent !== true)
    fail(422, "Agree to use your saved resume for this interview before starting.");
  const first = await mainQuestion(plan[0], { resumeContext, turns: [] }, data.rules.language);
  try {
    const session = await AIInterviewSession.create({
      interviewId, studentId: req.user._id, publishedRevision: interview.publishedSnapshot.revision,
      plan, resumeContext, resumeConsentAt: hasResumeDetails ? new Date() : undefined,
      language: data.rules.language, currentQuestion: first,
    });
    res.status(201).json(visible(session.toObject()));
  } catch (error) {
    if (error.code !== 11000) throw error;
    const session = await AIInterviewSession.findOne({ interviewId, studentId: req.user._id }).lean();
    res.json(visible(session));
  }
}

export async function getStudentSession(req, res) {
  const session = await AIInterviewSession.findOne({ _id: id(req.params.id), studentId: req.user._id }).lean();
  if (!session) fail(404, "Interview session not found.");
  res.json(visible(session));
}

export async function getQuestionAudio(req, res) {
  const session = await AIInterviewSession.findOne({ _id: id(req.params.id), studentId: req.user._id }).lean();
  if (!session) fail(404, "Interview session not found.");
  if (session.status !== "active" || !session.currentQuestion) fail(409, "No active question to speak.");
  if (Number(req.get("X-Interview-Version")) !== session.version) fail(409, "This question changed. Reload the interview.");
  const { audio, contentType } = await speakQuestion(session.currentQuestion);
  res.set({ "Content-Type": contentType, "Content-Length": String(audio.length), "Cache-Control": "private, no-store" });
  res.send(audio);
}

export async function transcribeStudentAnswer(req, res) {
  const session = await AIInterviewSession.findOne({ _id: id(req.params.id), studentId: req.user._id }).lean();
  if (!session) fail(404, "Interview session not found.");
  if (session.status !== "active" || Number(req.get("X-Interview-Version")) !== session.version)
    fail(409, "This question changed. Reload the interview before recording.");
  const transcript = await transcribeAudio(req.body, req.get("Content-Type"));
  const transcriptId = crypto.randomUUID();
  const updated = await AIInterviewSession.findOneAndUpdate(
    { _id: session._id, studentId: req.user._id, version: session.version, status: "active" },
    { $set: { pendingTranscript: { id: transcriptId, text: transcript, version: session.version, at: new Date() } } },
    { new: true },
  ).lean();
  if (!updated) fail(409, "This question changed. Reload the interview.");
  res.json({ transcript, transcriptId });
}

export async function answerStudentQuestion(req, res) {
  if (req.body?.answer !== undefined) fail(422, "Record your answer with the microphone instead of typing it.");
  const session = await AIInterviewSession.findOne({ _id: id(req.params.id), studentId: req.user._id }).lean();
  if (!session) fail(404, "Interview session not found.");
  if (session.status !== "active") fail(409, "This interview is already complete.");
  if (req.body.version !== session.version) fail(409, "This question changed. Reload the interview before answering.");
  const pending = session.pendingTranscript;
  if (!pending || pending.version !== session.version
    || Date.now() - new Date(pending.at).getTime() >= 15 * 60 * 1000)
    fail(422, "Record and confirm your answer before continuing.");
  if (pending.id !== req.body.transcriptId) fail(409, "A newer recording replaced this one. Reload the interview.");
  const answer = pending.text;
  // The session's plan and language are immutable even when the admin edits the definition.
  const next = await nextQuestion(session, answer, session.language);
  const turn = {
    itemId: session.plan[session.index].id,
    question: session.currentQuestion,
    answer,
    followUp: session.followUpIndex > 0,
    at: new Date(),
  };
  const updated = await AIInterviewSession.findOneAndUpdate(
    { _id: session._id, studentId: req.user._id, version: session.version, status: "active" },
    { $set: next, $unset: { pendingTranscript: "" }, $push: { turns: turn }, $inc: { version: 1 } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) fail(409, "This answer was already submitted. Reload the interview.");
  res.json({ ...visible(updated), version: updated.version });
}
