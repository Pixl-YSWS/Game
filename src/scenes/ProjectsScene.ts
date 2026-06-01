import Phaser from "phaser";
import { makeMenuButton, type MenuButton } from "../utils/MenuButton";
import { FONT, FONT_TITLE, FONT_NARROW, COLORS } from "../ui/theme";
import { panel, closeButton, fitModal } from "../ui/UIKit";
import { gameSocket, SERVER_URL } from "../network/socket";
import { getSessionToken } from "../network/playerIdentity";
import type { Project, HackatimeStats } from "../types/network";

interface ProjectsInit {
  from: string;
}

type Mode = "list" | "form" | "hackatime";

export class ProjectsScene extends Phaser.Scene {
  private fromKey = "WorldScene";
  private mode: Mode = "list";

  private projects: Project[] = [];
  private hackatimeConnected = false;
  private editingId: number | null = null;

  private px = 0;
  private py = 0;
  private panelW = 580;
  private panelH = 500;

  private body: Phaser.GameObjects.GameObject[] = [];
  private bodyButtons: MenuButton[] = [];
  private domEls: Phaser.GameObjects.DOMElement[] = [];
  private listMask?: Phaser.Display.Masks.GeometryMask;

  private content?: Phaser.GameObjects.Container;
  private scroll = 0;
  private maxScroll = 0;
  private listTop = 0;
  private listBottom = 0;
  private rowH = 76;

  private rowRefs: {
    top: number;
    objs: (Phaser.GameObjects.GameObject &
      Phaser.GameObjects.Components.Visible)[];
    btns: MenuButton[];
  }[] = [];

  private statusText?: Phaser.GameObjects.Text;
  private toast?: Phaser.GameObjects.Text;

  private oauthPopup: Window | null = null;
  private onPopupMessage = (e: MessageEvent) => {
    if (e?.data?.source !== "hackatime" || e.data.status !== "connected")
      return;
    this.flash("Hackatime connected!", "#7dda1c");
    gameSocket.requestHackatimeStats();
    gameSocket.requestProjects();
    if (this.mode === "hackatime") this.showList();
  };

  constructor() {
    super({ key: "ProjectsScene" });
  }

  init(data: ProjectsInit) {
    this.fromKey = data?.from ?? "WorldScene";
    this.mode = "list";
    this.projects = [];
    this.editingId = null;
    this.scroll = 0;
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this.scene.pause(this.fromKey);
    window.addEventListener("message", this.onPopupMessage);
    this.events.once("shutdown", () => {
      this.scene.resume(this.fromKey);
      gameSocket.off("project:list", this.onProjectList);
      gameSocket.off("project:result", this.onProjectResult);
      gameSocket.off("hackatime:stats", this.onHackatimeStats);
      window.removeEventListener("message", this.onPopupMessage);
      try {
        this.oauthPopup?.close();
      } catch {
        /* ignore */
      }
      this.clearBody();
    });

    this.add.zone(0, 0, W, H).setOrigin(0).setInteractive();

    this.panelH = Math.min(500, H - 40);
    this.px = (W - this.panelW) / 2;
    this.py = (H - this.panelH) / 2;
    panel(this, W / 2, H / 2, this.panelW, this.panelH, "ui-panel-dark");
    closeButton(this, this.px + this.panelW - 26, this.py + 24, () =>
      this.scene.stop(),
    );
    fitModal(this, this.panelW, this.panelH);

    this.add
      .text(W / 2, this.py + 28, "PROJECT BOARD", {
        fontFamily: FONT_TITLE,
        fontSize: "20px",
        color: "#f0a500",
      })
      .setOrigin(0.5);

    this.toast = this.add
      .text(W / 2, this.py + this.panelH - 64, "", {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#7dda1c",
      })
      .setOrigin(0.5);

    this.input.on(
      "wheel",
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        if (this.mode !== "list") return;
        this.setScroll(this.scroll + dy * 0.5);
      },
    );
    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.mode === "list") this.scene.stop();
      else this.showList();
    });

    gameSocket.on("project:list", this.onProjectList);
    gameSocket.on("project:result", this.onProjectResult);
    gameSocket.on("hackatime:stats", this.onHackatimeStats);
    gameSocket.requestProjects();
    gameSocket.requestHackatimeStats();

    this.showList();
  }

  private onProjectList = ({
    items,
    hackatimeConnected,
  }: {
    items: Project[];
    hackatimeConnected: boolean;
  }) => {
    this.projects = items;
    this.hackatimeConnected = hackatimeConnected;
    if (this.mode === "list") this.showList();
  };

  private onProjectResult = ({
    ok,
    reason,
  }: {
    ok: boolean;
    reason?: string;
  }) => {
    if (ok) {
      this.flash("Saved!", "#7dda1c");
      if (this.mode === "form") this.showList();
    } else {
      const human: Record<string, string> = {
        name_required: "A project needs a name",
        too_many: "You've hit the project limit",
        not_found: "That project no longer exists",
      };
      this.flash(human[reason ?? ""] ?? `Couldn't save: ${reason}`, "#ff7777");
    }
  };

  private onHackatimeStats = (stats: HackatimeStats) => {
    this.hackatimeConnected = stats.connected;
    this.updateStatusLine(stats);
    if (stats.error === "invalid_key")
      this.flash("Hackatime needs reconnecting", "#ff7777");
    else if (stats.error) this.flash("Couldn't reach Hackatime", "#ff7777");
  };

  private clearBody() {
    for (const b of this.bodyButtons) b.destroy();
    this.bodyButtons.length = 0;
    for (const o of this.body) o.destroy();
    this.body.length = 0;
    for (const d of this.domEls) d.destroy();
    this.domEls.length = 0;
    this.content?.destroy();
    this.content = undefined;
    this.statusText = undefined;
    this.rowRefs.length = 0;
  }

  private track<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.body.push(o);
    return o;
  }

  private showList() {
    this.mode = "list";
    this.clearBody();
    const W = this.scale.width;

    this.statusText = this.track(
      this.add
        .text(this.px + 28, this.py + 60, "", {
          fontFamily: FONT_NARROW,
          fontSize: "13px",
          color: COLORS.textDim,
        })
        .setOrigin(0, 0.5),
    );
    this.updateStatusLine();
    this.bodyButtons.push(
      makeMenuButton(
        this,
        this.px + this.panelW - 86,
        this.py + 60,
        this.hackatimeConnected ? "MANAGE" : "CONNECT HT",
        {
          width: 130,
          height: 34,
          variant: "grey",
          onClick: () => this.showHackatime(),
        },
      ),
    );

    this.bodyButtons.push(
      makeMenuButton(this, W / 2, this.py + 96, "+ NEW PROJECT", {
        width: 220,
        height: 38,
        onClick: () => this.showForm(null),
      }),
    );

    const listX = this.px + 28;
    const listW = this.panelW - 56;
    this.listTop = this.py + 124;
    this.listBottom = this.py + this.panelH - 78;
    const viewportH = this.listBottom - this.listTop;

    if (this.projects.length === 0) {
      this.track(
        this.add
          .text(
            W / 2,
            this.listTop + viewportH / 2,
            "No projects yet.\nShip something and add it here!",
            {
              fontFamily: FONT_NARROW,
              fontSize: "14px",
              color: COLORS.textDim,
              align: "center",
              lineSpacing: 6,
            },
          )
          .setOrigin(0.5),
      );
    } else {
      this.content = this.add.container(0, 0);
      this.rowRefs = [];
      this.projects.forEach((p, i) => {
        const top = this.listTop + i * this.rowH;
        this.buildProjectRow(p, listX, top, listW, this.rowH);
      });

      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff);
      g.fillRect(listX, this.listTop, listW, viewportH);
      this.listMask = g.createGeometryMask();
      this.content.setMask(this.listMask);
      this.track(this.content);

      const contentH = this.projects.length * this.rowH;
      this.maxScroll = Math.max(0, contentH - viewportH);
      this.setScroll(Phaser.Math.Clamp(this.scroll, 0, this.maxScroll));
    }

    this.bodyButtons.push(
      makeMenuButton(this, W / 2, this.py + this.panelH - 36, "CLOSE", {
        variant: "grey",
        width: 200,
        height: 40,
        onClick: () => this.scene.stop(),
      }),
    );
  }

  private buildProjectRow(
    p: Project,
    x: number,
    top: number,
    w: number,
    rowH: number,
  ) {
    const content = this.content!;
    const bg = this.add
      .rectangle(x + w / 2, top + rowH / 2 - 4, w, rowH - 8, 0xffffff, 0.05)
      .setStrokeStyle(1, 0xffffff, 0.12);
    const name = this.add.text(x + 12, top + 12, p.name, {
      fontFamily: FONT_NARROW,
      fontSize: "16px",
      color: "#ffffff",
    });
    const meta: string[] = [];
    if (p.hackatimeProject) {
      meta.push(
        this.hackatimeConnected
          ? `⏱ ${formatDuration(p.seconds ?? 0)}`
          : `⏱ ${p.hackatimeProject}`,
      );
    }
    if (p.repoUrl) meta.push("code");
    if (p.demoUrl) meta.push("demo");
    const sub = this.add.text(
      x + 12,
      top + 36,
      meta.join("   •   ") ||
        (p.description ? truncate(p.description, 60) : "—"),
      {
        fontFamily: FONT_NARROW,
        fontSize: "12px",
        color: COLORS.textDim,
        wordWrap: { width: w - 180 },
      },
    );

    content.add([bg, name, sub]);

    const editBtn = makeMenuButton(
      this,
      x + w - 116,
      top + rowH / 2 - 4,
      "EDIT",
      {
        width: 78,
        height: 32,
        onClick: () => this.showForm(p),
      },
    );
    const delBtn = makeMenuButton(this, x + w - 34, top + rowH / 2 - 4, "DEL", {
      width: 64,
      height: 32,
      variant: "grey",
      onClick: () => {
        gameSocket.deleteProject(p.id);
        this.flash("Deleting…", "#ffd166");
      },
    });
    content.add([editBtn.container, delBtn.container]);
    this.bodyButtons.push(editBtn, delBtn);
    this.rowRefs.push({ top, objs: [bg, name, sub], btns: [editBtn, delBtn] });

    if (p.repoUrl || p.demoUrl) {
      bg.setInteractive({ useHandCursor: true }).on("pointerup", () => {
        const url = p.demoUrl || p.repoUrl;
        if (url) window.open(url, "_blank", "noopener");
      });
    }
  }

  private setScroll(v: number) {
    this.scroll = Phaser.Math.Clamp(v, 0, this.maxScroll);
    if (this.content) this.content.y = -this.scroll;

    for (const r of this.rowRefs) {
      const screenY = r.top - this.scroll;
      const visible =
        screenY + this.rowH > this.listTop && screenY < this.listBottom;
      for (const o of r.objs) o.setVisible(visible);
      for (const b of r.btns) {
        b.container.setVisible(visible);
        b.setEnabled(visible);
      }
    }
  }

  private updateStatusLine(stats?: HackatimeStats) {
    if (!this.statusText) return;
    if (this.hackatimeConnected) {
      const total = stats
        ? `  (${stats.humanReadableTotal || formatDuration(stats.totalSeconds)} total)`
        : "";
      this.statusText
        .setText(`Hackatime: connected ✓${total}`)
        .setColor(COLORS.good);
    } else {
      this.statusText
        .setText("Hackatime: not connected")
        .setColor(COLORS.textDim);
    }
  }

  private showForm(project: Project | null) {
    this.mode = "form";
    this.editingId = project?.id ?? null;
    this.clearBody();
    const W = this.scale.width;

    this.track(
      this.add
        .text(W / 2, this.py + 58, project ? "EDIT PROJECT" : "NEW PROJECT", {
          fontFamily: FONT,
          fontSize: "13px",
          color: COLORS.accent,
        })
        .setOrigin(0.5),
    );

    const fieldX = this.px + 30;
    const fieldW = this.panelW - 60;
    let y = this.py + 92;

    const nameEl = this.field(
      "Name",
      "input",
      fieldX,
      y,
      fieldW,
      project?.name ?? "",
      "My awesome project",
    );
    nameEl.maxLength = 60;
    y += 64;
    const descEl = this.field(
      "Description",
      "textarea",
      fieldX,
      y,
      fieldW,
      project?.description ?? "",
      "What is it?",
      48,
    );
    descEl.maxLength = 500;
    y += 86;
    const repoEl = this.field(
      "Repo URL",
      "input",
      fieldX,
      y,
      fieldW,
      project?.repoUrl ?? "",
      "https://github.com/…",
    );
    repoEl.maxLength = 300;
    y += 64;
    const demoEl = this.field(
      "Demo URL",
      "input",
      fieldX,
      y,
      fieldW,
      project?.demoUrl ?? "",
      "https://…",
    );
    demoEl.maxLength = 300;
    y += 64;
    const htEl = this.field(
      "Hackatime project (for coding time)",
      "input",
      fieldX,
      y,
      fieldW,
      project?.hackatimeProject ?? "",
      "exact project name in Hackatime",
    );
    htEl.maxLength = 100;

    this.bodyButtons.push(
      makeMenuButton(this, W / 2 - 110, this.py + this.panelH - 36, "SAVE", {
        width: 190,
        height: 42,
        onClick: () => {
          const payload = {
            name: nameEl.value.trim(),
            description: descEl.value.trim() || undefined,
            repoUrl: repoEl.value.trim() || undefined,
            demoUrl: demoEl.value.trim() || undefined,
            hackatimeProject: htEl.value.trim() || undefined,
          };
          if (!payload.name) {
            this.flash("A project needs a name", "#ff7777");
            return;
          }
          if (this.editingId != null)
            gameSocket.updateProject({ id: this.editingId, ...payload });
          else gameSocket.createProject(payload);
        },
      }),
    );
    this.bodyButtons.push(
      makeMenuButton(this, W / 2 + 110, this.py + this.panelH - 36, "CANCEL", {
        width: 190,
        height: 42,
        variant: "grey",
        onClick: () => this.showList(),
      }),
    );
  }

  private showHackatime() {
    this.mode = "hackatime";
    this.clearBody();
    const W = this.scale.width;

    this.track(
      this.add
        .text(W / 2, this.py + 58, "HACKATIME", {
          fontFamily: FONT,
          fontSize: "13px",
          color: COLORS.accent,
        })
        .setOrigin(0.5),
    );
    this.track(
      this.add
        .text(
          W / 2,
          this.py + 110,
          this.hackatimeConnected
            ? "Your Hackatime account is connected. Coding time\nflows into any project you map to a Hackatime\nproject name."
            : "Connect your Hackatime account to pull your\ncoding time into your projects. A Hackatime window\nwill open for you to approve access.",
          {
            fontFamily: FONT_NARROW,
            fontSize: "13px",
            color: COLORS.textDim,
            align: "center",
            lineSpacing: 7,
          },
        )
        .setOrigin(0.5),
    );

    if (this.hackatimeConnected) {
      this.bodyButtons.push(
        makeMenuButton(this, W / 2, this.py + 190, "RECONNECT", {
          width: 240,
          height: 42,
          onClick: () => this.openOAuthPopup(),
        }),
      );
      this.bodyButtons.push(
        makeMenuButton(this, W / 2, this.py + 244, "DISCONNECT", {
          width: 240,
          height: 38,
          variant: "grey",
          onClick: () => {
            gameSocket.setHackatimeKey("");
            this.hackatimeConnected = false;
            this.flash("Disconnected", "#ffd166");
            this.showList();
          },
        }),
      );
    } else {
      this.bodyButtons.push(
        makeMenuButton(this, W / 2, this.py + 196, "CONNECT WITH HACKATIME", {
          width: 320,
          height: 46,
          onClick: () => this.openOAuthPopup(),
        }),
      );
    }

    this.bodyButtons.push(
      makeMenuButton(this, W / 2, this.py + this.panelH - 36, "BACK", {
        width: 200,
        height: 40,
        variant: "grey",
        onClick: () => this.showList(),
      }),
    );
  }

  private openOAuthPopup() {
    const token = getSessionToken();
    if (!token) {
      this.flash("Log in again to connect", "#ff7777");
      return;
    }
    const url = `${SERVER_URL}/hackatime/connect?token=${encodeURIComponent(token)}`;
    this.oauthPopup = window.open(
      url,
      "hackatime_oauth",
      "width=560,height=720",
    );
    if (!this.oauthPopup) {
      window.location.href = url;
      return;
    }
    this.flash("Approve access in the Hackatime window…", "#ffd166");
  }

  private field(
    label: string,
    kind: "input" | "textarea",
    x: number,
    y: number,
    w: number,
    value: string,
    placeholder: string,
    height = 30,
  ): HTMLInputElement & HTMLTextAreaElement {
    this.track(
      this.add
        .text(x, y, label, {
          fontFamily: FONT_NARROW,
          fontSize: "12px",
          color: COLORS.textDim,
        })
        .setOrigin(0, 0),
    );
    const dom = this.add
      .dom(x + w / 2, y + 18 + height / 2, kind)
      .setOrigin(0.5);
    const el = dom.node as HTMLInputElement & HTMLTextAreaElement;
    el.value = value;
    el.placeholder = placeholder;
    Object.assign(el.style, {
      width: `${w - 4}px`,
      height: kind === "textarea" ? `${height}px` : "auto",
      padding: "6px 9px",
      font: '13px "Kenney Future Narrow", monospace',
      color: "#ffffff",
      background: "rgba(10,15,28,0.9)",
      border: "2px solid #ffd166",
      borderRadius: "6px",
      outline: "none",
      resize: "none",
      boxSizing: "border-box",
    } as Partial<CSSStyleDeclaration>);

    el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.showList();
    });
    this.domEls.push(dom);
    return el;
  }

  private flash(msg: string, color: string) {
    if (!this.toast) return;
    this.toast.setColor(color).setText(msg);
    this.time.delayedCall(1500, () => this.toast?.setText(""));
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return seconds > 0 ? "<1m" : "0m";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
