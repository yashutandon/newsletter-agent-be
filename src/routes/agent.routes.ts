import { Router } from "express";
import {
  runAgent,
  agentEvents,
  approveStage,
  rejectStage,
  getStatus,
} from "../controllers/agent.controller.js";

const router = Router();

/** Start a new newsletter generation session. Returns sessionId immediately. */
router.post("/run", runAgent);

/** SSE stream for real-time progress events. */
router.get("/events/:sessionId", agentEvents);

/** Approve the current human-in-the-loop checkpoint. */
router.post("/approve/:sessionId", approveStage);

/** Reject the current human-in-the-loop checkpoint. */
router.post("/reject/:sessionId", rejectStage);

/** Poll current session status (optional, SSE is preferred). */
router.get("/status/:sessionId", getStatus);

export default router;
