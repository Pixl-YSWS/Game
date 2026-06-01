import express from "express";
import { randomBytes } from "crypto";
import type { AuthModule } from "./auth.ts";

const BASE = "https://hackatime.hackclub.com".replace(/\/$/, "");
const CLIENT_ID = process.env.HACKATIME_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HACKATIME_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.HACKATIME_REDIRECT_URI ??
  "http://localhost:3001/hackatime/callback";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const SCOPES = process.env.HACKATIME_SCOPES ?? "profile read";

export function hackatimeConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}

export function setupHackatimeAuth(auth: AuthModule): express.Router {
  const router = express.Router();

  const pendingStates = new Map<string, { accountId: string; exp: number }>();
  const STATE_TTL_MS = 10 * 60 * 1000;
  const sweep = () => {
    const now = Date.now();
    for (const [s, v] of pendingStates)
      if (v.exp < now) pendingStates.delete(s);
  };

  router.get("/connect", (req, res) => {
    if (!hackatimeConfigured()) {
      res
        .status(500)
        .send(
          "Hackatime OAuth is not configured: set HACKATIME_CLIENT_ID / HACKATIME_CLIENT_SECRET.",
        );
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
    pendingStates.set(state, {
      accountId: account.accountId,
      exp: Date.now() + STATE_TTL_MS,
    });
    const url =
      `${BASE}/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${state}`;
    res.redirect(url);
  });

  router.get("/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const pending = state ? pendingStates.get(state) : undefined;
    if (pending) pendingStates.delete(state);
    if (!pending || pending.exp < Date.now()) {
      res
        .status(400)
        .send("Invalid or expired Hackatime auth state. Try connecting again.");
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
        console.error(
          "[hackatime] token exchange failed:",
          tokenRes.status,
          await tokenRes.text(),
        );
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
