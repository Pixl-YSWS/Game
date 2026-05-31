import Phaser from "phaser";
import { Button, panel } from "../ui/UIKit";
import { FONT, FONT_TITLE, COLORS } from "../ui/theme";
import { SERVER_URL } from "../network/socket";
import { setSessionToken, setAccountId, setAccountName } from "../network/playerIdentity";

interface LoginInit {
  message?: string;
}

// Gate scene: you cannot play without a Hack Club login. Clicking the button
// sends the browser to the server's /auth/login, which kicks off the Hack
// Club OAuth flow and redirects back with a session token in the URL hash.
export class LoginScene extends Phaser.Scene {
  constructor() {
    super({ key: "LoginScene" });
  }

  private statusText?: Phaser.GameObjects.Text;
  private guestInput?: HTMLInputElement;

  create(data: LoginInit) {
    const W = this.scale.width;
    const H = this.scale.height;
    const cy = H / 2;
    this.cameras.main.setBackgroundColor("#0d0d1a");

    // Starfield.
    const stars = this.add.graphics();
    stars.fillStyle(0xffffff, 0.6);
    for (let i = 0; i < 80; i++) {
      stars.fillRect(
        Phaser.Math.Between(0, W),
        Phaser.Math.Between(0, H),
        Math.random() < 0.85 ? 1 : 2,
        Math.random() < 0.85 ? 1 : 2,
      );
    }

    panel(this, W / 2, cy + 10, 480, 400, "ui-panel-dark");

    const title = this.add
      .text(W / 2, cy - 150, "PIXLGAME", {
        fontFamily: FONT_TITLE,
        fontSize: "38px",
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
      .text(W / 2, cy - 104, "Sign in to play", {
        fontFamily: FONT,
        fontSize: "12px",
        color: COLORS.textDim,
      })
      .setOrigin(0.5);

    new Button(this, W / 2, cy - 62, "LOGIN WITH HACK CLUB", {
      width: 380,
      height: 56,
      onClick: () => this.login(),
    });

    // ── Guest section (testing) ────────────────────────────────────
    this.add
      .text(W / 2, cy - 18, "— or play as a guest —", {
        fontFamily: FONT,
        fontSize: "10px",
        color: "#667",
      })
      .setOrigin(0.5);

    const input = this.add
      .dom(W / 2, cy + 22, "input")
      .setOrigin(0.5);
    this.guestInput = input.node as HTMLInputElement;
    this.guestInput.type = "text";
    this.guestInput.maxLength = 24;
    this.guestInput.placeholder = "Guest name";
    Object.assign(this.guestInput.style, {
      width: "360px",
      padding: "9px 12px",
      font: '15px "Kenney Future Narrow", monospace',
      color: "#ffffff",
      textAlign: "center",
      background: "rgba(10,15,28,0.9)",
      border: "2px solid #5a6b8c",
      borderRadius: "6px",
      outline: "none",
    } as Partial<CSSStyleDeclaration>);
    // The width is set via CSS *after* creation, so Phaser's cached size (used
    // to apply the origin-0.5 offset) is stale and the field renders off-centre.
    // Re-measure now that the real width is in place.
    input.updateSize();
    this.guestInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.joinAsGuest();
    });

    new Button(this, W / 2, cy + 76, "JOIN AS GUEST", {
      width: 380,
      height: 52,
      variant: "grey",
      onClick: () => this.joinAsGuest(),
    });

    // Status / error line (also shows the optional incoming message).
    this.statusText = this.add
      .text(W / 2, cy + 134, data?.message ?? "", {
        fontFamily: FONT,
        fontSize: "10px",
        color: COLORS.bad,
        align: "center",
        wordWrap: { width: 420 },
      })
      .setOrigin(0.5);

    this.add
      .text(W / 2, H - 16, "Hack Club login keeps your progress · guests are temporary", {
        fontFamily: FONT,
        fontSize: "9px",
        color: "#555566",
      })
      .setOrigin(0.5, 1);
  }

  private login() {
    window.location.href = `${SERVER_URL}/auth/login`;
  }

  private async joinAsGuest() {
    const name = (this.guestInput?.value ?? "").trim();
    if (!name) {
      this.statusText?.setColor(COLORS.bad).setText("Enter a name first.");
      this.guestInput?.focus();
      return;
    }
    this.statusText?.setColor(COLORS.textDim).setText("Joining…");
    try {
      const res = await fetch(`${SERVER_URL}/auth/guest?name=${encodeURIComponent(name)}`);
      const data = (await res.json()) as { ok: boolean; token?: string; accountId?: string; name?: string };
      if (!res.ok || !data.ok || !data.token) {
        this.statusText?.setColor(COLORS.bad).setText("Guest login is disabled.");
        return;
      }
      setSessionToken(data.token);
      setAccountId(data.accountId ?? "");
      setAccountName(data.name ?? name);
      this.scene.start("MainMenuScene");
    } catch {
      this.statusText?.setColor(COLORS.bad).setText("Can't reach the server. Is it running?");
    }
  }
}
