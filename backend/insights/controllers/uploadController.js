// HTTP layer for file uploads
import * as uploads from "../services/uploadService.js";

// multipart form: files[] + account + platform + week (start) + end
export async function preview(req, res) {
  const { account, platform, week, end } = req.body || {};
  const result = await uploads.previewUpload({ files: req.files, account, platform, week, end });
  res.json(result);
}

export async function history(req, res) {
  res.json({ uploads: await uploads.recentUploads(req.query.limit) });
}
