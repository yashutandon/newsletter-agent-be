# Newsletter Agent — Backend

> Express.js + LangGraph powered agentic backend for autonomous newsletter generation.

## Tech Stack

| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^4.21 | HTTP server & REST API |
| `@langchain/langgraph` | ^0.2 | Agentic workflow orchestration |
| `@langchain/core` | ^0.3 | LangChain primitives |
| `groq-sdk` | ^0.9 | Groq LLM API client |
| `@tavily/core` | ^0.0.2 | Web search API client |
| `zod` | ^3.24 | Runtime schema validation |
| `cors` | ^2.8 | Cross-origin resource sharing |
| `dotenv` | ^16.4 | Environment variable loading |
| `uuid` | ^11 | Session ID generation |
| `tsx` | ^4.23 | TypeScript execution (dev) |
| `typescript` | ^5.7 | Static typing |

---

## Directory Structure

```
backend/
├── src/
│   ├── agent/
│   │   ├── graph.ts       # LangGraph StateGraph definition & compilation
│   │   ├── nodes.ts       # All 9 node implementations (planner, writer, etc.)
│   │   ├── prompts.ts     # LLM system + user prompt templates
│   │   ├── state.ts       # NewsletterState annotation (shared agent memory)
│   │   ├── tools.ts       # Tavily web search LangChain tool
│   │   └── formatter.ts   # HTML / Markdown / TXT output formatter
│   │
│   ├── controllers/
│   │   └── agent.controller.ts   # SSE streaming, session management
│   │
│   ├── routes/
│   │   └── agent.routes.ts       # Route definitions
│   │
│   ├── schemas/
│   │   └── newsletter.ts         # Zod schemas for all LLM responses
│   │
│   ├── services/
│   │   ├── groq.ts               # Groq LLM client + structured output helper
│   │   └── tavily.ts             # Tavily search client wrapper
│   │
│   ├── app.ts                    # Express app (middleware, routes, error handler)
│   └── server.ts                 # HTTP server entry point
│
├── output/                       # Generated newsletter files (gitignored)
├── .env                          # Local secrets (not committed)
├── .env.example                  # Template
├── tsconfig.json
└── package.json
```

---

## Agent Workflow

```
START
  │
  ▼
planner          ← Reads goal, creates search queries & criteria
  │
  ▼
researcher       ← Runs parallel Tavily searches, deduplicates articles
  │
  ▼
summarizer       ← Selects top 5–7 articles, adds summaries & "why it matters"
  │
  ├─(human-loop)─▶ humanApproval1  ← Waits for user approve/reject via HTTP
  │
  ▼
writer           ← Writes subject, title, intro, article blurbs, conclusion
  │
  ▼
reviewer         ← Scores newsletter (relevance / factuality / readability 1–10)
  │
  ├─(needs revision)─▶ reviser     ← Rewrites based on reviewer feedback
  │                        │
  │                        └──────▶ reviewer  (loop until score ok or MAX_REVISIONS)
  │
  ├─(human-loop)─▶ humanApproval2  ← Final human review
  │
  ▼
output           ← Saves .html, .md, .txt to /output folder
  │
  ▼
END
```

### Node Details

| Node | Input | Output |
|------|-------|--------|
| `planner` | goal | queries[], criteria[], topic, timeframe |
| `researcher` | queries[] | articles[] (raw) |
| `summarizer` | articles[] | selectedArticles[] with summaries |
| `humanApproval1` | selectedArticles | (waits for HTTP signal) |
| `writer` | selectedArticles | subject, title, introduction, conclusion |
| `reviewer` | newsletter | score, issues[], suggestions[], needsRevision |
| `reviser` | newsletter + review | revised newsletter |
| `humanApproval2` | final newsletter | (waits for HTTP signal) |
| `output` | complete newsletter | HTML, Markdown, TXT files |

---

## REST API

### `POST /api/agent/start`
Start a new agent session.

**Request Body:**
```json
{
  "goal": "Weekly AI newsletter for developers",
  "mode": "autonomous"
}
```

**mode values:** `"autonomous"` | `"human-in-loop"`

**Response:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `GET /api/agent/:sessionId/events`
**Server-Sent Events** — subscribe to live agent progress.

**Headers:** `Accept: text/event-stream`

**Event Types:**

| Event | Payload | Description |
|-------|---------|-------------|
| `progress` | `{ step, message }` | Current step progress message |
| `step_complete` | `{ step }` | A workflow step finished |
| `node_entered` | `{ step, nodeName }` | LangGraph node started |
| `interrupt` | `{ stage, data }` | Agent paused for human review |
| `complete` | `{ newsletter, review, outputFiles }` | Agent finished |
| `error` | `{ message }` | Agent encountered an error |

**Example SSE stream:**
```
data: {"type":"progress","step":"planning","message":"Creating research plan..."}

data: {"type":"step_complete","step":"planning"}

data: {"type":"interrupt","stage":"approval_1","data":{...}}

data: {"type":"complete","newsletter":{...},"review":{...},"outputFiles":["newsletter.html"]}
```

---

### `POST /api/agent/:sessionId/approve`
Approve a human-in-loop interrupt and resume the agent.

**Response:** `{ "success": true }`

---

### `POST /api/agent/:sessionId/reject`
Reject a human-in-loop interrupt and stop the agent.

**Response:** `{ "success": true }`

---

### `GET /health`
Health check endpoint.

**Response:** `{ "status": "ok", "timestamp": "2026-09-09T00:00:00.000Z" }`

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` |  | — | Groq API key from [console.groq.com](https://console.groq.com/keys) |
| `GROQ_MODEL` |  | `openai/gpt-oss-120b` | Model ID — check [docs/models](https://console.groq.com/docs/models) for active models |
| `TAVILY_API_KEY` |  | — | Tavily API key from [tavily.com](https://tavily.com) |
| `PORT` |  | `5000` | HTTP server port |
| `FRONTEND_URL` |  | `http://localhost:3000` | CORS allowed origin |
| `MAX_REVISIONS` |  | `2` | Max reviewer→reviser cycles |

---

## Scripts

```bash
npm run dev        # Start with tsx watch (hot reload)
npm run build      # Compile TypeScript to dist/
npm run start      # Run compiled production build
npm run typecheck  # Type check without emitting
```

---

## Key Design Decisions

- **LangGraph StateGraph** — all agent state is stored in `NewsletterState`, passed through every node. No global variables.
- **SSE over WebSockets** — simpler, works with plain `fetch()`, and perfectly suited for one-way server→client streaming.
- **Zod validation on all LLM responses** — every LLM JSON output is validated against a schema. If validation fails, a descriptive error is thrown rather than silently corrupting state.
- **MemorySaver checkpointer** — LangGraph persists state per `thread_id` (sessionId), enabling human-in-loop interrupts and safe resume.
- **Session Map** — in-memory `Map<sessionId, EventEmitter>` handles SSE connections. For production, replace with Redis pub/sub.
