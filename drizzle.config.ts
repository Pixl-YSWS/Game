import { readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit doesn't auto-load .env.local (where `vercel env pull` writes
// DATABASE_URL), so load both files here — .env first, then .env.local takes
// precedence — without clobbering anything already in the environment.
for (const file of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined || file === ".env.local")
        process.env[m[1]] = value;
    }
  } catch {
    /* file may not exist */
  }
}

// Schema for the YSWS (projects + users) store. The rest of the game still
// lives in SQLite (server/data/players.db); only the Hack-Club-facing YSWS
// data is mirrored into Postgres. See server/db.ts.
export default defineConfig({
  out: "./drizzle",
  schema: "./server/db.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
