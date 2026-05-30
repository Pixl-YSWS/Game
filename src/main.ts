import { preloadFonts, buildCursors } from "./ui/theme";
import { setSessionToken } from "./network/playerIdentity";

// The OAuth callback redirects back here as `…/#auth=<sessionToken>`. Grab it
// into localStorage and scrub the URL before anything else runs.
const m = window.location.hash.match(/[#&]auth=([^&]+)/);
if (m) {
  setSessionToken(decodeURIComponent(m[1]));
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

// Make sure the Pixelify Sans font is ready and the enlarged cursors are rasterised
// before Phaser renders text / creates interactive objects, then boot the
// game. Dynamic import keeps game construction after the awaits.
Promise.allSettled([preloadFonts(), buildCursors()]).finally(() => {
  import("./game");
});
