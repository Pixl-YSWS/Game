import Phaser from "phaser";
import { openDomModal, domBtn, el, type DomModal } from "../ui/dom";
import { gameSocket } from "../network/socket";

interface PauseInit {
  pausedSceneKey: string;
}

export class PauseScene extends Phaser.Scene {
  private pausedSceneKey = "WorldScene";
  private modal?: DomModal;

  constructor() {
    super({ key: "PauseScene" });
  }

  init(data: PauseInit) {
    this.pausedSceneKey = data?.pausedSceneKey ?? "WorldScene";
  }

  create() {
    this.events.once("shutdown", () => {
      this.modal = undefined;
    });

    this.modal = openDomModal(this, {
      title: "Paused",
      width: 400,
      onClose: () => this.resume(),
    });

    const actions = el("div", "pixl-actions");
    actions.style.flexDirection = "column";
    actions.style.alignItems = "stretch";
    actions.style.gap = "8px";
    actions.style.marginTop = "20px";
    actions.style.width = "100%";

    const btns = [
      domBtn(this, "Resume", () => this.resume(), { big: true }),
      domBtn(this, "Settings", () => {
        this.scene.launch("SettingsScene", { from: "PauseScene" });
      }, { big: true }),
      domBtn(this, "Character", () => {
        this.scene.launch("CharacterScene", { from: "PauseScene" });
      }, { big: true }),
      domBtn(this, "Quit to Main Menu", () => this.quitToMenu(), { variant: "grey", big: true }),
    ];

    btns.forEach(b => b.style.width = "100%");

    btns[0].focus();

    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const idx = btns.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") {
        e.preventDefault();
        btns[(idx + 1) % btns.length].focus();
      } else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        btns[(idx - 1 + btns.length) % btns.length].focus();
      } else if (e.key === "Enter" || e.key === " ") {
        if (idx >= 0) btns[idx].click();
      }
    };
    window.addEventListener("keydown", onKey, true);
    this.events.once("shutdown", () => window.removeEventListener("keydown", onKey, true));

    actions.append(...btns);
    this.modal.body.append(actions);

    this.input.keyboard?.on("keydown-ESC", () => this.resume());
  }

  private resume() {
    this.scene.stop("SettingsScene");
    this.scene.resume(this.pausedSceneKey);
    this.scene.stop();
  }

  private quitToMenu() {
    this.scene.stop("SettingsScene");

    this.scene.stop("InteriorScene");
    this.scene.stop("WorldScene");
    gameSocket.disconnect();
    this.scene.start("MainMenuScene");
    this.scene.stop();
  }
}
