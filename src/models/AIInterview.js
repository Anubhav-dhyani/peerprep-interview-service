import mongoose from "mongoose";

// Read-only view of the collection owned by PeerPrep's authoring backend.
const schema = new mongoose.Schema({
  lifecycle: { type: String, default: "draft" },
  title: String,
  role: String,
  companyName: String,
  publishedAt: Date,
  publishedSnapshot: mongoose.Schema.Types.Mixed,
  requiresResume: Boolean,
}, { strict: false, collection: "aiinterviews" });

export default mongoose.model("AIInterview", schema);
