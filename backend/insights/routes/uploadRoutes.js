import { Router } from "express";
import * as c from "../controllers/uploadController.js";
import { uploadFiles } from "../middleware/upload.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/preview", uploadFiles, asyncHandler(c.preview)); // read files, return numbers (nothing saved yet)
router.get("/history", asyncHandler(c.history));

export default router;
