// monday.com GraphQL API client
// Docs: https://developer.monday.com/api-reference/reference/boards

const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayRequest(query, variables = {}, retries = 2) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    throw new Error("MONDAY_API_TOKEN is not set in environment variables.");
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
          "API-Version": "2024-10",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (networkErr) {
      // Network-level failure (DNS, connection reset, etc.) - retry.
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw new Error(
        "Couldn't reach monday.com (network error). Please check your connection and try again."
      );
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw new Error(
        res.status === 429
          ? "monday.com is rate-limiting requests right now. Please wait a moment and try again."
          : "monday.com's API is temporarily unavailable. Please try again shortly."
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`monday.com API HTTP ${res.status}: ${text}`);
    }

    const json = await res.json();

    if (json.errors) {
      const message = json.errors.map((e) => e.message).join("; ");
      throw new Error(`monday.com API error: ${message}`);
    }

    return json.data;
  }
}

/**
 * List all boards accessible to this token, with basic info.
 * Used at startup to auto-discover board IDs by name, so we don't
 * hardcode board IDs (they differ per monday.com account).
 */
async function listBoards() {
  const query = `
    query {
      boards(limit: 50) {
        id
        name
        state
      }
    }
  `;
  const data = await mondayRequest(query);
  return data.boards.filter((b) => b.state === "active");
}

/**
 * Fetch a board's column definitions (id, title, type).
 * Needed because we must map human column titles -> column ids
 * dynamically, since we didn't hardcode the CSV/board structure.
 */
async function getBoardColumns(boardId) {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        id
        name
        columns {
          id
          title
          type
        }
      }
    }
  `;
  const data = await mondayRequest(query, { boardId: [boardId] });
  return data.boards[0];
}

/**
 * Fetch ALL items from a board with their column values.
 *
 * monday.com's API paginates via a cursor: the FIRST page is fetched
 * through boards -> items_page, and every SUBSEQUENT page must be
 * fetched via the separate top-level `next_items_page` field (it is
 * NOT the same field called again with a cursor argument). We loop
 * until no cursor is returned.
 */
async function getAllBoardItems(boardId) {
  const items = [];

  const firstPageQuery = `
    query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 100) {
          cursor
          items {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      }
    }
  `;

  const nextPageQuery = `
    query ($cursor: String!) {
      next_items_page(limit: 100, cursor: $cursor) {
        cursor
        items {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    }
  `;

  const firstData = await mondayRequest(firstPageQuery, { boardId });
  let page = firstData.boards[0].items_page;
  items.push(...page.items);
  let cursor = page.cursor;

  while (cursor) {
    const data = await mondayRequest(nextPageQuery, { cursor });
    page = data.next_items_page;
    items.push(...page.items);
    cursor = page.cursor;
  }

  return items;
}

module.exports = {
  mondayRequest,
  listBoards,
  getBoardColumns,
  getAllBoardItems,
};
