// JS A UTIL CLI.... MADE MY CLAUDE

import { Database } from "bun:sqlite";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DATA_DIR =
  process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "data");
const db = new Database(join(DATA_DIR, "players.db"));

const [, , password, command, ...args] = process.argv;

const SECRET = process.env.ADMIN_SECRET ?? "";
if (!SECRET) {
  console.error(
    "Refusing to run: ADMIN_SECRET is not set in the environment (.env).",
  );
  process.exit(1);
}
if (password !== SECRET) {
  console.error("Wrong password.");
  process.exit(1);
}

type AccountRow = { account_id: string; name: string; email: string | null };

function name(accountId: string): string {
  return (
    db
      .query<
        { name: string },
        [string]
      >("SELECT name FROM accounts WHERE account_id = ?")
      .get(accountId)?.name ?? "(unknown)"
  );
}
function roleMap(): Map<string, string> {
  return new Map(
    db
      .query<{ account_id: string; role: string }, []>(
        "SELECT account_id, role FROM admins",
      )
      .all()
      .map((r) => [r.account_id, r.role]),
  );
}
function muteSet(): Set<string> {
  return new Set(
    db
      .query<{ account_id: string }, []>("SELECT account_id FROM mutes")
      .all()
      .map((r) => r.account_id),
  );
}

function listAccounts(filter?: string) {
  const roles = roleMap();
  const muted = muteSet();
  const q = `%${(filter ?? "").toLowerCase()}%`;
  const rows = db
    .query<
      AccountRow,
      [string, string]
    >("SELECT account_id, name, email FROM accounts WHERE lower(name) LIKE ? OR lower(coalesce(email,'')) LIKE ? ORDER BY updated_at DESC")
    .all(q, q);
  if (rows.length === 0) {
    console.log("No accounts.");
    return;
  }
  for (const r of rows) {
    const tags = [
      roles.get(r.account_id) ? `[${roles.get(r.account_id)}]` : "",
      muted.has(r.account_id) ? "[muted]" : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `${r.account_id.padEnd(22)} ${(r.email ?? "(guest)").padEnd(30)} ${r.name}${tags ? "  " + tags : ""}`,
    );
  }
  console.log(`\n${rows.length} account(s).`);
}

function setRole(accountId: string, role: "admin" | "subadmin") {
  if (!name(accountId) || name(accountId) === "(unknown)")
    console.warn(`Warning: no account with id ${accountId} (granting anyway).`);
  db.run(
    "INSERT INTO admins (account_id, role, added_by, created_at) VALUES (?, ?, 'cli', ?) ON CONFLICT(account_id) DO UPDATE SET role = excluded.role",
    [accountId, role, Date.now()],
  );
  console.log(`OK: ${name(accountId)} (${accountId}) is now ${role}`);
}

function need(arg: string | undefined, usage: string): string {
  if (!arg) {
    console.error(`usage: ${usage}`);
    process.exit(1);
  }
  return arg;
}

switch (command) {
  case "accounts":
  case "find":
    listAccounts(args[0]);
    break;

  case "whois": {
    const id = need(args[0], "whois <accountId>");
    const a = db
      .query<
        AccountRow,
        [string]
      >("SELECT account_id, name, email FROM accounts WHERE account_id = ?")
      .get(id);
    if (!a) {
      console.log("No such account.");
      break;
    }
    const role = roleMap().get(id) ?? "player";
    const muted = muteSet().has(id);
    const p = db
      .query<
        { pixels: number; last_world: string | null },
        [string]
      >("SELECT pixels, last_world FROM players WHERE player_id = ?")
      .get(id);
    console.log(`name:    ${a.name}`);
    console.log(`id:      ${a.account_id}`);
    console.log(`email:   ${a.email ?? "(guest, none)"}`);
    console.log(`role:    ${role}`);
    console.log(`muted:   ${muted ? "yes" : "no"}`);
    console.log(`pixels:  ${p?.pixels ?? 0}`);
    console.log(`world:   ${p?.last_world ?? "(never played)"}`);
    break;
  }

  case "admins": {
    const rows = db
      .query<
        { account_id: string; role: string },
        []
      >("SELECT account_id, role FROM admins ORDER BY role, account_id")
      .all();
    if (rows.length === 0) {
      console.log("No admins or sub-admins.");
      break;
    }
    for (const r of rows)
      console.log(
        `${r.role.padEnd(9)} ${name(r.account_id)}  (${r.account_id})`,
      );
    break;
  }

  case "mutes": {
    const rows = db
      .query<
        { account_id: string; reason: string | null },
        []
      >("SELECT account_id, reason FROM mutes ORDER BY created_at DESC")
      .all();
    if (rows.length === 0) {
      console.log("Nobody is muted.");
      break;
    }
    for (const r of rows)
      console.log(
        `${name(r.account_id)}  (${r.account_id})${r.reason ? `  — ${r.reason}` : ""}`,
      );
    break;
  }

  case "add-admin":
    setRole(need(args[0], "add-admin <accountId>"), "admin");
    break;
  case "add-subadmin":
    setRole(need(args[0], "add-subadmin <accountId>"), "subadmin");
    break;
  case "remove-role": {
    const id = need(args[0], "remove-role <accountId>");
    db.run("DELETE FROM admins WHERE account_id = ?", [id]);
    console.log(`OK: removed any role from ${name(id)} (${id})`);
    break;
  }

  case "mute": {
    const id = need(args[0], "mute <accountId> [reason]");
    const reason = args.slice(1).join(" ") || null;
    db.run(
      "INSERT INTO mutes (account_id, reason, muted_by, created_at) VALUES (?, ?, 'cli', ?) ON CONFLICT(account_id) DO UPDATE SET reason = excluded.reason",
      [id, reason, Date.now()],
    );
    console.log(`OK: muted ${name(id)} (${id})`);
    break;
  }
  case "unmute": {
    const id = need(args[0], "unmute <accountId>");
    db.run("DELETE FROM mutes WHERE account_id = ?", [id]);
    console.log(`OK: unmuted ${name(id)} (${id})`);
    break;
  }

  case "give":
  case "setpixels": {
    const id = need(args[0], `${command} <accountId> <amount>`);
    const amount = Number(need(args[1], `${command} <accountId> <amount>`));
    if (!Number.isFinite(amount)) {
      console.error("amount must be a number");
      process.exit(1);
    }
    const sql =
      command === "give"
        ? "UPDATE players SET pixels = pixels + ?, updated_at = ? WHERE player_id = ?"
        : "UPDATE players SET pixels = ?, updated_at = ? WHERE player_id = ?";
    const res = db.run(sql, [amount, Date.now(), id]);
    if (res.changes === 0) {
      console.log(`No player record for ${id} (have they played yet?).`);
      break;
    }
    const now = db
      .query<
        { pixels: number },
        [string]
      >("SELECT pixels FROM players WHERE player_id = ?")
      .get(id);
    console.log(`OK: ${name(id)} now has ${now?.pixels ?? "?"} pixels.`);
    console.log(
      "Note: if they're online right now, the server may overwrite this on its next save — have them offline for it to stick.",
    );
    break;
  }

  default:
    console.error(
      "Unknown command. Commands: accounts, find, whois, admins, mutes, add-admin, add-subadmin, remove-role, mute, unmute, give, setpixels",
    );
    process.exit(1);
}
