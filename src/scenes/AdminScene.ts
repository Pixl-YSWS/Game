import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT_TITLE, FONT_CHAT, COLORS } from "../ui/theme";
import { panel } from "../ui/UIKit";
import { gameSocket } from "../network/socket";
import type { ModRole, AdminEntry, MuteEntry, AdminPlayerEntry } from "../types/network";

interface AdminInit {
  from?: string;
  role?: ModRole;
}

// One person shown in the moderation list.
interface Person {
  accountId: string;
  name: string;
  role: ModRole;
  muted: boolean;
  online: boolean;
}

const VISIBLE = 7;

// Moderation panel: mute/unmute players and (full admins only) promote or
// demote sub-admins. Opened from the HUD shield button, shown only to staff.
export class AdminScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private myRole: ModRole = null;
  private people: Person[] = [];
  private scroll = 0;
  private rowObjects: Phaser.GameObjects.GameObject[] = [];
  private rowButtons: MenuButton[] = [];
  private listX = 0;
  private listY = 0;
  private listW = 0;
  private emptyText?: Phaser.GameObjects.Text;
  private toast?: Phaser.GameObjects.Text;

  constructor() {
    super({ key: "AdminScene" });
  }

  init(data: AdminInit) {
    this.fromKey = data?.from ?? "WorldScene";
    this.myRole = data?.role ?? null;
    this.scroll = 0;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("admin:data", this.onData);
    });

    this.add.graphics().fillStyle(0x000000, 0.8).fillRect(0, 0, W, H);
    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 540;
    const panelH = 470;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");

    this.add
      .text(W / 2, py + 28, "ADMIN PANEL", { fontFamily: FONT_TITLE, fontSize: "18px", color: "#f0a500" })
      .setOrigin(0.5);
    this.add
      .text(W / 2, py + 50, this.myRole === "admin" ? "Admin" : "Moderator", {
        fontFamily: FONT_CHAT, fontSize: "12px", color: COLORS.textDim,
      })
      .setOrigin(0.5)
      .setResolution(3);

    this.listX = px + 26;
    this.listY = py + 74;
    this.listW = panelW - 52;

    this.emptyText = this.add
      .text(W / 2, this.listY + 60, "Loading…", { fontFamily: FONT_CHAT, fontSize: "14px", color: COLORS.textDim })
      .setOrigin(0.5)
      .setResolution(3);

    this.toast = this.add
      .text(W / 2, py + panelH - 70, "", { fontFamily: FONT_CHAT, fontSize: "12px", color: COLORS.good })
      .setOrigin(0.5)
      .setResolution(3);

    makeMenuButton(this, W / 2, py + panelH - 36, "CLOSE", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const max = Math.max(0, this.people.length - VISIBLE);
      this.scroll = Phaser.Math.Clamp(this.scroll + (dy > 0 ? 1 : -1), 0, max);
      this.render();
    });
    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("admin:data", this.onData);
    gameSocket.requestAdminData();
  }

  private onData = (data: { admins: AdminEntry[]; mutes: MuteEntry[]; online: AdminPlayerEntry[] }) => {
    const roleMap = new Map<string, ModRole>(data.admins.map((a) => [a.accountId, a.role]));
    const seen = new Set<string>();
    const people: Person[] = [];
    for (const p of data.online) {
      people.push({ accountId: p.accountId, name: p.name, role: p.role, muted: p.muted, online: true });
      seen.add(p.accountId);
    }
    // Offline muted accounts, so they can still be unmuted from here.
    for (const m of data.mutes) {
      if (seen.has(m.accountId)) continue;
      people.push({ accountId: m.accountId, name: m.name, role: roleMap.get(m.accountId) ?? null, muted: true, online: false });
    }
    // Staff first, then everyone else by name.
    people.sort((a, b) => (rank(b.role) - rank(a.role)) || a.name.localeCompare(b.name));
    this.people = people;
    const max = Math.max(0, this.people.length - VISIBLE);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, max);
    this.render();
  };

  private render() {
    for (const o of this.rowObjects) o.destroy();
    for (const b of this.rowButtons) b.destroy();
    this.rowObjects.length = 0;
    this.rowButtons.length = 0;

    this.emptyText?.setVisible(this.people.length === 0).setText("No players online");

    const slice = this.people.slice(this.scroll, this.scroll + VISIBLE);
    const rowH = 48;
    slice.forEach((p, i) => {
      const y = this.listY + i * rowH + rowH / 2;
      const bg = this.add
        .rectangle(this.listX + this.listW / 2, y, this.listW, rowH - 6, 0xffffff, 0.05)
        .setStrokeStyle(1, 0xffffff, 0.12);
      this.rowObjects.push(bg);

      const tag = p.role === "admin" ? "  [ADMIN]" : p.role === "subadmin" ? "  [MOD]" : "";
      const nameColor = p.role ? COLORS.accent : p.online ? COLORS.text : COLORS.textDim;
      const label = this.add
        .text(this.listX + 14, y - 7, p.name + tag, { fontFamily: FONT_CHAT, fontSize: "15px", color: nameColor })
        .setOrigin(0, 0.5)
        .setResolution(3);
      const sub = this.add
        .text(this.listX + 14, y + 10, p.muted ? "muted" : p.online ? "online" : "offline", {
          fontFamily: FONT_CHAT, fontSize: "11px", color: p.muted ? COLORS.bad : COLORS.textDim,
        })
        .setOrigin(0, 0.5)
        .setResolution(3);
      this.rowObjects.push(label, sub);

      // Right-aligned action buttons. Mods can't be muted; only full admins
      // can change roles, and never another admin.
      let bx = this.listX + this.listW - 60;
      const canMute = p.role === null;
      if (p.muted) {
        this.actionButton(bx, y, "Unmute", "grey", () => gameSocket.adminUnmute(p.accountId));
        bx -= 116;
      } else if (canMute) {
        this.actionButton(bx, y, "Mute", "blue", () => gameSocket.adminMute(p.accountId));
        bx -= 116;
      }
      if (this.myRole === "admin" && p.role !== "admin") {
        if (p.role === "subadmin") {
          this.actionButton(bx, y, "Demote", "grey", () => gameSocket.adminSetRole(p.accountId, "none"));
        } else {
          this.actionButton(bx, y, "Make Mod", "blue", () => gameSocket.adminSetRole(p.accountId, "subadmin"));
        }
      }
    });
  }

  private actionButton(x: number, y: number, text: string, variant: "blue" | "grey", onClick: () => void) {
    const btn = makeMenuButton(this, x, y, text, {
      width: 108,
      height: 32,
      variant,
      onClick: () => {
        onClick();
        this.flash("Done");
      },
    });
    this.rowButtons.push(btn);
  }

  private flash(msg: string) {
    this.toast?.setText(msg);
    this.time.delayedCall(1200, () => this.toast?.setText(""));
  }
}

function rank(role: ModRole): number {
  return role === "admin" ? 2 : role === "subadmin" ? 1 : 0;
}
