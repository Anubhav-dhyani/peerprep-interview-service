import mongoose from "mongoose";

// Read-only view of PeerPrep's resume collection. Identity/contact fields are
// never passed to the question generator; the controller filters the content.
const schema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, index: true },
  education: [mongoose.Schema.Types.Mixed],
  experience: [mongoose.Schema.Types.Mixed],
  projects: [mongoose.Schema.Types.Mixed],
  skills: [mongoose.Schema.Types.Mixed],
  achievements: [mongoose.Schema.Types.Mixed],
  customSections: [mongoose.Schema.Types.Mixed],
}, { strict: false, collection: "resumes" });

export default mongoose.model("Resume", schema);
