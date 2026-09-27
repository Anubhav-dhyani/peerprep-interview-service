import jwt from "jsonwebtoken";

const audience = "peerprep-interview-runtime";
const issuer = "peerprep-api";

function secret() {
  const value = process.env.INTERVIEW_SERVICE_SECRET;
  if (!value || value.length < 32) throw new Error("INTERVIEW_SERVICE_SECRET must contain at least 32 characters.");
  return value;
}

export function requireInterviewServiceToken(req, res, next) {
  try {
    const authorization = req.get("authorization") || "";
    if (!authorization.startsWith("Bearer ")) return res.status(401).json({ error: "Service token required." });
    const claims = jwt.verify(authorization.slice(7), secret(), {
      algorithms: ["HS256"], audience, issuer,
    });
    if (claims.role !== "student" || !/^[a-f\d]{24}$/i.test(claims.sub))
      return res.status(401).json({ error: "Invalid service token." });
    req.user = { _id: claims.sub, role: "student" };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid service token." });
  }
}
