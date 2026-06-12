import Phaser from "phaser";
import { gameSocket, SERVER_URL } from "../network/socket";
import { getSessionToken } from "../network/playerIdentity";
import type { Project, HackatimeStats } from "../types/network";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";

type Mode = "list" | "form" | "hackatime";

export class ProjectsScene extends Phaser.Scene {
  private mode: Mode = "list";

  private projects: Project[] = [];
  private hackatimeConnected = false;
  private lastStats?: HackatimeStats;
  private editingId: number | null = null;

  private modal?: DomModal;
  private toastEl?: HTMLDivElement;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private statusEl?: HTMLSpanElement;

  // Hackatime project picker state while the create/edit form is open.
  private formSelectedHt = new Set<string>();
  private htPickerEl?: HTMLDivElement;

  private oauthPopup: Window | null = null;
  private onPopupMessage = (e: MessageEvent) => {
    if (e?.data?.source !== "hackatime" || e.data.status !== "connected")
      return;
    this.flash("Hackatime connected!", "#8be98b");
    gameSocket.requestHackatimeStats();
    gameSocket.requestProjects();
    if (this.mode === "hackatime") this.showList();
  };

  constructor() {
    super({ key: "ProjectsScene" });
  }

  init() {
    this.mode = "list";
    this.projects = [];
    this.editingId = null;
  }

  create() {
    // The world scene keeps running behind the modal (so other players,
    // animals and the day cycle don't freeze); the DOM overlay blocks all
    // keyboard/pointer input from reaching it.
    window.addEventListener("message", this.onPopupMessage);
    this.events.once("shutdown", () => {
      gameSocket.off("project:list", this.onProjectList);
      gameSocket.off("project:result", this.onProjectResult);
      gameSocket.off("hackatime:stats", this.onHackatimeStats);
      window.removeEventListener("message", this.onPopupMessage);
      clearTimeout(this.toastTimer);
      try {
        this.oauthPopup?.close();
      } catch {}
      this.modal = undefined;
    });

    this.modal = openDomModal(this, {
      title: "Project Board",
      width: 900,
      onClose: () => this.scene.stop(),
    });
    this.modal.onEscape = () => {
      if (this.mode === "list") this.scene.stop();
      else this.showList();
    };

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
      this.flash("Saved!", "#8be98b");
      if (this.mode === "form") this.showList();
    } else {
      const human: Record<string, string> = {
        name_required: "A project needs a name",
        too_many: "You've hit the project limit",
        not_found: "That project no longer exists",
      };
      this.flash(human[reason ?? ""] ?? `Couldn't save: ${reason}`, "#ff8d7a");
    }
  };

  private onHackatimeStats = (stats: HackatimeStats) => {
    this.hackatimeConnected = stats.connected;
    this.lastStats = stats;
    this.updateStatusLine();
    if (this.mode === "form") this.renderHtPicker();
    if (stats.error === "invalid_key")
      this.flash("Hackatime needs reconnecting", "#ff8d7a");
    else if (stats.error) this.flash("Couldn't reach Hackatime", "#ff8d7a");
  };

  /** Clears the modal body and rebuilds it, keeping a fresh toast element. */
  private resetBody(): HTMLDivElement {
    const body = this.modal!.body;
    body.replaceChildren();
    this.statusEl = undefined;
    this.htPickerEl = undefined;
    this.toastEl = el("div", "pixl-toast");
    return body;
  }

  private showList() {
    this.mode = "list";
    const body = this.resetBody();

    const status = el("div", "pixl-statusline");
    this.statusEl = el("span", "pixl-grow");
    this.updateStatusLine();
    status.append(
      this.statusEl,
      domBtn(
        this,
        this.hackatimeConnected ? "Manage" : "Connect Hackatime",
        () => this.showHackatime(),
      ),
    );

    const newRow = el("div", "pixl-actions");
    newRow.append(domBtn(this, "+ New Project", () => this.showForm(null)));

    const list = el("div", "pixl-list");
    list.style.minHeight = "220px";
    list.style.maxHeight = "56vh";
    if (this.projects.length === 0) {
      list.append(
        el(
          "div",
          "pixl-empty",
          "No projects yet.\nShip something and add it here!",
        ),
      );
      list.lastElementChild!.setAttribute("style", "white-space: pre-line");
    } else {
      for (const p of this.projects) list.append(this.buildProjectRow(p));
    }

    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(this, "Close", () => this.scene.stop(), { variant: "grey", big: true }),
    );

    body.append(status, newRow, list, this.toastEl!, actions);
  }

  private buildProjectRow(p: Project): HTMLDivElement {
    const row = el("div", "pixl-row");
    const main = el("div", "pixl-row-main");
    const meta: string[] = [];
    const htProjects = p.hackatimeProjects ?? [];
    if (htProjects.length) {
      const label =
        htProjects.length === 1 ? htProjects[0] : `${htProjects.length} projects`;
      meta.push(
        this.hackatimeConnected
          ? `⏱ ${formatDuration(p.seconds ?? 0)}`
          : `⏱ ${label}`,
      );
    }
    if (p.repoUrl) meta.push("code");
    if (p.demoUrl) meta.push("demo");
    main.append(
      el("div", "pixl-row-name", p.name),
      el(
        "div",
        "pixl-row-meta",
        meta.join("   •   ") || (p.description ? p.description : "—"),
      ),
    );
    row.append(
      main,
      domBtn(this, "Edit", () => this.showForm(p)),
      domBtn(
        this,
        "Delete",
        () => {
          gameSocket.deleteProject(p.id);
          this.flash("Deleting…", "#ffd166");
        },
        { variant: "grey" },
      ),
    );

    const url = p.demoUrl || p.repoUrl;
    if (url) {
      row.classList.add("pixl-row-link");
      main.addEventListener("click", () =>
        window.open(url, "_blank", "noopener"),
      );
    }
    return row;
  }

  private updateStatusLine() {
    if (!this.statusEl) return;
    if (this.hackatimeConnected) {
      const stats = this.lastStats;
      const total = stats?.connected
        ? `  (${stats.humanReadableTotal || formatDuration(stats.totalSeconds)} total)`
        : "";
      this.statusEl.textContent = `Hackatime: connected ✓${total}`;
      this.statusEl.style.color = "#8be98b";
    } else {
      this.statusEl.textContent = "Hackatime: not connected";
      this.statusEl.style.color = "#c9b18c";
    }
  }

  private showForm(project: Project | null) {
    this.mode = "form";
    this.editingId = project?.id ?? null;
    const body = this.resetBody();

    const heading = el(
      "div",
      "pixl-sub",
      project ? "Edit Project" : "New Project",
    );

    const fields = el("div", "pixl-list");
    const nameEl = this.field(fields, "Name", "input", project?.name ?? "", "My awesome project", 60);
    const descEl = this.field(fields, "Description", "textarea", project?.description ?? "", "What is it?", 500);
    const repoEl = this.field(fields, "Repo URL", "input", project?.repoUrl ?? "", "https://github.com/…", 300);
    const demoEl = this.field(fields, "Demo URL", "input", project?.demoUrl ?? "", "https://…", 300);

    // Multi-select picker of the user's Hackatime projects, in place of the old
    // free-text field. Selection lives in formSelectedHt so the list can be
    // re-rendered (when stats arrive) without losing what's checked.
    this.formSelectedHt = new Set(project?.hackatimeProjects ?? []);
    const htWrap = el("div", "pixl-field");
    htWrap.append(el("label", undefined, "Hackatime projects (for coding time)"));
    this.htPickerEl = el("div", "pixl-check-list");
    htWrap.append(this.htPickerEl);
    fields.append(htWrap);
    this.renderHtPicker();
    if (this.hackatimeConnected && !this.lastStats)
      gameSocket.requestHackatimeStats();

    const actions = el("div", "pixl-actions");
    actions.append(
      domBtn(
        this,
        "Save",
        () => {
          const ht = Array.from(this.formSelectedHt);
          const payload = {
            name: nameEl.value.trim(),
            description: descEl.value.trim() || undefined,
            repoUrl: repoEl.value.trim() || undefined,
            demoUrl: demoEl.value.trim() || undefined,
            hackatimeProjects: ht.length ? ht : undefined,
          };
          if (!payload.name) {
            this.flash("A project needs a name", "#ff8d7a");
            return;
          }
          if (this.editingId != null)
            gameSocket.updateProject({ id: this.editingId, ...payload });
          else gameSocket.createProject(payload);
        },
        { big: true },
      ),
      domBtn(this, "Cancel", () => this.showList(), {
        variant: "grey",
        big: true,
      }),
    );

    body.append(heading, fields, this.toastEl!, actions);
    nameEl.focus();
  }

  /** (Re)builds the Hackatime project checkbox list from the latest stats. */
  private renderHtPicker() {
    const host = this.htPickerEl;
    if (!host) return;
    host.replaceChildren();

    if (!this.hackatimeConnected) {
      host.append(
        el(
          "div",
          "pixl-check-empty",
          "Connect Hackatime (MANAGE on the project board) to pick projects.",
        ),
      );
      return;
    }

    const stats = this.lastStats?.projects ?? [];
    if (!stats.length && !this.formSelectedHt.size) {
      host.append(
        el(
          "div",
          "pixl-check-empty",
          this.lastStats
            ? "No Hackatime projects found yet. Track some coding time first."
            : "Loading your Hackatime projects…",
        ),
      );
      return;
    }

    // Available projects from stats, plus any already-selected names that no
    // longer show up (e.g. archived) so existing selections aren't lost.
    const secondsByName = new Map(stats.map((p) => [p.name, p.seconds]));
    const names = [...stats.map((p) => p.name)];
    for (const sel of this.formSelectedHt)
      if (!secondsByName.has(sel)) names.push(sel);

    for (const name of names) {
      const item = el("label", "pixl-check-item");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = this.formSelectedHt.has(name);
      box.addEventListener("change", () => {
        if (box.checked) this.formSelectedHt.add(name);
        else this.formSelectedHt.delete(name);
      });
      const label = el("span", "pixl-grow", name);
      const secs = secondsByName.get(name);
      item.append(box, label);
      if (secs != null)
        item.append(el("span", "pixl-check-time", formatDuration(secs)));
      host.append(item);
    }
  }

  private showHackatime() {
    this.mode = "hackatime";
    const body = this.resetBody();

    const heading = el("div", "pixl-sub", "Hackatime");
    const hint = el(
      "div",
      "pixl-hint",
      this.hackatimeConnected
        ? "Your Hackatime account is connected. Coding time flows into any project you map to a Hackatime project name."
        : "Connect your Hackatime account to pull your coding time into your projects. A Hackatime window will open for you to approve access.",
    );

    const actions = el("div", "pixl-actions");
    actions.style.flexDirection = "column";
    actions.style.alignItems = "center";
    if (this.hackatimeConnected) {
      actions.append(
        domBtn(this, "Reconnect", () => this.openOAuthPopup(), { big: true }),
        domBtn(
          this,
          "Disconnect",
          () => {
            gameSocket.setHackatimeKey("");
            this.hackatimeConnected = false;
            this.lastStats = undefined;
            this.flash("Disconnected", "#ffd166");
            this.showList();
          },
          { variant: "grey" },
        ),
      );
    } else {
      actions.append(
        domBtn(this, "Connect with Hackatime", () => this.openOAuthPopup(), {
          big: true,
        }),
      );
    }

    const back = el("div", "pixl-actions");
    back.append(
      domBtn(this, "Back", () => this.showList(), { variant: "grey", big: true }),
    );

    body.append(heading, hint, actions, this.toastEl!, back);
  }

  private openOAuthPopup() {
    const token = getSessionToken();
    if (!token) {
      this.flash("Log in again to connect", "#ff8d7a");
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
    parent: HTMLElement,
    label: string,
    kind: "input" | "textarea",
    value: string,
    placeholder: string,
    maxLength: number,
  ): HTMLInputElement | HTMLTextAreaElement {
    const wrap = el("div", "pixl-field");
    wrap.append(el("label", undefined, label));
    const input = document.createElement(kind);
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    if (input instanceof HTMLTextAreaElement) input.rows = 3;
    wrap.append(input);
    parent.append(wrap);
    return input;
  }

  private flash(msg: string, color: string) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.style.color = color;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.toastEl) this.toastEl.textContent = "";
    }, 1500);
  }
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return seconds > 0 ? "<1m" : "0m";
}
