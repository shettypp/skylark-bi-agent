// Auto-discovers the Deals and Work Orders board IDs by matching board
// names, rather than hardcoding IDs (which differ per monday.com account).
// This is cached in memory after the first successful lookup per process.

const { listBoards } = require("./mondayClient");

let cache = null;

// Loosely match board names so small naming differences (e.g. "Deal
// funnel Data.xlsx" vs "Deals") don't break discovery.
const DEALS_PATTERNS = [/deal/i, /pipeline/i, /funnel/i];
const WORK_ORDERS_PATTERNS = [/work.?order/i, /project/i, /execution/i];

function matchBoard(boards, patterns) {
  for (const pattern of patterns) {
    const found = boards.find((b) => pattern.test(b.name));
    if (found) return found;
  }
  return null;
}

async function getBoardRegistry({ forceRefresh = false } = {}) {
  if (cache && !forceRefresh) return cache;

  const boards = await listBoards();

  const dealsBoard = matchBoard(boards, DEALS_PATTERNS);
  const workOrdersBoard = matchBoard(boards, WORK_ORDERS_PATTERNS);

  if (!dealsBoard || !workOrdersBoard) {
    throw new Error(
      `Could not auto-discover boards. Found boards: ${boards
        .map((b) => `"${b.name}" (${b.id})`)
        .join(", ")}. ` +
        `Rename your boards to include "Deal" and "Work Order" respectively, ` +
        `or set MONDAY_DEALS_BOARD_ID / MONDAY_WORK_ORDERS_BOARD_ID env vars.`
    );
  }

  cache = {
    deals: { id: process.env.MONDAY_DEALS_BOARD_ID || dealsBoard.id, name: dealsBoard.name },
    workOrders: {
      id: process.env.MONDAY_WORK_ORDERS_BOARD_ID || workOrdersBoard.id,
      name: workOrdersBoard.name,
    },
    allBoards: boards,
  };

  return cache;
}

module.exports = { getBoardRegistry };
