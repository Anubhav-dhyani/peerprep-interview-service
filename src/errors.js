export function notFound(_req, res) {
  res.status(404).json({ error: "Not Found" });
}

export function errorHandler(error, _req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status : 500;
  if (status >= 500) console.error("Interview service error:", error);
  res.status(status).json({ error: status === 500 ? "Internal server error" : error.message });
}
