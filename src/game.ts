import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { SettingsScene } from "./scenes/SettingsScene";
import { PauseScene } from "./scenes/PauseScene";
import { WorldScene } from "./scenes/WorldScene";
import { InteriorScene } from "./scenes/InteriorScene";
import { UIScene } from "./scenes/UIScene";
import { ShopScene } from "./scenes/ShopScene";
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  pixelArt: true, // crisp pixel rendering — essential for pixel art
  antialias: false,
  roundPixels: true,
  scene: [BootScene, MainMenuScene, WorldScene, InteriorScene, UIScene, ShopScene, PauseScene, SettingsScene],
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
export default game;
