import { Request, Response } from "express";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import {
  runNewsletterAgent,
  resumeSession,
  getSessionState,
  sessions,
} from "../agent/graph.js";
import type { AgentMode } from "../agent/state.js";

// ─── SSE Client Registry ──────────────────────────────────────────────────────
// Maps sessionId → active SSE Response object
const sseClients = new Map<string, Response>();

function sendSSE(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─── POST /api/agent/run ──────────────────────────────────────────────────────

export async function runAgent(req: Request, res: Response): Promise<void> {
  const { goal, mode } = req.body as { goal?: string; mode?: string };

  if (!goal || typeof goal !== "string" || goal.trim().length < 10) {
    res.status(400).json({ success: false, error: "A goal of at least 10 characters is required." });
    return;
  }

  const agentMode: AgentMode =
    mode === "human" || mode === "autonomous" ? mode : "autonomous";

  const sessionId = uuidv4();

  res.status(202).json({ success: true, sessionId });

  // Fire-and-forget: agent runs asynchronously; progress streams via SSE
  setImmediate(() => {
    const emitter = new EventEmitter();

    // Wait for SSE client to subscribe (give it 3 seconds)
    const startAgent = (): void => {
      runNewsletterAgent(goal.trim(), agentMode, sessionId, emitter).catch(
        (err: Error) => {
          const sseRes = sseClients.get(sessionId);
          if (sseRes) {
            sendSSE(sseRes, "error", { message: err.message });
          }
        }
      );
    };

    // Pipe emitter events → SSE
    const forwardEvent = (event: string) =>
      emitter.on(event, (data: unknown) => {
        const sseRes = sseClients.get(sessionId);
        if (sseRes) sendSSE(sseRes, event, data);
      });

    forwardEvent("progress");
    forwardEvent("step_complete");
    forwardEvent("node_entered");
    forwardEvent("interrupt");
    forwardEvent("complete");
    forwardEvent("error");

    // Give frontend 2 seconds to open SSE connection before starting
    setTimeout(startAgent, 2000);
  });
}

// ─── GET /api/agent/events/:sessionId ────────────────────────────────────────

export function agentEvents(req: Request, res: Response): void {
  const { sessionId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  sseClients.set(sessionId, res);

  // Keep-alive ping every 25 seconds
  const ping = setInterval(() => {
    res.write(":ping\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(sessionId);
  });
}

// ─── POST /api/agent/approve/:sessionId ──────────────────────────────────────

export async function approveStage(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.params;

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found or already completed." });
    return;
  }

  try {
    // Resume asynchronously
    setImmediate(() => {
      resumeSession(sessionId, "approved").catch((err: Error) => {
        const sseRes = sseClients.get(sessionId);
        if (sseRes) sendSSE(sseRes, "error", { message: err.message });
      });
    });

    res.json({ success: true, message: "Stage approved. Agent resuming." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: message });
  }
}

// ─── POST /api/agent/reject/:sessionId ───────────────────────────────────────

export async function rejectStage(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.params;

  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found or already completed." });
    return;
  }

  try {
    setImmediate(() => {
      resumeSession(sessionId, "rejected").catch((err: Error) => {
        const sseRes = sseClients.get(sessionId);
        if (sseRes) sendSSE(sseRes, "error", { message: err.message });
      });
    });

    res.json({ success: true, message: "Stage rejected. Agent stopping." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: message });
  }
}

// ─── GET /api/agent/status/:sessionId ────────────────────────────────────────

export async function getStatus(req: Request, res: Response): Promise<void> {
  const { sessionId } = req.params;

  try {
    const state = await getSessionState(sessionId);

    if (!state) {
      res.status(404).json({ success: false, error: "Session not found." });
      return;
    }

    res.json({
      success: true,
      sessionId,
      status: state.status,
      revisionCount: state.revisionCount,
      errors: state.errors,
      interrupted: sessions.get(sessionId)?.interrupted ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ success: false, error: message });
  }
}
