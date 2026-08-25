# Skylark BI Agent

A conversational AI agent that answers founder-level business intelligence questions
by querying live monday.com boards (Deals + Work Orders), handling messy real-world
data gracefully.

**Live demo:** https://skylark-bi-agent-tdcq.onrender.com
**Decision Log:** see `DECISION_LOG.md`

---

## Architecture

```
Browser (chat UI)
      │  POST /api/chat
      ▼
Express server (server/index.js)
      │
      ▼
Agent loop (server/lib/agent.js)
  - Sends conversation to Gemini (function-calling)
  - Gemini decides which tool(s) to call
      │
      ▼
Data layer (server/lib/dataService.js)
  - Caches per-board data for 2 minutes
      │
      ▼
monday.com GraphQL client (server/lib/mondayClient.js)
  - Auto-discovers board IDs by name (never hardcoded)
  - Paginates through all items on a board
      │
      ▼
Normalization layer (server/lib/normalize.js)
  - Cleans dates, numbers, category text
  - Flags missing/invalid values per record
  - Produces a data-quality report alongside the cleaned data
```

The agent never sees raw monday.com data directly — everything passes through the
normalization layer first, and every tool result includes a `qualityReport` so the
LLM can (and is instructed to) caveat its answers when the underlying data is
incomplete, rather than presenting figures as more solid than they are.

### Why Gemini instead of Claude/OpenAI
Built to run entirely on free-tier API access (see Decision Log for full reasoning).
Calls Gemini's REST API directly (no SDK dependency) for full control over request
shape, since the SDK ecosystem for Gemini changed multiple times during development.

### Board join logic
The two boards are linked via a shared field: `Deal name masked` on the Work Orders
board corresponds to the `Lead` field on the Deals board. The agent uses this to
answer cross-board questions (e.g. "which won deals have no work order started").

---

## Setup

### 1. monday.com
1. Create a free monday.com account.
2. Import the provided Excel files as two separate boards. Board names must contain
   the words "Deal" and "Work Order" respectively (case-insensitive) — the app
   auto-discovers board IDs by matching board names, so exact renaming isn't
   required as long as those keywords are present. (Or set
   `MONDAY_DEALS_BOARD_ID` / `MONDAY_WORK_ORDERS_BOARD_ID` env vars to skip
   auto-discovery entirely.)
3. Get a Personal API Token: Avatar → Admin/Developers → API.

### 2. Gemini API key
Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in,
create a key. Free tier, no card required.

### 3. Local run
```bash
npm install
cp .env.example .env.local   # fill in MONDAY_API_TOKEN and GEMINI_API_KEY
npm start
```
Visit `http://localhost:3000`.

### 4. Deployment
Any Node host works (Render, Railway, Fly.io, etc.). Set `MONDAY_API_TOKEN` and
`GEMINI_API_KEY` as environment variables in the platform's dashboard — do not
commit them. Build command: `npm install`. Start command: `npm start`.

---

## Project structure

```
server/
  index.js              Express server, session management, chat API
  lib/
    mondayClient.js      Raw GraphQL calls to monday.com (list boards, get columns, paginate items)
    boardRegistry.js     Auto-discovers Deals/Work Orders board IDs by name
    normalize.js          Data cleaning: dates, numbers, categories; quality-flags issues
    dataService.js        Ties the above together with a short-lived cache
    agent.js               Gemini REST calls + tool-use loop + system prompt
public/
  index.html             Single-page chat UI (no build step, vanilla JS)
```

## Known limitations (see Decision Log for more)
- In-memory session store — conversation history is lost on server restart, and
  doesn't scale across multiple server instances.
- Sector/category matching is case/whitespace normalized but not semantically
  mapped (e.g. it won't automatically know "Energy" means "Renewables + Powerline"
  — it asks the user to clarify instead, by design).
- No authentication on the chat endpoint — fine for a prototype, not for production.
