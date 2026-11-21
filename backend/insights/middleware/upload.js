// Accepts up to 20 files (10 MB each) in memory — files are read, never stored on disk
import multer from "multer";
import { badRequest } from "../utils/httpError.js";

const ALLOWED = /\.(csv|txt|xls|xlsx)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.test(file.originalname)) cb(null, true);
    else cb(badRequest(`"${file.originalname}" is not supported — use CSV or Excel files`));
  },
});

export const uploadFiles = upload.array("files", 20);
