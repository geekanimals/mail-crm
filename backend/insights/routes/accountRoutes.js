import { Router } from "express";
import * as c from "../controllers/accountController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", asyncHandler(c.list));
router.post("/", asyncHandler(c.create)); // { name }
router.patch("/:id", asyncHandler(c.rename)); // { name }
router.delete("/:id", asyncHandler(c.remove));

export default router;
