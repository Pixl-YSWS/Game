import { preloadFonts, buildCursors } from "./ui/theme";

// Make sure the Kenney fonts are ready and the enlarged cursors are rasterised
// before Phaser renders text / creates interactive objects, then boot the
// game. Dynamic import keeps game construction after the awaits.
Promise.allSettled([preloadFonts(), buildCursors()]).finally(() => {
  import("./game");
});
