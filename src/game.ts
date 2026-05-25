import Phaser from "phaser";
import { WorldScene } from "./scenes/WorldScene";

new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,

  backgroundColor: "#000000",

  pixelArt: true,
  roundPixels: true,

  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },

  scene: [WorldScene],
});
