import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import type { AuthModule } from "./auth.ts";

const BASE = "https://hackatime.hackclub.com".replace(/\/$/, "");
const CLIENT_ID = process.env.HACKATIME_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HACKATIME_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.HACKATIME_REDIRECT_URI ??
  "http://localhost:3001/hackatime/callback";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

// Hackatime's /api/v1/authenticated endpoints require the Doorkeeper default
// scope "profile"; a token minted without it gets 401s on every API call.
const SCOPES = (() => {
  const scopes = (process.env.HACKATIME_SCOPES ?? "profile read")
    .split(/\s+/)
    .filter(Boolean);
  if (!scopes.includes("profile")) scopes.unshift("profile");
  return scopes.join(" ");
})();

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE = "ht_oauth_state";

export function hackatimeConfigured(): boolean {
  return CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;
}

// The state is self-contained (HMAC-signed accountId + expiry) instead of a
// server-side map, so it survives the `bun --watch` restarts that happen
// mid-OAuth-dance during development.
function signState(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ a: accountId, e: Date.now() + STATE_TTL_MS }),
  ).toString("base64url");
  const mac = createHmac("sha256", CLIENT_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${mac}`;
}

function verifyState(state: string): { accountId: string } | "expired" | null {
  const dot = state.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const expected = createHmac("sha256", CLIENT_SECRET).update(payload).digest();
  let given: Buffer;
  try {
    given = Buffer.from(state.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof obj.a !== "string" || typeof obj.e !== "number") return null;
    if (obj.e < Date.now()) return "expired";
    return { accountId: obj.a };
  } catch {
    return null;
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setupHackatimeAuth(auth: AuthModule): express.Router {
  const router = express.Router();

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
    const state = signState(account.accountId);
    // Cookie fallback in case the provider drops the state parameter on the
    // way through its own login redirect.
    res.setHeader(
      "Set-Cookie",
      `${STATE_COOKIE}=${state}; Max-Age=600; HttpOnly; SameSite=Lax; Path=/hackatime`,
    );
    const url =
      `${BASE}/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&state=${encodeURIComponent(state)}`;
    res.redirect(url);
  });

  router.get("/callback", async (req, res) => {
    res.setHeader(
      "Set-Cookie",
      `${STATE_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/hackatime`,
    );

    if (typeof req.query.error === "string") {
      res
        .status(400)
        .send(
          `Hackatime authorization was cancelled or denied (${req.query.error}). Close this window and try again.`,
        );
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    let verified = state ? verifyState(state) : null;
    if (verified === null || verified === "expired") {
      const cookieState = readCookie(req.headers.cookie, STATE_COOKIE);
      const fromCookie = cookieState ? verifyState(cookieState) : null;
      if (fromCookie && fromCookie !== "expired") verified = fromCookie;
    }
    if (verified === "expired") {
      res
        .status(400)
        .send(
          "This Hackatime connect link expired (they last 10 minutes). Go back to the game and try connecting again.",
        );
      return;
    }
    if (!verified) {
      res
        .status(400)
        .send("Invalid Hackatime auth state. Try connecting again.");
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
      auth.setHackatimeKey(verified.accountId, tok.access_token);
      console.log(`[hackatime] connected ${verified.accountId.slice(0, 8)}…`);
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
