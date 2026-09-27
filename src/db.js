import mongoose from "mongoose";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri === "memory") throw new Error("Set a persistent MONGODB_URI shared with PeerPrep.");
  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== "production",
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20,
  });
}

export async function closeDb() {
  await mongoose.disconnect();
}
