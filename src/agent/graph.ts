import { StateGraph, START, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";
import { EventEmitter } from "events";
import {
  NewsletterStateAnnotation,
  type AgentMode,
  type NewsletterState,
} from "./state.js";
import {
  plannerNode,
  researcherNode,
  summarizerNode,
  humanApproval1Node,
  writerNode,
  reviewerNode,
  reviserNode,
  humanApproval2Node,
  outputNode,
  routeAfterSummarizer,
  routeAfterApproval1,
  routeAfterReviewer,
  routeAfterApproval2,
} from "./nodes.js";

// ─── Build the LangGraph ──────────────────────────────────────────────────────

function buildGraph() {
  const checkpointer = new MemorySaver();

  const graph = new StateGraph(NewsletterStateAnnotation)
    // ── Nodes ──────────────────────────────────────────────────────────────
    .addNode("planner", plannerNode)
    .addNode("researcher", researcherNode)
    .addNode("summarizer", summarizerNode)
    .addNode("humanApproval1", humanApproval1Node)
    .addNode("writer", writerNode)
    .addNode("reviewer", reviewerNode)
    .addNode("reviser", reviserNode)
    .addNode("humanApproval2", humanApproval2Node)
    .addNode("output", outputNode)

    // ── Edges ──────────────────────────────────────────────────────────────
    .addEdge(START, "planner")
    .addEdge("planner", "researcher")
    .addEdge("researcher", "summarizer")

    // After summarizer: skip humanApproval1 in autonomous mode
    .addConditionalEdges("summarizer", routeAfterSummarizer, {
      humanApproval1: "humanApproval1",
      writer: "writer",
    })

    // After humanApproval1: either abort or continue to writer
    .addConditionalEdges("humanApproval1", routeAfterApproval1, {
      writer: "writer",
      __end__: END,
    })

    .addEdge("writer", "reviewer")

    // After reviewer: revise, human-approve, or go to output
    .addConditionalEdges("reviewer", routeAfterReviewer, {
      reviser: "reviser",
      humanApproval2: "humanApproval2",
      output: "output",
    })

    // Revision loops back to reviewer
    .addEdge("reviser", "reviewer")

    // After humanApproval2: either abort or generate output
    .addConditionalEdges("humanApproval2", routeAfterApproval2, {
      output: "output",
      __end__: END,
    })

    .addEdge("output", END)

    .compile({ checkpointer });

  return graph;
}

// Singleton graph instance (shared across all sessions)
const graph = buildGraph();

// ─── Session Management ───────────────────────────────────────────────────────

export interface Session {
  emitter: EventEmitter;
  config: { configurable: { thread_id: string; emitter: EventEmitter } };
  interrupted: boolean;
}

export const sessions = new Map<string, Session>();

// ─── Progress Event → SSE payload mapping ─────────────────────────────────────

function emitNodeProgress(nodeName: string, _update: unknown, emitter: EventEmitter): void {
  const nodeLabels: Record<string, string> = {
    planner: "planning",
    researcher: "researching",
    summarizer: "summarizing",
    humanApproval1: "awaiting_approval_1",
    writer: "writing",
    reviewer: "reviewing",
    reviser: "revising",
    humanApproval2: "awaiting_approval_2",
    output: "saving",
  };
  const step = nodeLabels[nodeName];
  if (step) {
    emitter.emit("node_entered", { step, nodeName });
  }
}

// ─── Stream Runner ────────────────────────────────────────────────────────────

async function runStream(
  input: NewsletterState | Command,
  config: Session["config"],
  emitter: EventEmitter
): Promise<{ interrupted: boolean; interruptData?: unknown }> {
  let interruptDetected = false;
  let interruptData: unknown;

  for await (const chunk of await graph.stream(input, {
    ...config,
    streamMode: "updates",
  })) {
    // Detect interrupt
    if ("__interrupt__" in chunk) {
      interruptDetected = true;
      interruptData = (chunk as Record<string, unknown[]>)["__interrupt__"]?.[0];
    } else {
      // Normal node update
      const entries = Object.entries(chunk as Record<string, unknown>);
      for (const [nodeName, update] of entries) {
        emitNodeProgress(nodeName, update, emitter);
      }
    }
  }

  return { interrupted: interruptDetected, interruptData };
}

// ─── Main Public API ──────────────────────────────────────────────────────────

/**
 * Start (or resume) a newsletter generation workflow.
 *
 * @param goal  Plain-English newsletter goal.
 * @param mode  "autonomous" | "human"
 * @param sessionId  Unique session identifier (used as LangGraph thread_id).
 * @param emitter  EventEmitter used to push progress events to the SSE layer.
 */
export async function runNewsletterAgent(
  goal: string,
  mode: AgentMode,
  sessionId: string,
  emitter: EventEmitter
): Promise<void> {
  const config = {
    configurable: {
      thread_id: sessionId,
      emitter,
    },
  };

  sessions.set(sessionId, { emitter, config, interrupted: false });

  const initialState: Partial<NewsletterState> = {
    goal,
    mode,
    sessionId,
    plan: null,
    searchQueries: [],
    searchResults: [],
    selectedArticles: [],
    summaries: [],
    newsletter: null,
    review: null,
    revisionCount: 0,
    status: "planning",
    errors: [],
    outputFiles: [],
  };

  emitter.emit("progress", { step: "planning", message: "Starting Newsletter Agent..." });

  const { interrupted, interruptData } = await runStream(
    initialState as NewsletterState,
    config,
    emitter
  );

  if (interrupted) {
    sessions.set(sessionId, { emitter, config, interrupted: true });
    // LangGraph wraps interrupt payload in { value: <payload>, resumable: true }
    const payload = (interruptData as { value?: object })?.value ?? interruptData;
    emitter.emit("interrupt", { sessionId, ...(payload as object) });
    return;
  }

  // Workflow completed without interrupt
  const finalState = await graph.getState(config);
  const state = finalState.values as NewsletterState;

  sessions.delete(sessionId);

  if (state.status === "completed") {
    emitter.emit("complete", {
      newsletter: state.newsletter,
      review: state.review,
      outputFiles: state.outputFiles,
      status: "completed",
    });
  } else {
    emitter.emit("error", {
      message: state.errors.join("; ") || "Agent failed with unknown error",
      status: state.status,
    });
  }
}

/**
 * Resume a paused (human-in-the-loop) session.
 *
 * @param sessionId  Session to resume.
 * @param decision   "approved" | "rejected"
 */
export async function resumeSession(
  sessionId: string,
  decision: "approved" | "rejected"
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const { emitter, config } = session;
  session.interrupted = false;

  emitter.emit("progress", {
    step: "resumed",
    message: `User ${decision === "approved" ? "approved" : "rejected"} this stage.`,
  });

  const { interrupted, interruptData } = await runStream(
    new Command({ resume: decision }),
    config,
    emitter
  );

  if (interrupted) {
    sessions.set(sessionId, { ...session, interrupted: true });
    const payload = (interruptData as { value?: object })?.value ?? interruptData;
    emitter.emit("interrupt", { sessionId, ...(payload as object) });
    return;
  }

  // Workflow completed
  const finalState = await graph.getState(config);
  const state = finalState.values as NewsletterState;
  sessions.delete(sessionId);

  if (state.status === "completed") {
    emitter.emit("complete", {
      newsletter: state.newsletter,
      review: state.review,
      outputFiles: state.outputFiles,
      status: "completed",
    });
  } else if (state.status === "rejected") {
    emitter.emit("complete", {
      newsletter: null,
      review: null,
      outputFiles: [],
      status: "rejected",
    });
  } else {
    emitter.emit("error", {
      message: state.errors.join("; ") || "Agent failed with unknown error",
      status: state.status,
    });
  }
}

/**
 * Get the current state of a session.
 */
export async function getSessionState(sessionId: string): Promise<NewsletterState | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const state = await graph.getState(session.config);
  return state.values as NewsletterState;
}
