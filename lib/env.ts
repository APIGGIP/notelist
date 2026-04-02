const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "NEON_DATABASE_URL"
] as const;

export function getDatabaseUrl() {
  for (const key of DATABASE_ENV_KEYS) {
    const value = process.env[key];

    if (value) {
      return value;
    }
  }

  throw new Error(
    "Missing database connection string. Set DATABASE_URL (or a compatible Vercel Postgres variable) before calling the API."
  );
}

export function getNotebookId() {
  return process.env.NOTEBOOK_ID?.trim() || "default-notebook";
}
