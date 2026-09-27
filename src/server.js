import "dotenv/config";
import { connectDb, closeDb } from "./db.js";
import { createApp } from "./app.js";

if (!process.env.INTERVIEW_SERVICE_SECRET || process.env.INTERVIEW_SERVICE_SECRET.length < 32)
  throw new Error("INTERVIEW_SERVICE_SECRET must contain at least 32 characters.");
if (!process.env.MONGODB_URI || process.env.MONGODB_URI === "memory")
  throw new Error("The interview service requires the same persistent MONGODB_URI as the main API.");
if (!process.env.OPENAI_API_KEY)
  throw new Error("OPENAI_API_KEY must be configured on the interview service.");

await connectDb();
const server = createApp().listen(Number(process.env.PORT || 4100), () => {
  console.log(`Interview service listening on ${server.address().port}`);
});

async function shutdown() {
  server.close(async () => { await closeDb(); process.exit(0); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
