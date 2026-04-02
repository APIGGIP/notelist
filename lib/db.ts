import { Pool } from "pg";

import { getDatabaseUrl } from "@/lib/env";

declare global {
  var __notesitePool: Pool | undefined;
}

function createPool() {
  const connectionString = getDatabaseUrl();
  const isLocalConnection =
    connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

  return new Pool({
    connectionString,
    ssl: isLocalConnection ? false : { rejectUnauthorized: false },
    max: 5
  });
}

export function getPool() {
  if (!global.__notesitePool) {
    global.__notesitePool = createPool();
  }

  return global.__notesitePool;
}
