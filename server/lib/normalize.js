// Data resilience layer: turns raw monday.com items (column id -> text)
// into clean, analyzable records, and tracks what was messy/missing so
// the agent can honestly caveat its answers instead of pretending the
// data is perfect.

/**
 * Flatten a raw monday.com item into { name, fields: { columnTitle: text } }
 * using the board's column id -> title mapping.
 */
function flattenItem(item, columnsMeta) {
  const idToTitle = {};
  for (const col of columnsMeta) idToTitle[col.id] = col.title;

  const fields = {};
  for (const cv of item.column_values) {
    const title = idToTitle[cv.id] || cv.id;
    fields[title] = cv.text; // monday.com's rendered text value
  }

  return { id: item.id, name: item.name, fields };
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

// Common date formats we might see in messy imported data:
// "2026-02-26", "02/26/2026", "26-02-2026", "Feb 26, 2026", monday's
// default "YYYY-MM-DD".
function parseDateLoose(raw) {
  if (isBlank(raw)) return null;
  const s = String(raw).trim();

  // ISO-ish YYYY-MM-DD (monday.com's usual export)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }

  // DD/MM/YYYY or MM/DD/YYYY - ambiguous, assume DD/MM/YYYY (common outside US)
  // but fall back gracefully; we just need a normalized ISO string for sorting/filtering.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], year = +m[3];
    const day = a > 12 ? a : b > 12 ? b : a; // best-effort
    const month = a > 12 ? b : b > 12 ? a : b;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }

  // Fallback to native Date parsing (handles "Feb 26, 2026" etc.)
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);

  return "INVALID:" + s; // preserved so we can flag it, never silently dropped
}

// Parse numbers that may have currency symbols, commas, stray text.
function parseNumberLoose(raw) {
  if (isBlank(raw)) return null;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-") return "INVALID:" + raw;
  const n = parseFloat(cleaned);
  return isNaN(n) ? "INVALID:" + raw : n;
}

// Normalize free-text categorical values (sector, status, etc.) so
// "Mining", "mining ", "MINING" all bucket together, while preserving
// a clean display label.
function normalizeCategory(raw) {
  if (isBlank(raw)) return null;
  const trimmed = String(raw).trim().replace(/\s+/g, " ");
  return trimmed;
}

function fieldNameMatches(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

/**
 * Normalize one record's fields based on naming heuristics, and produce
 * a list of data-quality issues found on this record.
 *
 * criticalFields: array of column-title substrings that matter for BI
 * (e.g. ["sector", "value", "stage"]) - missing/invalid values in these
 * are flagged as quality issues; other blanks are noted but not flagged.
 */
function normalizeRecord(flat, criticalFields = []) {
  const clean = { id: flat.id, name: flat.name };
  const issues = [];

  for (const [title, rawValue] of Object.entries(flat.fields)) {
    let value = rawValue;
    const lower = title.toLowerCase();

    if (fieldNameMatches(title, ["date"])) {
      value = parseDateLoose(rawValue);
    } else if (fieldNameMatches(title, ["value", "amount", "revenue", "price"])) {
      value = parseNumberLoose(rawValue);
    } else if (fieldNameMatches(title, ["sector", "status", "stage", "probability", "nature"])) {
      value = normalizeCategory(rawValue);
    } else {
      value = isBlank(rawValue) ? null : String(rawValue).trim();
    }

    const isCritical = criticalFields.some((k) => lower.includes(k));
    const isInvalid = typeof value === "string" && value.startsWith("INVALID:");

    if ((value === null || isInvalid) && isCritical) {
      issues.push({
        field: title,
        issue: isInvalid ? "unparseable value" : "missing value",
        raw: rawValue ?? null,
      });
    }

    clean[title] = isInvalid ? null : value;
  }

  return { record: clean, issues };
}

/**
 * Normalize a full list of raw monday.com items for a board.
 * Returns { records, qualityReport } where qualityReport summarizes
 * how many records had issues and which fields were most affected.
 */
function normalizeBoard(items, columnsMeta, criticalFields = []) {
  const records = [];
  const allIssues = [];

  for (const item of items) {
    const flat = flattenItem(item, columnsMeta);
    const { record, issues } = normalizeRecord(flat, criticalFields);
    records.push(record);
    if (issues.length > 0) {
      allIssues.push({ itemId: record.id, itemName: record.name, issues });
    }
  }

  const fieldIssueCounts = {};
  for (const entry of allIssues) {
    for (const issue of entry.issues) {
      fieldIssueCounts[issue.field] = (fieldIssueCounts[issue.field] || 0) + 1;
    }
  }

  return {
    records,
    qualityReport: {
      totalRecords: records.length,
      recordsWithIssues: allIssues.length,
      fieldIssueCounts,
      sampleIssues: allIssues.slice(0, 10),
    },
  };
}

module.exports = {
  flattenItem,
  normalizeRecord,
  normalizeBoard,
  parseDateLoose,
  parseNumberLoose,
  isBlank,
};
