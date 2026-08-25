# Decision Log — Skylark BI Agent

## Key Assumptions
- **Board linkage**: The Work Orders board's `Deal name masked` field and the Deals
  board's `Lead` field share the same masked identifier space (e.g. "Sakura",
  "Scooby-Doo"). I assumed this is the intended join key between the two boards,
  since there's no explicit foreign-key column. Confirmed by inspecting real data —
  values overlap consistently between both boards.
- **"This quarter" / fiscal calendar**: No fiscal year definition exists anywhere in
  the data. Rather than assume a calendar-quarter default, the agent asks the user
  to clarify when a question hinges on this (per the assignment's own guidance to
  document assumptions and proceed, I chose to make this one *interactive* rather
  than silent, since guessing wrong here would materially mislead a founder).
- **"Won" deals**: Treated any deal in a stage containing "Won" (e.g. "Project Won",
  "Work Order Received") as revenue-relevant. The Deal Stage field uses inconsistent
  free-text labels rather than a fixed enum, so this is a best-effort text match, not
  a guaranteed-complete filter.
- **Revenue definitions**: The data supports multiple valid readings of "revenue"
  (booked pipeline value vs. contracted work-order value vs. actually billed vs.
  cash collected). Rather than pick one silently, the agent surfaces all four with
  labels — this seemed safer than presenting one number as *the* answer to a
  genuinely ambiguous founder question.

## Trade-offs Chosen and Why
- **Pass full normalized datasets to the LLM rather than building a query/filter
  DSL.** Given the ~5 hour window and a dataset of a few hundred records per board,
  letting Gemini reason directly over the cleaned data (with quality flags attached)
  was faster to build and more robust to novel question phrasing than hand-writing
  an intent classifier + structured query layer. Trade-off: this won't scale to
  boards with tens of thousands of items without adding real filtering/pagination
  at the tool level — documented as a "with more time" item below.
- **monday.com via raw GraphQL, not MCP.** MCP is the more "correct" architectural
  choice long-term, but adds setup/auth overhead that wasn't worth the time cost
  for a single-developer, single-environment prototype. Documented explicitly here
  since the assignment allowed either.
- **Gemini instead of a paid LLM API.** Built and tested against Claude's API
  first, but the API key created for this had zero funded credits and no way to
  add funds without payment; the assignment explicitly permits "any AI tools."
  Google's Gemini API offers usable free-tier quota (15 req/min, 1,500/day) with
  solid function-calling support, so I swapped the agent layer to it mid-build.
  Trade-off: Gemini's API surface changed meaningfully during development (model
  names deprecating, SDK role-handling changing) — I ended up calling the REST
  endpoint directly rather than depending on the npm SDK, for stability.
- **In-memory sessions, no database.** A prototype doesn't need persistence across
  restarts; this kept the stack to one deployable service with zero infrastructure
  setup. Not appropriate beyond a demo.
- **2-minute in-memory cache on board data.** Balances "always live, never
  hardcoded" (the assignment's explicit requirement) against not re-fetching the
  full board on every single message in a conversation.

## How I Interpreted "Leadership Updates"
I implemented this as a detected conversational intent ("give me a leadership
update" / "weekly update" / etc.) that triggers a structured 5-section brief:
Pipeline Snapshot, Sectoral Performance, Execution Health, Data Caveats, and Flags
for Leadership — designed to be skimmable and directly pasteable into a Slack
update or leadership doc, rather than a wall of prose. I treated this as the
agent's signature proactive feature rather than a bolt-on: it deliberately
foregrounds *data caveats* and *named, specific risks* (e.g. a specific stalled
work order by ID and value) rather than only aggregate numbers, since that's what
makes a leadership update actually actionable versus a dashboard export.

## What I'd Do Differently With More Time
- **Real filtering at the tool layer.** Right now tools return the *entire*
  normalized board; a `query_deals(filters)`-style tool with server-side filtering
  would scale better and reduce token usage/cost as data volume grows.
- **Semantic sector mapping.** The agent currently asks for clarification when a
  term like "energy" doesn't map cleanly to a sector label. A curated synonym map
  (or a lightweight embedding-based match with the clarifying question as a
  fallback, not the default) would reduce unnecessary back-and-forth for common
  cases while still asking when genuinely ambiguous.
- **Persistent storage** (even SQLite) for sessions, so conversations survive a
  restart, plus basic auth so the hosted link isn't fully open.
- **Automated tests** around the normalization layer specifically — that's the
  highest-risk-of-silent-bug code, since a normalization mistake could produce a
  confidently wrong number rather than a visible crash.
- **Parallelize monday.com fetches** — Deals and Work Orders are currently fetched
  sequentially when both are needed (e.g. leadership update); fetching them
  concurrently would materially cut response latency.
- **MCP integration** as an alternative connection path, to compare against the
  direct-API approach for a real production recommendation.

## AI Tools Used
Built collaboratively with Claude (Anthropic) for architecture, code, and this
documentation, including live debugging of the monday.com and Gemini API
integrations. All code was reviewed and tested by me against the real board data
before inclusion.
