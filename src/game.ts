import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { LoginScene } from "./scenes/LoginScene";
import { MainMenuScene } from "./scenes/MainMenuScene";
import { CharacterScene } from "./scenes/CharacterScene";
import { SettingsScene } from "./scenes/SettingsScene";
import { PauseScene } from "./scenes/PauseScene";
import { WorldScene } from "./scenes/WorldScene";
import { InteriorScene } from "./scenes/InteriorScene";
import { UIScene } from "./scenes/UIScene";
import { ShopScene } from "./scenes/ShopScene";
import { InvitePanelScene } from "./scenes/InvitePanelScene";
import { InboxScene } from "./scenes/InboxScene";
import { InventoryScene } from "./scenes/InventoryScene";
import { AdminScene } from "./scenes/AdminScene";
import { ProjectsScene } from "./scenes/ProjectsScene";
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  pixelArt: true,
  antialias: false,
  roundPixels: true,

  dom: { createContainer: true },
  scene: [
    BootScene,
    LoginScene,
    MainMenuScene,
    WorldScene,
    InteriorScene,
    UIScene,
    ShopScene,
    PauseScene,
    SettingsScene,
    CharacterScene,
    InvitePanelScene,
    InboxScene,
    InventoryScene,
    AdminScene,
    ProjectsScene,
  ],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
export default game;
