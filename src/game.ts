import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { UIScene } from "./scenes/UIScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  pixelArt: true, // crisp pixel rendering — essential for pixel art
  antialias: false,
  roundPixels: true,
  scene: [BootScene, WorldScene, UIScene],
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
export default game;
