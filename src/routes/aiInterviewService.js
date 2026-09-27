import { Router, raw } from "express";
import { requireInterviewServiceToken } from "../services/interviewServiceAuth.js";
import { listStudentInterviews, startStudentInterview, getStudentSession, getQuestionAudio, transcribeStudentAnswer, answerStudentQuestion } from "../controllers/aiInterviewStudentController.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.use(requireInterviewServiceToken);
router.get("/", wrap(listStudentInterviews));
router.post("/:id/start", wrap(startStudentInterview));
router.get("/sessions/:id", wrap(getStudentSession));
router.get("/sessions/:id/question-audio", wrap(getQuestionAudio));
router.post("/sessions/:id/transcribe", raw({ type: ["audio/webm", "audio/mp4", "audio/wav", "audio/mpeg"], limit: "8mb" }), wrap(transcribeStudentAnswer));
router.post("/sessions/:id/answer", wrap(answerStudentQuestion));
export default router;
