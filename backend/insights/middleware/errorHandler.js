// Turns every error into a clean JSON reply
import multer from "multer";

export function notFoundRoute(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let message = err.message || "Something went wrong";

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)" : message;
  } else if (err.name === "ValidationError" || err.name === "CastError") {
    status = 400;
  } else if (err.code === 11000) {
    status = 409;
    message = "This entry already exists";
  }

  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
}
