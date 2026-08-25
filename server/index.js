require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });
require("dotenv").config(); // also allow standard .env / platform env vars

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { createChatSession, sendMessage } = require("./lib/agent");
const { getBoardRegistry } = require("./lib/boardRegistry");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// In-memory session store: sessionId -> Anthropic message history.
// Fine for a single-instance prototype deployment; not meant to survive
// restarts or scale horizontally (documented as a trade-off in README).
const sessions = new Map();

app.post("/api/session", (req, res) => {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, createChatSession());
  res.json({ sessionId });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(400).json({ error: "Invalid or missing sessionId. Call /api/session first." });
    }
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    const chatSession = sessions.get(sessionId);
    const reply = await sendMessage(chatSession, message);

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({
      error:
        "Something went wrong talking to monday.com or the AI model. " +
        (err.message || "Unknown error"),
    });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    const registry = await getBoardRegistry();
    res.json({ ok: true, boards: { deals: registry.deals, workOrders: registry.workOrders } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skylark BI Agent server running on port ${PORT}`);
});
