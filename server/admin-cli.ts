// Offline admin management for the game's moderation tables. Run on the server
// box (it edits the same SQLite DB the game uses). Gated by a password that
// must match the ADMIN_SECRET environment variable.
//
//   bun run server/admin-cli.ts <password> <command> [args]
//
// Commands:
//   list                          show all admins, sub-admins and mutes
//   find <text>                   find account ids by name / email substring
//   add-admin   <accountId>       grant full admin
//   add-subadmin <accountId>      grant sub-admin (moderator)
//   remove-role <accountId>       revoke any admin / sub-admin role
//   mute   <accountId> [reason]   mute an account from chat
//   unmute <accountId>            lift a mute
//
// Set the password once, e.g. in .env:  ADMIN_SECRET=ridit@pixlisthebestadmin

import { Database } from "bun:sqlite";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "data");
const db = new Database(join(DATA_DIR, "players.db"));

const [, , password, command, ...args] = process.argv;

const SECRET = process.env.ADMIN_SECRET ?? "";
if (!SECRET) {
  console.error("Refusing to run: ADMIN_SECRET is not set in the environment.");
  process.exit(1);
}
if (password !== SECRET) {
  console.error("Wrong password.");
  process.exit(1);
}

function name(accountId: string): string {
  const r = db.query<{ name: string }, [string]>("SELECT name FROM accounts WHERE account_id = ?").get(accountId);
  return r?.name ?? "(unknown)";
}

function setRole(accountId: string, role: "admin" | "subadmin") {
  db.run(
    "INSERT INTO admins (account_id, role, added_by, created_at) VALUES (?, ?, 'cli', ?) " +
      "ON CONFLICT(account_id) DO UPDATE SET role = excluded.role",
    [accountId, role, Date.now()],
  );
  console.log(`OK: ${name(accountId)} (${accountId}) is now ${role}`);
}

switch (command) {
  case "list": {
    console.log("— Admins —");
    for (const r of db.query<{ account_id: string; role: string }, []>(
      "SELECT account_id, role FROM admins ORDER BY role, account_id",
    ).all()) {
      console.log(`  ${r.role.padEnd(9)} ${name(r.account_id)}  (${r.account_id})`);
    }
    console.log("— Mutes —");
    for (const r of db.query<{ account_id: string; reason: string | null }, []>(
      "SELECT account_id, reason FROM mutes ORDER BY created_at DESC",
    ).all()) {
      console.log(`  ${name(r.account_id)}  (${r.account_id})${r.reason ? `  — ${r.reason}` : ""}`);
    }
    break;
  }
  case "find": {
    const q = `%${(args[0] ?? "").toLowerCase()}%`;
    const rows = db.query<{ account_id: string; name: string; email: string | null }, [string, string]>(
      "SELECT account_id, name, email FROM accounts WHERE lower(name) LIKE ? OR lower(email) LIKE ? ORDER BY name LIMIT 25",
    ).all(q, q);
    if (rows.length === 0) console.log("No matches.");
    for (const r of rows) console.log(`  ${r.name}  <${r.email ?? "no-email"}>  ${r.account_id}`);
    break;
  }
  case "add-admin":
    if (!args[0]) { console.error("usage: add-admin <accountId>"); process.exit(1); }
    setRole(args[0], "admin");
    break;
  case "add-subadmin":
    if (!args[0]) { console.error("usage: add-subadmin <accountId>"); process.exit(1); }
    setRole(args[0], "subadmin");
    break;
  case "remove-role":
    if (!args[0]) { console.error("usage: remove-role <accountId>"); process.exit(1); }
    db.run("DELETE FROM admins WHERE account_id = ?", [args[0]]);
    console.log(`OK: removed any role from ${name(args[0])} (${args[0]})`);
    break;
  case "mute": {
    if (!args[0]) { console.error("usage: mute <accountId> [reason]"); process.exit(1); }
    const reason = args.slice(1).join(" ") || null;
    db.run(
      "INSERT INTO mutes (account_id, reason, muted_by, created_at) VALUES (?, ?, 'cli', ?) " +
        "ON CONFLICT(account_id) DO UPDATE SET reason = excluded.reason",
      [args[0], reason, Date.now()],
    );
    console.log(`OK: muted ${name(args[0])} (${args[0]})`);
    break;
  }
  case "unmute":
    if (!args[0]) { console.error("usage: unmute <accountId>"); process.exit(1); }
    db.run("DELETE FROM mutes WHERE account_id = ?", [args[0]]);
    console.log(`OK: unmuted ${name(args[0])} (${args[0]})`);
    break;
  default:
    console.error("Unknown command. See the header of this file for usage.");
    process.exit(1);
}
