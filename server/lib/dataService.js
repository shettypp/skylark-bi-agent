// Ties together board discovery, raw fetching, and normalization.
// Caches per-board data in memory for a short TTL so a single
// conversation doesn't re-hit the monday.com API on every message,
// while still staying "live" (never hardcoded from CSV).

const { getBoardRegistry } = require("./boardRegistry");
const { getBoardColumns, getAllBoardItems } = require("./mondayClient");
const { normalizeBoard } = require("./normalize");

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const cache = { deals: null, workOrders: null };

const DEALS_CRITICAL_FIELDS = ["sector", "value", "stage", "status", "close date"];
const WORK_ORDERS_CRITICAL_FIELDS = ["status", "customer", "nature", "delivery date"];

async function loadBoard(boardId, criticalFields) {
  const [columnsMeta, items] = await Promise.all([
    getBoardColumns(boardId).then((b) => b.columns),
    getAllBoardItems(boardId),
  ]);
  return normalizeBoard(items, columnsMeta, criticalFields);
}

async function getDealsData({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.deals && now - cache.deals.fetchedAt < CACHE_TTL_MS) {
    return cache.deals.data;
  }
  const registry = await getBoardRegistry();
  const data = await loadBoard(registry.deals.id, DEALS_CRITICAL_FIELDS);
  cache.deals = { data, fetchedAt: now };
  return data;
}

async function getWorkOrdersData({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cache.workOrders && now - cache.workOrders.fetchedAt < CACHE_TTL_MS) {
    return cache.workOrders.data;
  }
  const registry = await getBoardRegistry();
  const data = await loadBoard(registry.workOrders.id, WORK_ORDERS_CRITICAL_FIELDS);
  cache.workOrders = { data, fetchedAt: now };
  return data;
}

async function getSchema() {
  const registry = await getBoardRegistry();
  const [deals, workOrders] = await Promise.all([
    getBoardColumns(registry.deals.id),
    getBoardColumns(registry.workOrders.id),
  ]);
  return {
    deals: { boardName: deals.name, columns: deals.columns.map((c) => c.title) },
    workOrders: { boardName: workOrders.name, columns: workOrders.columns.map((c) => c.title) },
  };
}

module.exports = { getDealsData, getWorkOrdersData, getSchema };
