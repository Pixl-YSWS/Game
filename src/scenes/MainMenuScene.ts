import Phaser from "phaser";
import { makeMenuButton, attachMenuNav, type MenuButton } from "../utils/MenuButton";
import { FONT, COLORS } from "../ui/theme";
import { getAccountName, getSessionToken, clearSession } from "../network/playerIdentity";
import { gameSocket, SERVER_URL } from "../network/socket";
import type { WorldRef } from "../types/network";

interface JoinableVillage {
  ownerId: string;
  name: string;
}

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "MainMenuScene" });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.cameras.main.setBackgroundColor("#0d0d1a");

    // Decorative starfield pixels.
    const stars = this.add.graphics();
    stars.fillStyle(0xffffff, 0.6);
    for (let i = 0; i < 80; i++) {
      const sx = Phaser.Math.Between(0, W);
      const sy = Phaser.Math.Between(0, H);
      const r = Math.random() < 0.85 ? 1 : 2;
      stars.fillRect(sx, sy, r, r);
    }

    // Title.
    const title = this.add
      .text(W / 2, H / 2 - 140, "PIXLGAME", {
        fontFamily: FONT,
        fontSize: "40px",
        color: "#f0a500",
      })
      .setOrigin(0.5)
      .setShadow(3, 3, "#000000", 0, true, true);

    this.tweens.add({
      targets: title,
      y: title.y - 6,
      duration: 1600,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    this.add
      .text(W / 2, H / 2 - 92, "a tiny multiplayer world", {
        fontFamily: FONT,
        fontSize: "9px",
        color: "#888899",
      })
      .setOrigin(0.5);

    // Buttons are built after we know which villages this account can join,
    // so the join shortcuts slot into the keyboard-navigable list. The fetch
    // is fast on localhost; the decor above shows instantly meanwhile.
    this.fetchVillages().then((villages) => {
      if (this.scene.isActive()) this.buildButtons(villages);
    });

    // Signed-in identity.
    const name = getAccountName();
    if (name) {
      this.add
        .text(W / 2, H / 2 - 66, `Signed in as ${name}`, {
          fontFamily: FONT,
          fontSize: "10px",
          color: COLORS.good,
        })
        .setOrigin(0.5);
    }

    // Footer hint.
    this.add
      .text(W / 2, H - 16, "ESC pauses the game once you're in", {
        fontFamily: FONT,
        fontSize: "7px",
        color: "#555566",
      })
      .setOrigin(0.5, 1);
  }

  // Villages this account has been invited into (accepted invites). Failures
  // (offline server, expired token) just yield none — the menu still works.
  private async fetchVillages(): Promise<JoinableVillage[]> {
    const token = getSessionToken();
    if (!token) return [];
    try {
      const r = await fetch(`${SERVER_URL}/api/villages?token=${encodeURIComponent(token)}`);
      if (!r.ok) return [];
      const d = (await r.json()) as { ok: boolean; villages?: JoinableVillage[] };
      return d.ok ? d.villages ?? [] : [];
    } catch {
      return [];
    }
  }

  private buildButtons(villages: JoinableVillage[]) {
    const cx = this.scale.width / 2;
    const STEP = 60;
    // Keep the stack vertically centred regardless of how many village
    // shortcuts we add.
    const rows = 5 + villages.length;
    let y = this.scale.height / 2 - 24 - ((rows - 5) * STEP) / 2;

    // PLAY continues from your last saved world; first-time players land
    // in their own village (server default).
    const buttons: MenuButton[] = [
      makeMenuButton(this, cx, y, "PLAY", { onClick: () => this.startWorld(undefined) }),
      makeMenuButton(this, cx, (y += STEP), "JOIN OPEN WORLD", {
        onClick: () => this.startWorld({ kind: "openworld" }),
      }),
    ];

    // One shortcut per village the player has been invited into.
    for (const v of villages) {
      buttons.push(
        makeMenuButton(this, cx, (y += STEP), `VISIT ${v.name.toUpperCase()}`, {
          onClick: () => this.startWorld({ kind: "village", ownerPlayerId: v.ownerId }),
        }),
      );
    }

    buttons.push(
      makeMenuButton(this, cx, (y += STEP), "CHARACTER", {
        onClick: () => this.scene.launch("CharacterScene", { from: "MainMenuScene" }),
      }),
      makeMenuButton(this, cx, (y += STEP), "SETTINGS", {
        onClick: () => this.scene.launch("SettingsScene", { from: "MainMenuScene" }),
      }),
      makeMenuButton(this, cx, (y += STEP), "LOGOUT", {
        variant: "grey",
        onClick: () => this.logout(),
      }),
    );
    attachMenuNav(this, buttons);
  }

  private startWorld(world: WorldRef | undefined) {
    this.scene.start("WorldScene", { initialWorld: world });
  }

  private logout() {
    clearSession();
    gameSocket.disconnect();
    this.scene.start("LoginScene", { message: "You've been logged out." });
  }
}
