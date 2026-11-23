import { Router } from "express";
import * as c from "../controllers/entryController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(c.list)); // ?account=&platform=&from=&to=
router.get("/export.csv", asyncHandler(c.exportCSV));
router.post("/", asyncHandler(c.save)); // add or replace one entry
router.post("/bulk", asyncHandler(c.saveBulk)); // { rows: [...] }
router.post("/delete", asyncHandler(c.removeMany)); // { ids: [...] } — many at once
router.delete("/:id", asyncHandler(c.remove));

export default router;
