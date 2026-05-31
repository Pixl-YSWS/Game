import express from "express";
import { randomBytes } from "crypto";
import type { AuthModule } from "./auth.ts";

// ── Hackatime OAuth 2.0 (hackatime.hackclub.com) ─────────────────────────
// Lets a logged-in player connect their Hackatime account so their coding time
// flows into their projects — without pasting an API key. Mirrors the Hack
// Club OAuth flow in auth.ts, but attaches the resulting access token to the
// already-authenticated game account (identified by their session token).
//
// Register an app at https://hackatime.hackclub.com/oauth/applications with
// redirect URI <server>/hackatime/callback and scope `read`, then set
// HACKATIME_CLIENT_ID / HACKATIME_CLIENT_SECRET.
const BASE = (process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com").replace(/\/$/, "");
const CLIENT_ID = process.env.HACKATIME_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HACKATIME_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.HACKATIME_REDIRECT_URI ?? "http://localhost:3001/hackatime/callback";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";
// `read` covers the authenticated stats/projects endpoints; `profile` is the
// default scope Hackatime expects to be present, so request both (matching
// Hackatime's own generated authorize URL — requesting `read` alone is rejected).
const SCOPES = process.env.HACKATIME_SCOPES ?? "profile read";

export function hackatimeConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}

export function setupHackatimeAuth(auth: AuthModule): express.Router {
  const router = express.Router();

  // CSRF state → which game account is connecting. Short-lived.
  const pendingStates = new Map<string, { accountId: string; exp: number }>();
  const STATE_TTL_MS = 10 * 60 * 1000;
  const sweep = () => {
    const now = Date.now();
    for (const [s, v] of pendingStates) if (v.exp < now) pendingStates.delete(s);
  };

  // Kick off the flow. The caller passes their game session token so we know
  // which account to attach the Hackatime token to once it comes back.
  router.get("/connect", (req, res) => {
    if (!hackatimeConfigured()) {
      res
        .status(500)
        .send("Hackatime OAuth is not configured: set HACKATIME_CLIENT_ID / HACKATIME_CLIENT_SECRET.");
      return;
    }
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const account = token ? auth.verifySession(token) : null;
    if (!account) {
      res.status(401).send("Log into the game first, then connect Hackatime.");
      return;
    }
    sweep();
    const state = randomBytes(16).toString("hex");
    pendingStates.set(state, { accountId: account.accountId, exp: Date.now() + STATE_TTL_MS });
    const url =
      `${BASE}/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${state}`;
    res.redirect(url);
  });

  // OAuth redirect target: exchange the code for an access token and store it.
  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const pending = state ? pendingStates.get(state) : undefined;
    if (pending) pendingStates.delete(state);
    if (!pending || pending.exp < Date.now()) {
      res.status(400).send("Invalid or expired Hackatime auth state. Try connecting again.");
      return;
    }
    if (!code) {
      res.status(400).send("Missing authorization code.");
      return;
    }
    try {
      const tokenRes = await fetch(`${BASE}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        console.error("[hackatime] token exchange failed:", tokenRes.status, await tokenRes.text());
        res.status(502).send("Hackatime token exchange failed.");
        return;
      }
      const tok = (await tokenRes.json()) as { access_token?: string };
      if (!tok.access_token) {
        res.status(502).send("Hackatime returned no access token.");
        return;
      }
      auth.setHackatimeKey(pending.accountId, tok.access_token);
      console.log(`[hackatime] connected ${pending.accountId.slice(0, 8)}…`);
      res.type("html").send(connectedHtml());
    } catch (e) {
      console.error("[hackatime] callback error:", e);
      res.status(500).send("Hackatime connection failed.");
    }
  });

  return router;
}

// Tiny page shown in the OAuth popup on success: tell the opener (the game) we
// connected, then close. Falls back to navigating to the client if there's no
// opener (e.g. the flow ran in the same tab).
function connectedHtml(): string {
  const origin = JSON.stringify(CLIENT_URL);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hackatime connected</title></head>
<body style="font-family:system-ui,sans-serif;background:#10162e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center"><h2>Hackatime connected ✓</h2><p>You can close this window and head back to the game.</p></div>
<script>
  try { if (window.opener) window.opener.postMessage({ source: "hackatime", status: "connected" }, ${origin}); } catch (e) {}
  setTimeout(function () { try { window.close(); } catch (e) {} if (!window.closed) location.href = ${origin}; }, 500);
</script>
</body></html>`;
}
