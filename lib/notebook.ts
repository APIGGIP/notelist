import { randomUUID } from "node:crypto";

import type { PoolClient, QueryResultRow } from "pg";

import { getPool } from "@/lib/db";
import { getNotebookId } from "@/lib/env";
import type { NotebookState, TodoItem } from "@/types/notebook";

let schemaReadyPromise: Promise<void> | null = null;

type NotebookRow = {
  note_text: string;
  note_revision: string | number;
  state_revision: string | number;
  updated_at: string | Date;
};

type TodoRow = QueryResultRow & {
  id: string;
  title: string;
  price_cents: string | number;
  completed: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

async function ensureSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await getPool().connect();

      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS notebooks (
            id TEXT PRIMARY KEY,
            note_text TEXT NOT NULL DEFAULT '',
            note_revision BIGINT NOT NULL DEFAULT 0,
            state_revision BIGINT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            price_cents BIGINT NOT NULL DEFAULT 0,
            completed BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_todos_notebook_created_at
          ON todos (notebook_id, created_at DESC);
        `);
      } finally {
        client.release();
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}

async function withClient<T>(fn: (client: PoolClient, notebookId: string) => Promise<T>) {
  await ensureSchema();

  const notebookId = getNotebookId();
  const client = await getPool().connect();

  try {
    await client.query(
      `
        INSERT INTO notebooks (id)
        VALUES ($1)
        ON CONFLICT (id) DO NOTHING;
      `,
      [notebookId]
    );

    return await fn(client, notebookId);
  } finally {
    client.release();
  }
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapTodo(row: TodoRow): TodoItem {
  return {
    id: row.id,
    title: row.title,
    priceCents: Number(row.price_cents),
    completed: row.completed,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

async function fetchState(client: PoolClient, notebookId: string): Promise<NotebookState> {
  const [notebookResult, todosResult] = await Promise.all([
    client.query<NotebookRow>(
      `
        SELECT note_text, note_revision, state_revision, updated_at
        FROM notebooks
        WHERE id = $1;
      `,
      [notebookId]
    ),
    client.query<TodoRow>(
      `
        SELECT id, title, price_cents, completed, created_at, updated_at
        FROM todos
        WHERE notebook_id = $1
        ORDER BY created_at DESC, id DESC;
      `,
      [notebookId]
    )
  ]);

  const notebookRow = notebookResult.rows[0];

  return {
    noteText: notebookRow?.note_text ?? "",
    noteRevision: Number(notebookRow?.note_revision ?? 0),
    stateRevision: Number(notebookRow?.state_revision ?? 0),
    updatedAt: toIsoString(notebookRow?.updated_at ?? new Date()),
    todos: todosResult.rows.map(mapTodo)
  };
}

async function bumpStateRevision(client: PoolClient, notebookId: string) {
  await client.query(
    `
      UPDATE notebooks
      SET state_revision = state_revision + 1,
          updated_at = NOW()
      WHERE id = $1;
    `,
    [notebookId]
  );
}

export async function getNotebookState() {
  return withClient((client, notebookId) => fetchState(client, notebookId));
}

export async function getNotebookRevision() {
  return withClient(async (client, notebookId) => {
    const result = await client.query<{ state_revision: string | number }>(
      `
        SELECT state_revision
        FROM notebooks
        WHERE id = $1;
      `,
      [notebookId]
    );

    return Number(result.rows[0]?.state_revision ?? 0);
  });
}

export async function saveNote(input: {
  text: string;
  baseRevision: number;
  force?: boolean;
}) {
  return withClient(async (client, notebookId) => {
    await client.query("BEGIN");
    let transactionOpen = true;

    try {
      const currentResult = await client.query<NotebookRow>(
        `
          SELECT note_text, note_revision, state_revision, updated_at
          FROM notebooks
          WHERE id = $1
          FOR UPDATE;
        `,
        [notebookId]
      );

      const current = currentResult.rows[0];
      const currentRevision = Number(current.note_revision);

      if (!input.force && currentRevision !== input.baseRevision && current.note_text !== input.text) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return {
          conflict: true as const,
          state: await fetchState(client, notebookId)
        };
      }

      if (current.note_text !== input.text) {
        await client.query(
          `
            UPDATE notebooks
            SET note_text = $2,
                note_revision = note_revision + 1,
                state_revision = state_revision + 1,
                updated_at = NOW()
            WHERE id = $1;
          `,
          [notebookId, input.text]
        );
      }

      await client.query("COMMIT");
      transactionOpen = false;

      return {
        conflict: false as const,
        state: await fetchState(client, notebookId)
      };
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }

      throw error;
    }
  });
}

export async function createTodo(input: { title: string; priceCents: number }) {
  return withClient(async (client, notebookId) => {
    await client.query("BEGIN");
    let transactionOpen = true;

    try {
      await client.query(
        `
          SELECT id
          FROM notebooks
          WHERE id = $1
          FOR UPDATE;
        `,
        [notebookId]
      );

      await client.query(
        `
          INSERT INTO todos (id, notebook_id, title, price_cents, completed)
          VALUES ($1, $2, $3, $4, FALSE);
        `,
        [randomUUID(), notebookId, input.title, input.priceCents]
      );

      await bumpStateRevision(client, notebookId);
      await client.query("COMMIT");
      transactionOpen = false;

      return fetchState(client, notebookId);
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }

      throw error;
    }
  });
}

export async function updateTodo(
  id: string,
  updates: {
    title?: string;
    priceCents?: number;
    completed?: boolean;
  }
) {
  return withClient(async (client, notebookId) => {
    await client.query("BEGIN");
    let transactionOpen = true;

    try {
      const existing = await client.query<{ id: string }>(
        `
          SELECT id
          FROM todos
          WHERE id = $1 AND notebook_id = $2
          FOR UPDATE;
        `,
        [id, notebookId]
      );

      if (!existing.rows[0]) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return null;
      }

      const title = Object.prototype.hasOwnProperty.call(updates, "title") ? updates.title : undefined;
      const priceCents = Object.prototype.hasOwnProperty.call(updates, "priceCents")
        ? updates.priceCents
        : undefined;
      const completed = Object.prototype.hasOwnProperty.call(updates, "completed")
        ? updates.completed
        : undefined;

      await client.query(
        `
          UPDATE todos
          SET title = COALESCE($3, title),
              price_cents = COALESCE($4, price_cents),
              completed = COALESCE($5, completed),
              updated_at = NOW()
          WHERE id = $1 AND notebook_id = $2;
        `,
        [id, notebookId, title ?? null, priceCents ?? null, completed ?? null]
      );

      await bumpStateRevision(client, notebookId);
      await client.query("COMMIT");
      transactionOpen = false;

      return fetchState(client, notebookId);
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }

      throw error;
    }
  });
}

export async function deleteTodo(id: string) {
  return withClient(async (client, notebookId) => {
    await client.query("BEGIN");
    let transactionOpen = true;

    try {
      const deleted = await client.query(
        `
          DELETE FROM todos
          WHERE id = $1 AND notebook_id = $2;
        `,
        [id, notebookId]
      );

      if (!deleted.rowCount) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return null;
      }

      await bumpStateRevision(client, notebookId);
      await client.query("COMMIT");
      transactionOpen = false;

      return fetchState(client, notebookId);
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }

      throw error;
    }
  });
}
