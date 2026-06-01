import { preloadFonts, buildCursors } from "./ui/theme";
import { setSessionToken } from "./network/playerIdentity";

const m = window.location.hash.match(/[#&]auth=([^&]+)/);
if (m) {
  setSessionToken(decodeURIComponent(m[1]));
  history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

Promise.allSettled([preloadFonts(), buildCursors()]).finally(() => {
  import("./game");
});
