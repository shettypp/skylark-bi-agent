// Talking to Gemini's REST API directly rather than through the npm SDK.
// The Gemini API has moved fast (model names and internal role handling
// changed multiple times in 2026), and hitting the REST endpoint
// directly gives us full control over the exact request shape rather
// than depending on an SDK that may lag behind API changes.
const { getDealsData, getWorkOrdersData, getSchema } = require("./dataService");

// Free-tier Gemini model with solid tool-use support. Testing revealed
// "gemini-2.5-flash-lite" and "gemini-2.5-flash" 404 on this account's API
// surface (Google's own error pointed us back to 3.6-flash) - so despite
// its low 20 requests/day quota, 3.6-flash is the confirmed-working
// primary. The untested models stay in the fallback list cheaply, in case
// a different account/key (see GEMINI_API_KEY_2 etc.) has access to them.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FALLBACK_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.0-flash"];

function geminiUrlFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Supports multiple API keys (e.g. from separate Google accounts) as a
// fallback chain, since free-tier quota is scoped per-account. Set
// GEMINI_API_KEY as the primary, and optionally GEMINI_API_KEY_2,
// GEMINI_API_KEY_3, etc. as backups - tried in order if one runs out.
function getApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  let i = 2;
  while (process.env[`GEMINI_API_KEY_${i}`]) {
    keys.push(process.env[`GEMINI_API_KEY_${i}`]);
    i++;
  }
  console.log(`[gemini] ${keys.length} API key(s) detected at startup`);
  return keys;
}

const SYSTEM_PROMPT = `You are a founder-facing Business Intelligence agent for Skylark Drones,
a company doing drone-based data services (Spectra, DMO, DronePass etc.) for enterprise
customers across sectors like Mining, Powerline, Railways, Renewables, DSP, and Tender work.

You answer executive/founder-level questions by querying two live monday.com boards:
1. "Deals" - sales pipeline (deal stage, sector, value, close dates, probability)
2. "Work Orders" - project execution (execution status, delivery dates, customer, nature of work)

The two boards can be joined: on the Work Orders board, the "Deal name masked" field
corresponds to the "Lead" / deal-name field on the Deals board. Use this to answer
questions that span sales-to-execution (e.g. "which won deals haven't started execution yet").

CRITICAL rules about data quality:
- This is real, messy business data. Expect missing values, inconsistent casing/spacing in
  category fields (sector, status, stage), unparseable dates/numbers, and incomplete records.
- Tool results include a "qualityReport" showing how many records had issues and in which
  fields. ALWAYS factor this into your answer - if a meaningful chunk of relevant data was
  missing or unparseable, say so explicitly and explain how it affects your confidence in the
  numbers, rather than presenting figures as if they're complete.
- Never silently drop or ignore records with issues without mentioning it. Never invent or
  assume values that aren't in the data.
- When a category value has near-duplicate variants (e.g. "Mining" vs "mining" vs "Mining "),
  treat them as the same category in your analysis, but you don't need to narrate this unless
  it materially changed a result.

CRITICAL rules about query understanding:
- Founders ask vague, colloquial questions ("how's pipeline looking", "are we doing OK in
  energy this quarter"). Interpret reasonably using business context, but if a question is
  genuinely ambiguous in a way that would change the answer (e.g. "this quarter" when no
  fiscal year is defined anywhere in the data, or "energy" when the data uses different sector
  labels like "Powerline"/"Renewables" that could plausibly map to "energy"), ask ONE targeted
  clarifying question instead of guessing silently. Don't over-ask - only clarify when it
  genuinely changes the answer.
- Always ground numeric claims in the actual data you fetched via tools. Never fabricate
  figures.

CRITICAL rules about being useful, not just accurate:
- Don't just dump numbers. Give context: is this good or bad relative to other segments in the
  data? What's the composition (e.g. how many deals, at what stage)? What would you flag to a
  founder if you were their analyst?
- Keep answers tight and scannable - founders are busy. Use short paragraphs or bullet points,
  not walls of text.

LEADERSHIP UPDATE MODE:
If the user asks for a "leadership update", "weekly update", "leadership summary", "board
update" or similar, produce a structured brief with these sections:
1. **Pipeline Snapshot** - total open deal value, deal count by stage, notable movement
2. **Sectoral Performance** - which sectors are strongest/weakest in the pipeline
3. **Execution Health** - work order status breakdown, anything stalled or overdue
4. **Data Caveats** - what's missing or unreliable in the underlying data, briefly
5. **Flags for Leadership** - 2-4 bullet points of what a founder should pay attention to
Keep it skimmable - this is meant to be pasted into a leadership doc or Slack update.

You have tools to fetch live data from monday.com. Always fetch fresh data via tools rather
than relying on anything from earlier in the conversation if the user's question could involve
different records than what you already fetched.`;

const tools = [
  {
    functionDeclarations: [
      {
        name: "get_schema",
        description:
          "Get the column names available on the Deals board and the Work Orders board on monday.com. Call this first if you're unsure what fields exist before querying data.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_deals_data",
        description:
          "Fetch all records from the Deals (sales pipeline) monday.com board, normalized and cleaned. Includes a data quality report showing missing/invalid values. Use for questions about pipeline, revenue, deal stages, sectors, probability, sales performance.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "get_work_orders_data",
        description:
          "Fetch all records from the Work Orders (project execution) monday.com board, normalized and cleaned. Includes a data quality report. Use for questions about project execution status, delivery timelines, operational metrics.",
        parameters: { type: "OBJECT", properties: {} },
      },
    ],
  },
];

async function executeTool(name) {
  switch (name) {
    case "get_schema":
      return await getSchema();
    case "get_deals_data":
      return await getDealsData();
    case "get_work_orders_data":
      return await getWorkOrdersData();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function callGemini(contents, retries = 2) {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) throw new Error("GEMINI_API_KEY is not set in environment variables.");

  const modelsToTry = [PRIMARY_MODEL, ...FALLBACK_MODELS];

  for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
    const apiKey = apiKeys[keyIdx];
    const isLastKey = keyIdx === apiKeys.length - 1;

    for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
      const model = modelsToTry[modelIdx];
      const url = geminiUrlFor(model);
      const isLastModel = modelIdx === modelsToTry.length - 1;
      const isLastOption = isLastKey && isLastModel;

      for (let attempt = 0; attempt <= retries; attempt++) {
        console.log(`[gemini] trying key #${keyIdx + 1}/${apiKeys.length}, model "${model}", attempt ${attempt + 1}`);
        const res = await fetch(`${url}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            tools,
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          }),
        });
        console.log(`[gemini] key #${keyIdx + 1}, model "${model}" -> HTTP ${res.status}`);

        // Model deprecated/not found - try the next model (same key first).
        if (res.status === 404 && !isLastModel) break;

        if (res.status === 429 || res.status >= 500) {
          if (attempt < retries) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            continue;
          }
          // Out of retries on this model - try the next fallback model,
          // and if that key's models are all exhausted, the next key.
          if (!isLastModel) break;

          if (isLastOption) {
            if (res.status === 429) {
              let detail = "";
              try {
                const body = await res.json();
                detail = body?.error?.message || "";
              } catch (e) {}
              throw new Error(
                "I'm being rate-limited across all available AI models and API keys right now " +
                "(free-tier daily quota likely exhausted). Please try again later." +
                (detail ? ` Details: ${detail}` : "")
              );
            }
            throw new Error("The AI model service is temporarily unavailable. Please try again in a moment.");
          }
          break; // move to next model, or next key once models are exhausted
        }

        const data = await res.json();

        if (!res.ok) {
          if (!isLastOption) break;
          throw new Error(`Gemini API error (${res.status}): ${data?.error?.message || JSON.stringify(data)}`);
        }

        return data;
      }
    }
  }

  throw new Error("All AI model options and API keys failed. Please try again shortly.");
}

/**
 * Create a new session's conversation state. We keep the raw `contents`
 * array (Gemini's own history format: [{role, parts}]) rather than an
 * SDK object, so we have full control over role assignment.
 */
function createChatSession() {
  return [];
}

/**
 * Send a user message through the agent's tool-use loop and return the
 * final text reply. `contents` is mutated in place to accumulate
 * conversation history for this session.
 */
async function sendMessage(contents, userMessage) {
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const MAX_TOOL_ROUNDS = 6;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await callGemini(contents);
    const candidate = data.candidates?.[0];

    if (!candidate) {
      throw new Error("Gemini returned no candidates: " + JSON.stringify(data));
    }

    const parts = candidate.content?.parts || [];
    contents.push({ role: "model", parts });

    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      return parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join("\n");
    }

    const functionResponseParts = await Promise.all(
      functionCalls.map(async (call) => {
        let output;
        try {
          output = await executeTool(call.functionCall.name);
        } catch (err) {
          output = { error: err.message };
        }
        return {
          functionResponse: {
            name: call.functionCall.name,
            response: { result: output },
          },
        };
      })
    );

    // Current Gemini API expects function results back under role "user"
    // (older docs/SDKs used role "function" or "tool" - that's now rejected).
    contents.push({ role: "user", parts: functionResponseParts });
  }

  return "I made several data queries but couldn't finalize an answer in time. Could you narrow your question?";
}

module.exports = { createChatSession, sendMessage };