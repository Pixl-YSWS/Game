import Phaser from "phaser";
import { FONT, UI_ATLAS, EMOTE_ATLAS } from "../ui/theme";
import {
  characterSheetSpecs,
  npcCharSheetSpecs,
  FRAME_W,
  FRAME_H,
} from "../world/cozyChar";
import { worldSheetSpecs } from "../world/tileset";
import { SERVER_URL } from "../network/socket";
import {
  getSessionToken,
  setAccountId,
  setAccountName,
  clearSession,
} from "../network/playerIdentity";

const SND = "assets/kenney_ui-pack/Sounds";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload() {
    const W = this.scale.width;
    const H = this.scale.height;

    const box = this.add.graphics();
    box.fillStyle(0x1a120b, 1);
    box.fillRect(W / 2 - 160, H / 2 - 20, 320, 40);

    const bar = this.add.graphics();

    const label = this.add
      .text(W / 2, H / 2 - 36, "LOADING...", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#f0a500",
      })
      .setOrigin(0.5, 1);

    this.load.on("progress", (value: number) => {
      bar.clear();
      bar.fillStyle(0xf0a500, 1);
      bar.fillRect(W / 2 - 154, H / 2 - 14, 308 * value, 28);
    });

    this.load.on("complete", () => {
      bar.destroy();
      box.destroy();
      label.destroy();
    });

    this.load.image(
      "tiles-town",
      "assets/kenney_tiny-town/Tilemap/tilemap_packed.png",
    );

    for (const spec of worldSheetSpecs) {
      this.load.image(spec.key, spec.path);
    }

    this.load.image(
      "tiles-battle",
      "assets/kenney_tiny-battle/Tilemap/tilemap_packed.png",
    );

    for (const spec of characterSheetSpecs()) {
      this.load.spritesheet(spec.key, spec.path, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }

    for (const spec of npcCharSheetSpecs()) {
      this.load.spritesheet(spec.key, spec.path, {
        frameWidth: FRAME_W,
        frameHeight: FRAME_H,
      });
    }

    const ADV = "assets/kenney_ui-pack-adventure/Spritesheet";
    this.load.atlasXML(
      UI_ATLAS,
      `${ADV}/spritesheet-default.png`,
      `${ADV}/spritesheet-default.xml`,
    );

    this.load.atlasXML(
      EMOTE_ATLAS,
      "assets/kenny_emote_pack/Spritesheets/pixel_style1.png",
      "assets/kenny_emote_pack/Spritesheets/pixel_style1.xml",
    );

    const MC = "assets/mobile-controls/Spritesheets";
    this.load.atlasXML(
      "mc",
      `${MC}/style-a-default.png`,
      `${MC}/style-a-default.xml`,
    );
    this.load.atlasXML(
      "mc-icons",
      `${MC}/icons-default.png`,
      `${MC}/icons-default.xml`,
    );

    this.load.audio("sfx-click", `${SND}/click-a.ogg`);
    this.load.audio("sfx-tap", `${SND}/tap-a.ogg`);
    this.load.audio("sfx-switch", `${SND}/switch-a.ogg`);
  }

  create() {
    const token = getSessionToken();
    if (!token) {
      this.scene.start("LoginScene");
      return;
    }

    this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Signing in…", {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    fetch(`${SERVER_URL}/auth/verify?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 401) {
          clearSession();
          this.scene.start("LoginScene", { message: "Please log in again." });
          return;
        }
        if (!r.ok) throw new Error(`verify ${r.status}`);
        const d = (await r.json()) as { accountId: string; name: string };
        setAccountId(d.accountId);
        setAccountName(d.name);
        this.scene.start("MainMenuScene");
      })
      .catch(() => {
        this.scene.start("MainMenuScene");
      });
  }
}
