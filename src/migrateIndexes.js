import "dotenv/config";
import mongoose from "mongoose";
import AIInterviewSession from "./models/AIInterviewSession.js";

if (!process.env.MONGODB_URI || process.env.MONGODB_URI === "memory")
  throw new Error("Set MONGODB_URI to the intended persistent database.");
try {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  await AIInterviewSession.createIndexes();
  console.log("AI interview session indexes created.");
} finally {
  await mongoose.disconnect();
}
