(function () {
  "use strict";

  const ROUND_RESTART_COOLDOWN_MS = 5000;

  const TYPES = Object.freeze({
    shield: {
      color: "#d72f3f",
      glow: "rgba(225, 52, 69, 0.85)",
      label: "Shield"
    },
    rush: {
      color: "#2f79db",
      glow: "rgba(59, 135, 235, 0.85)",
      label: "Rush"
    },
    hunter: {
      color: "#11151b",
      glow: "rgba(211, 219, 228, 0.72)",
      label: "Hunter"
    }
  });

  const roundOverview = {
    active: false,
    viewport: null,
    normalTileSize: null
  };

  let restartCooldownTimer = null;

  function enableRoundOverview() {
    roundOverview.active = true;
  }

  function disableRoundOverview() {
    roundOverview.active = false;

    if (roundOverview.viewport && Number.isFinite(roundOverview.normalTileSize)) {
      roundOverview.viewport.tileSize = roundOverview.normalTileSize;
    }

    roundOverview.viewport = null;
    roundOverview.normalTileSize = null;
  }

  function installMapOverviewHook() {
    const prototype = window.MazeMap?.prototype;
    if (!prototype || prototype.__pacRoundOverviewInstalled) return;

    const originalDraw = prototype.draw;
    if (typeof originalDraw !== "function") return;

    prototype.draw = function drawWithRoundOverview(ctx, viewport, depthMode) {
      if (roundOverview.active && viewport) {
        if (roundOverview.viewport !== viewport) {
          roundOverview.viewport = viewport;
          roundOverview.normalTileSize = viewport.tileSize;
        }

        const padding = Math.max(
          10,
          Math.min(viewport.width, viewport.height) * 0.025
        );
        const portrait = viewport.height > viewport.width * 1.12;

        // In portrait layouts, reserve the lower part of the board for the
        // result panel. The complete live city is fitted into the open area
        // above it, rather than being centred underneath the dialog.
        const panelReserve = portrait
          ? Math.min(viewport.height * 0.44, 520)
          : Math.min(viewport.height * 0.16, 120);
        const mapTop = padding;
        const mapBottom = Math.max(
          mapTop + 1,
          viewport.height - panelReserve - padding
        );
        const usableWidth = Math.max(1, viewport.width - padding * 2);
        const usableHeight = Math.max(1, mapBottom - mapTop);
        const overviewTileSize = Math.max(
          4,
          Math.min(usableWidth / this.cols, usableHeight / this.rows)
        );
        const mapWidth = this.cols * overviewTileSize;
        const mapHeight = this.rows * overviewTileSize;

        viewport.tileSize = overviewTileSize;
        viewport.offsetX = (viewport.width - mapWidth) * 0.5;
        viewport.offsetY = mapTop + (usableHeight - mapHeight) * 0.5;
      }

      return originalDraw.call(this, ctx, viewport, depthMode);
    };

    Object.defineProperty(prototype, "__pacRoundOverviewInstalled", {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `pill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function tileKey(x, y) {
    return `${Math.round(x)},${Math.round(y)}`;
  }

  function capsulePath(ctx, halfLength, radius) {
    ctx.beginPath();
    ctx.moveTo(-halfLength + radius, -radius);
    ctx.lineTo(halfLength - radius, -radius);
    ctx.arc(halfLength - radius, 0, radius, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(-halfLength + radius, radius);
    ctx.arc(-halfLength + radius, 0, radius, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  }

  class PowerUpManager {
    constructor(map) {
      this.map = map;
      this.powerUps = new Map();
      this.maxActive = 6;
    }

    reset(map) {
      this.map = map;
      this.powerUps.clear();
    }

    addPowerUp(powerUp) {
      const x = Number(powerUp?.x);
      const y = Number(powerUp?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

      const type = TYPES[powerUp.type] ? powerUp.type : "shield";
      const id = String(powerUp.id || createId());

      this.powerUps.set(id, {
        id,
        type,
        x,
        y,
        phase: Number.isFinite(Number(powerUp.phase))
          ? Number(powerUp.phase)
          : Math.random() * Math.PI * 2
      });
      return true;
    }

    addMany(powerUps = []) {
      (Array.isArray(powerUps) ? powerUps : []).forEach((item) =>
        this.addPowerUp(item)
      );
    }

    removeById(id) {
      const key = String(id || "");
      const item = this.powerUps.get(key) || null;
      if (item) this.powerUps.delete(key);
      return item ? { ...item } : null;
    }

    toSnapshot() {
      return Array.from(this.powerUps.values(), (item) => ({ ...item }));
    }

    applySnapshot(powerUps = []) {
      this.powerUps.clear();
      this.addMany(powerUps);
    }

    randomType() {
      const roll = Math.random();
      if (roll < 0.4) return "rush";
      if (roll < 0.75) return "shield";
      return "hunter";
    }

    findSpawnTile(exclusions = []) {
      const blocked = new Set(
        exclusions
          .filter((item) => Number.isFinite(Number(item?.x)) && Number.isFinite(Number(item?.y)))
          .map((item) => tileKey(item.x, item.y))
      );

      this.powerUps.forEach((item) => blocked.add(tileKey(item.x, item.y)));

      const centre = this.map.getStartTile();
      const candidates = this.map.getFloorTiles().filter((tile) => {
        if (blocked.has(tileKey(tile.x, tile.y))) return false;
        if (Math.hypot(tile.x - centre.x, tile.y - centre.y) < 3.5) return false;
        return true;
      });

      if (!candidates.length) return null;
      return candidates[Math.floor(Math.random() * candidates.length)] || null;
    }

    spawnType(type, exclusions = []) {
      if (this.powerUps.size >= this.maxActive) return null;
      const tile = this.findSpawnTile(exclusions);
      if (!tile) return null;

      const item = {
        id: createId(),
        type: TYPES[type] ? type : this.randomType(),
        x: tile.x,
        y: tile.y,
        phase: Math.random() * Math.PI * 2
      };

      this.powerUps.set(item.id, item);
      return { ...item };
    }

    spawnInitial(exclusions = []) {
      const created = [];
      ["shield", "rush", "hunter"].forEach((type) => {
        const item = this.spawnType(type, exclusions.concat(created));
        if (item) created.push(item);
      });
      return created;
    }

    spawnRandom(exclusions = []) {
      return this.spawnType(this.randomType(), exclusions);
    }

    collectForActors(actors = []) {
      const pickups = [];

      for (const item of Array.from(this.powerUps.values())) {
        let collector = null;
        let nearest = Infinity;

        for (const actor of actors) {
          if (!actor?.userId || actor.alive === false) continue;
          const distance = Math.hypot(item.x - actor.x, item.y - actor.y);
          if (distance < 0.52 && distance < nearest) {
            nearest = distance;
            collector = actor;
          }
        }

        if (!collector) continue;
        this.powerUps.delete(item.id);
        pickups.push({
          powerUp: { ...item },
          userId: collector.userId
        });
      }

      return pickups;
    }

    isVisible(item, viewport, padding = 1) {
      const sx = viewport.offsetX + (item.x + 0.5) * viewport.tileSize;
      const sy = viewport.offsetY + (item.y + 0.5) * viewport.tileSize;
      const pad = viewport.tileSize * padding;
      return (
        sx >= -pad &&
        sx <= viewport.width + pad &&
        sy >= -pad &&
        sy <= viewport.height + pad
      );
    }

    draw(ctx, viewport, timeSeconds) {
      const { tileSize, offsetX, offsetY } = viewport;
      const pelletRadius = tileSize * 0.085;
      const pillRadius = pelletRadius + 0.5;
      const halfLength = pillRadius * 1.72;

      this.powerUps.forEach((item) => {
        if (!this.isVisible(item, viewport)) return;
        const type = TYPES[item.type] || TYPES.shield;
        const cx = offsetX + (item.x + 0.5) * tileSize;
        const cy = offsetY + (item.y + 0.5) * tileSize;
        const angle = timeSeconds * 0.78 + item.phase;
        const bob = Math.sin(timeSeconds * 2.7 + item.phase) * tileSize * 0.035;
        const rollScale = 0.84 + Math.cos(timeSeconds * 1.7 + item.phase) * 0.08;

        ctx.save();
        ctx.translate(cx, cy + bob);
        ctx.rotate(angle);
        ctx.scale(1, rollScale);
        ctx.shadowColor = type.glow;
        ctx.shadowBlur = tileSize * 0.28;

        capsulePath(ctx, halfLength, pillRadius);
        ctx.save();
        ctx.clip();

        const leftGradient = ctx.createLinearGradient(
          -halfLength,
          -pillRadius,
          0,
          pillRadius
        );
        leftGradient.addColorStop(0, "rgba(255,255,255,0.44)");
        leftGradient.addColorStop(0.2, type.color);
        leftGradient.addColorStop(1, "rgba(0,0,0,0.76)");
        ctx.fillStyle = leftGradient;
        ctx.fillRect(-halfLength, -pillRadius, halfLength, pillRadius * 2);

        const whiteGradient = ctx.createLinearGradient(
          0,
          -pillRadius,
          halfLength,
          pillRadius
        );
        whiteGradient.addColorStop(0, "#ffffff");
        whiteGradient.addColorStop(0.46, "#e9edf1");
        whiteGradient.addColorStop(1, "#8d959e");
        ctx.fillStyle = whiteGradient;
        ctx.fillRect(0, -pillRadius, halfLength, pillRadius * 2);

        const shine = ctx.createLinearGradient(0, -pillRadius, 0, pillRadius);
        shine.addColorStop(0, "rgba(255,255,255,0.68)");
        shine.addColorStop(0.42, "rgba(255,255,255,0.08)");
        shine.addColorStop(1, "rgba(0,0,0,0.42)");
        ctx.fillStyle = shine;
        ctx.fillRect(-halfLength, -pillRadius, halfLength * 2, pillRadius * 2);
        ctx.restore();

        ctx.shadowBlur = 0;
        capsulePath(ctx, halfLength, pillRadius);
        ctx.strokeStyle = "rgba(244,248,252,0.86)";
        ctx.lineWidth = Math.max(1, tileSize * 0.026);
        ctx.stroke();

        ctx.strokeStyle = "rgba(28,33,39,0.48)";
        ctx.lineWidth = Math.max(1, tileSize * 0.018);
        ctx.beginPath();
        ctx.moveTo(0, -pillRadius * 0.86);
        ctx.lineTo(0, pillRadius * 0.86);
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.beginPath();
        ctx.ellipse(
          -halfLength * 0.45,
          -pillRadius * 0.42,
          halfLength * 0.25,
          Math.max(1, pillRadius * 0.14),
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.restore();
      });
    }

    get count() {
      return this.powerUps.size;
    }
  }

  function stopRestartCooldown(button, resetButton = true) {
    if (restartCooldownTimer) {
      window.clearInterval(restartCooldownTimer);
      restartCooldownTimer = null;
    }

    if (!button || !resetButton) return;
    button.disabled = false;
    button.textContent = "Continue";
    button.classList.remove("is-cooling", "is-ready");
    button.removeAttribute("aria-disabled");
  }

  function startRestartCooldown(button, cooldownMs = ROUND_RESTART_COOLDOWN_MS) {
    stopRestartCooldown(button, false);

    const duration = Math.max(0, Number(cooldownMs) || 0);
    const availableAt = Date.now() + duration;

    button.disabled = true;
    button.classList.add("is-cooling");
    button.classList.remove("is-ready");
    button.setAttribute("aria-disabled", "true");

    const updateButton = () => {
      const remainingMs = Math.max(0, availableAt - Date.now());

      if (remainingMs <= 0) {
        stopRestartCooldown(button, false);
        button.disabled = false;
        button.textContent = "Continue";
        button.classList.remove("is-cooling");
        button.classList.add("is-ready");
        button.removeAttribute("aria-disabled");
        button.focus({ preventScroll: true });
        return;
      }

      button.textContent = `Continue (${Math.ceil(remainingMs / 1000)})`;
    };

    updateButton();
    restartCooldownTimer = window.setInterval(updateButton, 150);
  }

  function ensureUI() {
    const gameShell = document.getElementById("gameShell");
    const boardWrap = document.querySelector("#gameShell .board-wrap");
    if (!gameShell || !boardWrap) return null;

    let hud = document.getElementById("powerupHud");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "powerupHud";
      hud.className = "powerup-hud";
      hud.setAttribute("aria-label", "Power-up inventory");
      hud.innerHTML = `
        <span class="powerup-hud__item" title="Shield charges">
          <i class="mini-pill mini-pill--shield" aria-hidden="true"></i>
          <b id="shieldPowerValue">0</b>
        </span>
        <span class="powerup-hud__item" title="Rush time remaining">
          <i class="mini-pill mini-pill--rush" aria-hidden="true"></i>
          <b id="rushPowerValue">0.0s</b>
        </span>
        <span class="powerup-hud__item" title="Ghost-eating charges">
          <i class="mini-pill mini-pill--hunter" aria-hidden="true"></i>
          <b id="hunterPowerValue">0</b>
        </span>
      `;
      boardWrap.appendChild(hud);
    }

    let result = document.getElementById("roundResultOverlay");
    if (!result) {
      result = document.createElement("div");
      result.id = "roundResultOverlay";
      result.className = "round-result hidden";
      result.setAttribute("role", "dialog");
      result.setAttribute("aria-modal", "true");
      result.setAttribute("aria-labelledby", "roundResultTitle");
      result.innerHTML = `
        <div class="round-result__panel" tabindex="-1">
          <h2 id="roundResultTitle">Game Over</h2>
          <div class="score-stage" aria-label="Round score">
            <div class="score-cube" id="roundScoreCube">
              <div class="score-cube__face score-cube__front">
                <span>ROUND SCORE</span><strong class="round-score-value">0</strong>
              </div>
              <div class="score-cube__face score-cube__back">
                <span>ROUND SCORE</span><strong class="round-score-value">0</strong>
              </div>
              <div class="score-cube__side score-cube__left"></div>
              <div class="score-cube__side score-cube__right"></div>
              <div class="score-cube__side score-cube__top"></div>
              <div class="score-cube__side score-cube__bottom"></div>
            </div>
          </div>
          <p class="round-result__note">Continue 😁 or Exit? 🙁</p>
          <div class="round-result__actions">
            <button id="restartRoundButton" type="button">Continue</button>
            <button id="exitRoundButton" type="button">Exit</button>
          </div>
        </div>
      `;
      boardWrap.appendChild(result);

      result.querySelector("#restartRoundButton").addEventListener("click", (event) => {
        const button = event.currentTarget;
        if (button.disabled) return;

        button.disabled = true;
        button.textContent = "Continuing…";
        button.classList.remove("is-ready");
        button.classList.add("is-cooling");
        button.setAttribute("aria-disabled", "true");

        document.dispatchEvent(new CustomEvent("pacman:restart-round-requested"));
      });
      result.querySelector("#exitRoundButton").addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("pacman:exit-round-requested"));
      });
    }

    return {
      hud,
      result,
      panel: result.querySelector(".round-result__panel"),
      restart: result.querySelector("#restartRoundButton"),
      shield: document.getElementById("shieldPowerValue"),
      rush: document.getElementById("rushPowerValue"),
      hunter: document.getElementById("hunterPowerValue")
    };
  }

  installMapOverviewHook();
  const ui = ensureUI();

  window.PacmanPowerUpsUI = Object.freeze({
    update(powerState = {}, elapsed = 0) {
      if (!ui) return;
      ui.shield.textContent = String(Math.max(0, Number(powerState.shield) || 0));
      ui.hunter.textContent = String(Math.max(0, Number(powerState.hunter) || 0));
      ui.rush.textContent = `${Math.max(0, (Number(powerState.rushUntil) || 0) - elapsed).toFixed(1)}s`;
    },
    showRoundOver(score) {
      if (!ui) return;
      ui.result.querySelectorAll(".round-score-value").forEach((node) => {
        node.textContent = Number(score || 0).toLocaleString();
      });

      enableRoundOverview();
      ui.result.classList.remove("hidden");
      startRestartCooldown(ui.restart);
      ui.panel?.focus({ preventScroll: true });
    },
    hideRoundOver() {
      if (!ui) return;
      stopRestartCooldown(ui.restart);
      disableRoundOverview();
      ui.result.classList.add("hidden");
    }
  });

  window.PowerUpManager = PowerUpManager;
  window.PACMAN_POWERUP_TYPES = TYPES;
})();
