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
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#1a1a2e",
  parent: "game-container",
  pixelArt: true, // crisp pixel rendering — essential for pixel art
  antialias: false,
  roundPixels: true,
  // DOM container lets us overlay a real <input> for the chat box.
  dom: { createContainer: true },
  scene: [BootScene, LoginScene, MainMenuScene, WorldScene, InteriorScene, UIScene, ShopScene, PauseScene, SettingsScene, CharacterScene, InvitePanelScene, InboxScene, InventoryScene, AdminScene],
  scale: {
    // RESIZE makes the canvas exactly match the window so there are no black
    // letterbox bars — the game fills the whole screen (and refills on
    // fullscreen / window resize). Scenes lay out against this.scale.width/
    // height, which now track the live window size; the HUD reflows on the
    // scale manager's "resize" event (see UIScene/WorldScene).
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const game = new Phaser.Game(config);
export default game;
