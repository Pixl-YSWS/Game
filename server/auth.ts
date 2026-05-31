import type { Database } from "bun:sqlite";
import express from "express";
import { randomBytes } from "crypto";

// ── Hack Club OAuth 2.0 (auth.hackclub.com) ──────────────────────────
// Docs: https://auth.hackclub.com/docs/oauth-guide
const AUTH_BASE = "https://auth.hackclub.com";
const SCOPES = "openid profile email name slack_id";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
// Sliding-session refresh: each time a token is verified we push its expiry
// back out to a full TTL, but only once the session has aged past this much
// (so we do at most ~one DB write per day per active player, not one per
// socket connect/reconnect). The upshot is an active player never gets logged
// out — only a session idle for the full 30 days lapses.
const SESSION_REFRESH_AFTER_MS = 1000 * 60 * 60 * 24; // 1 day

// All secrets + URLs come from the environment (Bun auto-loads .env).
const CLIENT_ID = process.env.HACKCLUB_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HACKCLUB_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI ?? "http://localhost:3001/auth/callback";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

// Guest login for testing — disable in production with ALLOW_GUEST=false.
const GUEST_ENABLED = process.env.ALLOW_GUEST !== "false";

export function authConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}

export interface Account {
  accountId: string;
  name: string;
  email: string | null;
  slackId: string | null;
  char: number;
  verified: boolean;
}

interface Identity {
  id?: string;
  first_name?: string;
  last_name?: string;
  primary_email?: string;
  slack_id?: string;
  verification_status?: string;
  // Possible Slack display-name / username fields. The /me response is
  // "analogous to Slack's users.info", so one of these usually carries the
  // handle the user actually goes by. We try them in order and fall back to
  // their first name (never the full real name) for privacy.
  username?: string;
  slack_username?: string;
  slack_display_name?: string;
  display_name?: string;
  slack_name?: string;
  nickname?: string;
  [key: string]: unknown;
}
interface MeResponse {
  identity?: Identity;
}

// Pick the most "handle-like" name available, preferring a Slack display name
// over the user's real first/last name so people aren't forced to show it.
function pickDisplayName(ident: Identity): string {
  const slackName =
    ident.username ||
    ident.slack_username ||
    ident.slack_display_name ||
    ident.display_name ||
    ident.slack_name ||
    ident.nickname;
  return (
    (typeof slackName === "string" && slackName.trim()) ||
    ident.first_name?.trim() || // first name only — not the full real name
    ident.primary_email ||
    "Hack Clubber"
  );
}

// Number of selectable character skins — keep in sync with client CHAR_BASES.
const NUM_SKINS = 5;

// Stable default skin for an account that hasn't picked one yet.
function defaultCharIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % NUM_SKINS;
}

export interface AuthModule {
  router: express.Router;
  /** Resolve a session token to its account, or null if invalid/expired. */
  verifySession(token: string): Account | null;
  /** Persist a player's chosen character skin. */
  setChar(accountId: string, char: number): void;
}

export function setupAuth(db: Database): AuthModule {
  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id          TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      email               TEXT,
      slack_id            TEXT,
      access_token        TEXT,
      refresh_token       TEXT,
      token_expires_at    INTEGER,
      session_token       TEXT,
      session_expires_at  INTEGER,
      char_index          INTEGER,
      verification_status TEXT,
      created_at          INTEGER NOT NULL,
      updated_at          INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_session ON accounts(session_token)`);
  // Idempotent column adds for accounts created before these existed.
  for (const sql of [
    "ALTER TABLE accounts ADD COLUMN char_index INTEGER",
    "ALTER TABLE accounts ADD COLUMN verification_status TEXT",
  ]) {
    try { db.run(sql); }
    catch (e: any) { if (!/duplicate column name/i.test(String(e?.message))) throw e; }
  }

  // char_index is set only on insert (NULL) so a re-login never wipes a chosen
  // skin; verification_status refreshes every login.
  const upsertAccount = db.query(`
    INSERT INTO accounts
      (account_id, name, email, slack_id, access_token, refresh_token,
       token_expires_at, session_token, session_expires_at, char_index,
       verification_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      slack_id = excluded.slack_id,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expires_at = excluded.token_expires_at,
      session_token = excluded.session_token,
      session_expires_at = excluded.session_expires_at,
      verification_status = excluded.verification_status,
      updated_at = excluded.updated_at
  `);

  const updateChar = db.query(
    `UPDATE accounts SET char_index = ?, updated_at = ? WHERE account_id = ?`,
  );

  // Slide a session's expiry forward (sliding-window auth — see verifySession).
  const touchSession = db.query(
    `UPDATE accounts SET session_expires_at = ?, updated_at = ? WHERE session_token = ?`,
  );

  const selectBySession = db.query<
    {
      account_id: string;
      name: string;
      email: string | null;
      slack_id: string | null;
      session_expires_at: number;
      char_index: number | null;
      verification_status: string | null;
    },
    [string]
  >(
    `SELECT account_id, name, email, slack_id, session_expires_at,
            char_index, verification_status
     FROM accounts WHERE session_token = ?`,
  );

  // Short-lived CSRF state tokens for the authorize → callback round trip.
  const pendingStates = new Map<string, number>();
  const STATE_TTL_MS = 10 * 60 * 1000;
  const sweepStates = () => {
    const now = Date.now();
    for (const [s, exp] of pendingStates) if (exp < now) pendingStates.delete(s);
  };

  const router = express.Router();

  // Kick off the OAuth flow.
  router.get("/login", (_req, res) => {
    if (!authConfigured()) {
      res.status(500).send("Auth not configured: set HACKCLUB_CLIENT_ID / HACKCLUB_CLIENT_SECRET.");
      return;
    }
    sweepStates();
    const state = randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now() + STATE_TTL_MS);
    const url =
      `${AUTH_BASE}/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${state}`;
    res.redirect(url);
  });

  // OAuth redirect target: exchange the code, fetch the profile, mint a session.
  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!state || !pendingStates.delete(state)) {
      res.status(400).send("Invalid or expired auth state. Try logging in again.");
      return;
    }
    if (!code) {
      res.status(400).send("Missing authorization code.");
      return;
    }

    try {
      const tokenRes = await fetch(`${AUTH_BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          code,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        console.error("[auth] token exchange failed:", tokenRes.status, await tokenRes.text());
        res.status(502).send("Token exchange failed.");
        return;
      }
      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const meRes = await fetch(`${AUTH_BASE}/api/v1/me`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!meRes.ok) {
        console.error("[auth] /me failed:", meRes.status, await meRes.text());
        res.status(502).send("Could not load your Hack Club profile.");
        return;
      }
      const me = (await meRes.json()) as MeResponse;
      const ident = me.identity ?? {};
      const accountId = ident.id;
      if (!accountId) {
        console.error("[auth] /me missing identity.id:", JSON.stringify(me));
        res.status(502).send("Hack Club profile had no id.");
        return;
      }
      // One-time discovery log: shows which fields Hack Club actually returns,
      // so we can pin the exact Slack-name field if our guesses miss it.
      console.log("[auth] /me identity fields:", Object.keys(ident).join(", "));
      const name = pickDisplayName(ident);

      const now = Date.now();
      const sessionToken = "sess_" + randomBytes(24).toString("hex");
      upsertAccount.run(
        accountId,
        name,
        ident.primary_email ?? null,
        ident.slack_id ?? null,
        tokens.access_token,
        tokens.refresh_token ?? null,
        tokens.expires_in ? now + tokens.expires_in * 1000 : null,
        sessionToken,
        now + SESSION_TTL_MS,
        ident.verification_status ?? null,
        now,
        now,
      );
      console.log(`[auth] login ok: ${name} (${accountId})`);

      // Hand the session back to the SPA via the URL fragment (never logged).
      res.redirect(`${CLIENT_URL}/#auth=${sessionToken}`);
    } catch (e) {
      console.error("[auth] callback error:", e);
      res.status(500).send("Authentication failed.");
    }
  });

  // Throwaway guest account for testing multiplayer without OAuth. Each call
  // mints a fresh account, so several guests can play side by side.
  router.get("/guest", (req, res) => {
    if (!GUEST_ENABLED) {
      res.status(403).json({ ok: false, error: "guest login disabled" });
      return;
    }
    const raw = typeof req.query.name === "string" ? req.query.name : "";
    const name = raw.replace(/[\x00-\x1f]/g, "").trim().slice(0, 24) || "Guest";
    const accountId = "guest_" + randomBytes(6).toString("hex");
    const now = Date.now();
    const sessionToken = "sess_" + randomBytes(24).toString("hex");
    upsertAccount.run(
      accountId, name, null, null, null, null, null,
      sessionToken, now + SESSION_TTL_MS, null, now, now,
    );
    console.log(`[auth] guest login: ${name} (${accountId})`);
    res.json({ ok: true, token: sessionToken, accountId, name });
  });

  // Lightweight token check used by the client at boot to gate the menu.
  router.get("/verify", (req, res) => {
    const token =
      (typeof req.query.token === "string" && req.query.token) ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "");
    const account = token ? verifySession(token) : null;
    if (!account) {
      res.status(401).json({ ok: false });
      return;
    }
    res.json({ ok: true, accountId: account.accountId, name: account.name });
  });

  function verifySession(token: string): Account | null {
    if (!token) return null;
    const row = selectBySession.get(token);
    if (!row) return null;
    const now = Date.now();
    if (row.session_expires_at < now) return null;
    // Sliding window: extend an actively-used session so a player who keeps
    // playing never hits the 30-day wall. Throttled so we only write once the
    // session has aged a day, not on every reconnect.
    if (row.session_expires_at - now < SESSION_TTL_MS - SESSION_REFRESH_AFTER_MS) {
      touchSession.run(now + SESSION_TTL_MS, now, token);
    }
    return {
      accountId: row.account_id,
      name: row.name,
      email: row.email,
      slackId: row.slack_id,
      char: row.char_index ?? defaultCharIndex(row.account_id),
      verified: row.verification_status === "verified",
    };
  }

  function setChar(accountId: string, char: number) {
    if (!Number.isInteger(char) || char < 0 || char >= NUM_SKINS) return;
    updateChar.run(char, Date.now(), accountId);
  }

  return { router, verifySession, setChar };
}
