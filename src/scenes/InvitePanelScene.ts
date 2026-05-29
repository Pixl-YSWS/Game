import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT, FONT_NARROW, COLORS } from "../ui/theme";
import { panel } from "../ui/UIKit";
import { gameSocket } from "../network/socket";
import type { PlayerDirEntry } from "../types/network";

interface PanelInit {
  from: string;
}

// One rendered directory row (recycled across scroll/filter re-renders).
interface Row {
  bg: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  dot: Phaser.GameObjects.Arc;
  btn: MenuButton;
}

const VISIBLE = 7; // rows shown at once; the rest scroll with the wheel

// Overlay panel listing every account, with a live search box, so the player
// can find someone and send them a persistent village invite.
export class InvitePanelScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private all: PlayerDirEntry[] = [];
  private filtered: PlayerDirEntry[] = [];
  private invited = new Set<string>();
  private scroll = 0;
  private query = "";
  private rows: Row[] = [];
  private toast?: Phaser.GameObjects.Text;
  private emptyText?: Phaser.GameObjects.Text;
  private listX = 0;
  private listY = 0;
  private listW = 0;
  private searchDom?: Phaser.GameObjects.DOMElement;

  constructor() {
    super({ key: "InvitePanelScene" });
  }

  init(data: PanelInit) {
    this.fromKey = data?.from ?? "WorldScene";
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.scene.pause(this.fromKey);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("players:list", this.onList);
      gameSocket.off("invite:sent", this.onSent);
      gameSocket.off("invite:error", this.onError);
      this.searchDom?.destroy();
    });

    this.add.graphics().fillStyle(0x000000, 0.78).fillRect(0, 0, W, H);
    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    const panelW = 520;
    const panelH = 480;
    const px = (W - panelW) / 2;
    const py = (H - panelH) / 2;
    panel(this, W / 2, H / 2, panelW, panelH, "ui-panel-dark");

    this.add
      .text(W / 2, py + 28, "INVITE TO VILLAGE", { fontFamily: FONT, fontSize: "18px", color: "#f0a500" })
      .setOrigin(0.5);

    // DOM search input (mirrors the chat box input styling).
    const dom = this.add.dom(W / 2, py + 64, "input").setOrigin(0.5);
    const input = dom.node as HTMLInputElement;
    input.type = "text";
    input.placeholder = "Search players…";
    input.maxLength = 32;
    Object.assign(input.style, {
      width: `${panelW - 64}px`,
      padding: "7px 10px",
      font: '13px "Kenney Future Narrow", monospace',
      color: "#ffffff",
      background: "rgba(10,15,28,0.9)",
      border: "2px solid #ffd166",
      borderRadius: "6px",
      outline: "none",
    } as Partial<CSSStyleDeclaration>);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.scene.stop();
    });
    input.addEventListener("input", () => {
      this.query = input.value.trim().toLowerCase();
      this.scroll = 0;
      this.applyFilter();
    });
    this.searchDom = dom;
    // Defer focus until the DOM element is mounted.
    this.time.delayedCall(50, () => input.focus());

    this.listX = px + 28;
    this.listY = py + 96;
    this.listW = panelW - 56;

    this.emptyText = this.add
      .text(W / 2, this.listY + 60, "Loading players…", {
        fontFamily: FONT_NARROW,
        fontSize: "14px",
        color: COLORS.textDim,
      })
      .setOrigin(0.5);

    this.toast = this.add
      .text(W / 2, py + panelH - 78, "", { fontFamily: FONT, fontSize: "11px", color: "#7dda1c" })
      .setOrigin(0.5);

    makeMenuButton(this, W / 2, py + panelH - 38, "CLOSE", {
      variant: "grey",
      onClick: () => this.scene.stop(),
    });

    // Mouse wheel scrolls the list.
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const max = Math.max(0, this.filtered.length - VISIBLE);
      this.scroll = Phaser.Math.Clamp(this.scroll + (dy > 0 ? 1 : -1), 0, max);
      this.renderRows();
    });

    this.input.keyboard?.on("keydown-ESC", () => this.scene.stop());

    gameSocket.on("players:list", this.onList);
    gameSocket.on("invite:sent", this.onSent);
    gameSocket.on("invite:error", this.onError);
    gameSocket.requestPlayers();
  }

  private onList = ({ players }: { players: PlayerDirEntry[] }) => {
    this.all = players;
    this.applyFilter();
  };

  private onSent = ({ toName }: { toName: string }) => {
    this.flash(`Invite sent to ${toName}`, "#7dda1c");
  };

  private onError = ({ reason }: { reason: string }) => {
    const human: Record<string, string> = {
      already_invited: "You already invited them",
      invalid_target: "Can't invite that player",
    };
    this.flash(human[reason] ?? `Couldn't invite: ${reason}`, "#ff7777");
  };

  private applyFilter() {
    this.filtered = this.query
      ? this.all.filter(p => p.name.toLowerCase().includes(this.query))
      : this.all;
    const max = Math.max(0, this.filtered.length - VISIBLE);
    this.scroll = Phaser.Math.Clamp(this.scroll, 0, max);
    this.renderRows();
  }

  private renderRows() {
    this.emptyText?.setVisible(this.filtered.length === 0).setText(
      this.all.length === 0 ? "Loading players…" : "No players match your search",
    );

    const slice = this.filtered.slice(this.scroll, this.scroll + VISIBLE);
    const rowH = 46;

    // Build/recycle row widgets.
    for (let i = 0; i < VISIBLE; i++) {
      const entry = slice[i];
      let row = this.rows[i];
      if (entry && !row) {
        row = this.makeRow();
        this.rows[i] = row;
      }
      if (!row) continue;
      const visible = !!entry;
      const y = this.listY + i * rowH;
      row.bg.setVisible(visible).setPosition(this.listX + this.listW / 2, y + 16);
      row.dot.setVisible(visible).setPosition(this.listX + 12, y + 16);
      row.name.setVisible(visible);
      row.btn.container.setVisible(visible);
      if (!entry) continue;

      row.dot.setFillStyle(entry.online ? 0x4ade80 : 0x555566);
      row.name.setPosition(this.listX + 26, y + 9).setText(entry.name);
      row.btn.container.setPosition(this.listX + this.listW - 56, y + 16);
      const done = this.invited.has(entry.accountId);
      row.btn.setText(done ? "SENT" : "INVITE");
      row.btn.setEnabled(!done);
      row.btn.setOnClick(() => {
        if (this.invited.has(entry.accountId)) return;
        this.invited.add(entry.accountId);
        gameSocket.sendInvite(entry.accountId);
        this.renderRows();
      });
    }
  }

  private makeRow(): Row {
    const bg = this.add
      .rectangle(0, 0, this.listW, 38, 0xffffff, 0.05)
      .setStrokeStyle(1, 0xffffff, 0.12);
    const dot = this.add.circle(0, 0, 5, 0x555566);
    const name = this.add
      .text(0, 0, "", { fontFamily: FONT_NARROW, fontSize: "15px", color: "#ffffff" })
      .setResolution(3);
    const btn = makeMenuButton(this, 0, 0, "INVITE", {
      width: 96,
      height: 32,
      onClick: () => {},
    });
    return { bg, name, dot, btn };
  }

  private flash(msg: string, color: string) {
    if (!this.toast) return;
    this.toast.setColor(color).setText(msg);
    this.time.delayedCall(1400, () => this.toast?.setText(""));
  }
}
