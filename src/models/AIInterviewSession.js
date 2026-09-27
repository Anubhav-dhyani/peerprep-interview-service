import mongoose from "mongoose";

const schema = new mongoose.Schema({
  interviewId: { type: mongoose.Schema.Types.ObjectId, ref: "AIInterview", required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  publishedRevision: { type: Number, required: true },
  plan: { type: [mongoose.Schema.Types.Mixed], required: true },
  resumeContext: { type: String, default: "" },
  resumeConsentAt: Date,
  language: { type: String, default: "English" },
  turns: { type: [mongoose.Schema.Types.Mixed], default: [] },
  pendingTranscript: { type: mongoose.Schema.Types.Mixed, default: undefined },
  index: { type: Number, default: 0 },
  followUpIndex: { type: Number, default: 0 },
  currentQuestion: { type: String, default: "" },
  status: { type: String, enum: ["active", "completed"], default: "active" },
  version: { type: Number, default: 1 },
  completedAt: Date,
}, { timestamps: true, minimize: false });

schema.index({ interviewId: 1, studentId: 1 }, { unique: true });
schema.index({ studentId: 1, updatedAt: -1 });
export default mongoose.model("AIInterviewSession", schema);
