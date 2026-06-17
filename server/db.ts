// WRITTEN BY CLAUDE
// MADE TO SUPPORT HACKATIME DB..... CLONED FROM ALCHEMIZE

// YSWS data store — Postgres via Drizzle, shaped like the Airtable REST API.
//
// Hack Club's YSWS tooling expects submissions to live in an Airtable-shaped
// store. Like the Alchemize project, we run on Postgres (or Neon) but every
// accessor returns the Airtable response envelope ({ records: [{ id, fields }] })
// so callers — and any future Airtable replication — see a consistent shape.
//
// Only the YSWS-relevant tables (projects + the users behind them) live here.
// The real-time game state stays on synchronous SQLite (server/index.ts).
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, desc, eq } from "drizzle-orm";
import { bigint, pgTable, serial, varchar } from "drizzle-orm/pg-core";

// ── Schemas ──────────────────────────────────────────────────────────
export const userTable = pgTable("users", {
  id: serial("id").primaryKey(),
  account_id: varchar("account_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 455 }),
  slack_id: varchar("slack_id", { length: 255 }),
  hackatime: varchar("hackatime", { length: 1000 }),
});

export const projectTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  owner_id: varchar("owner_id", { length: 455 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: varchar("description", { length: 2000 }),
  repo_url: varchar("repo_url", { length: 1000 }),
  demo_url: varchar("demo_url", { length: 1000 }),
  hackatime_project: varchar("hackatime_project", { length: 2000 }),
  created_at: bigint("created_at", { mode: "number" }).notNull(),
  updated_at: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── Airtable-compatible response envelope ────────────────────────────
export interface DBResponse {
  ok: boolean;
  status: number;
  json: () => Promise<any>;
  text: () => Promise<string>;
}
export interface airtableReplication {
  id: string;
  fields: any;
}

function ok(body: any, status = 200): DBResponse {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function fail(message: string, status = 500): DBResponse {
  return {
    ok: false,
    status,
    json: async () => ({ message }),
    text: async () => JSON.stringify({ message }),
  };
}

// ── Connection ───────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const isNeon = DATABASE_URL?.includes("neon.tech");

// We decide SSL ourselves (below), so strip any sslmode/ssl query param from the
// URL — otherwise pg-connection-string logs a noisy deprecation warning for it.
const connectionString = DATABASE_URL?.replace(/(sslmode|ssl)=[^&]*&?/gi, "")
  .replace(/[?&]$/, "")
  .replace(/\?&/, "?");

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: isNeon ? { rejectUnauthorized: false } : false,
    })
  : null;

const db = pool ? drizzle(pool) : null;

/** Whether a Postgres YSWS store is configured. When false, accessors fail soft
 * so the rest of the game keeps running without a database. */
export const yswsEnabled = !!db;

let warnedDisabled = false;
function disabled(): DBResponse {
  if (!warnedDisabled) {
    console.warn(
      "[ysws] DATABASE_URL not set — projects are not persisted. Set DATABASE_URL to enable the Postgres YSWS store.",
    );
    warnedDisabled = true;
  }
  return fail("YSWS store not configured", 503);
}

/** Create the YSWS tables if they don't exist yet. Cheap to call on boot;
 * a no-op when no DATABASE_URL is configured. For schema changes use
 * `drizzle-kit` against drizzle.config.ts instead. */
export async function ensureSchema(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      account_id VARCHAR(255) NOT NULL UNIQUE,
      name       VARCHAR(255),
      email      VARCHAR(455),
      slack_id   VARCHAR(255),
      hackatime  VARCHAR(1000)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id                SERIAL PRIMARY KEY,
      owner_id          VARCHAR(455) NOT NULL,
      name              VARCHAR(255) NOT NULL,
      description       VARCHAR(2000),
      repo_url          VARCHAR(1000),
      demo_url          VARCHAR(1000),
      hackatime_project VARCHAR(2000),
      created_at        BIGINT NOT NULL,
      updated_at        BIGINT NOT NULL
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`,
  );
  console.log("[ysws] Postgres store ready");
}

// ── Project accessors ────────────────────────────────────────────────
export async function getProjectsByOwner(owner: string): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db
      .select()
      .from(projectTable)
      .where(eq(projectTable.owner_id, owner))
      .orderBy(desc(projectTable.created_at));
    const records = rows.map((p) => ({ id: p.id + "", fields: p }));
    return ok({ records });
  } catch (e) {
    console.error("[ysws] getProjectsByOwner failed:", e);
    return fail("Database read failed");
  }
}

export async function getProjectById(id: number): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db
      .select()
      .from(projectTable)
      .where(eq(projectTable.id, id));
    if (rows.length === 0) return fail("Project not found", 404);
    return ok({ id: rows[0].id + "", fields: rows[0] } as airtableReplication);
  } catch (e) {
    console.error("[ysws] getProjectById failed:", e);
    return fail("Database read failed");
  }
}

export interface ProjectInput {
  owner_id: string;
  name: string;
  description: string | null;
  repo_url: string | null;
  demo_url: string | null;
  hackatime_project: string | null;
  created_at: number;
  updated_at: number;
}

export async function createProject(data: ProjectInput): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db.insert(projectTable).values(data).returning();
    return ok(
      { id: rows[0].id + "", fields: rows[0] } as airtableReplication,
      201,
    );
  } catch (e) {
    console.error("[ysws] createProject failed:", e);
    return fail("Database insert failed");
  }
}

/** Update a project the caller owns. Filtering by owner means a non-owner (or a
 * missing id) yields a 404 rather than mutating someone else's record. */
export async function updateProject(
  id: number,
  owner: string,
  fields: {
    name: string;
    description: string | null;
    repo_url: string | null;
    demo_url: string | null;
    hackatime_project: string | null;
    updated_at: number;
  },
): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db
      .update(projectTable)
      .set(fields)
      .where(and(eq(projectTable.id, id), eq(projectTable.owner_id, owner)))
      .returning();
    if (rows.length === 0) return fail("Project not found", 404);
    return ok({ id: rows[0].id + "", fields: rows[0] } as airtableReplication);
  } catch (e) {
    console.error("[ysws] updateProject failed:", e);
    return fail("Database update failed");
  }
}

export async function deleteProject(
  id: number,
  owner: string,
): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db
      .delete(projectTable)
      .where(and(eq(projectTable.id, id), eq(projectTable.owner_id, owner)))
      .returning();
    if (rows.length === 0) return fail("Project not found", 404);
    return ok({ id: rows[0].id + "", fields: rows[0] } as airtableReplication);
  } catch (e) {
    console.error("[ysws] deleteProject failed:", e);
    return fail("Database delete failed");
  }
}

// ── User accessors (YSWS identity mirror) ────────────────────────────
export interface UserInput {
  account_id: string;
  name: string | null;
  email: string | null;
  slack_id: string | null;
  hackatime?: string | null;
}

/** Mirror a player's YSWS identity. Upserts on account_id; only overwrites the
 * hackatime token when one is provided so a login doesn't clobber it. */
export async function upsertUser(data: UserInput): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const set: Record<string, unknown> = {
      name: data.name,
      email: data.email,
      slack_id: data.slack_id,
    };
    if (data.hackatime !== undefined) set.hackatime = data.hackatime;
    const rows = await db
      .insert(userTable)
      .values({
        account_id: data.account_id,
        name: data.name,
        email: data.email,
        slack_id: data.slack_id,
        hackatime: data.hackatime ?? null,
      })
      .onConflictDoUpdate({ target: userTable.account_id, set })
      .returning();
    return ok({ id: rows[0].id + "", fields: rows[0] } as airtableReplication);
  } catch (e) {
    console.error("[ysws] upsertUser failed:", e);
    return fail("Database upsert failed");
  }
}

export async function setUserHackatime(
  accountId: string,
  hackatime: string | null,
): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db
      .update(userTable)
      .set({ hackatime })
      .where(eq(userTable.account_id, accountId))
      .returning();
    if (rows.length === 0) return fail("User not found", 404);
    return ok({ id: rows[0].id + "", fields: rows[0] } as airtableReplication);
  } catch (e) {
    console.error("[ysws] setUserHackatime failed:", e);
    return fail("Database update failed");
  }
}

export async function getUserByAccountId(
  accountId: string,
): Promise<DBResponse> {
  if (!db) return disabled();
  try {
    const rows = await db
      .select()
      .from(userTable)
      .where(eq(userTable.account_id, accountId));
    const records = rows.map((u) => ({ id: u.id + "", fields: u }));
    return ok({ records });
  } catch (e) {
    console.error("[ysws] getUserByAccountId failed:", e);
    return fail("Database read failed");
  }
}
