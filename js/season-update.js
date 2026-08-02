(function () {
  "use strict";

  const DAY_SECONDS = 60;
  const NIGHT_SECONDS = 60;
  const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS;
  const CYCLES_PER_SEASON = 3;
  const SEASON_SECONDS = CYCLE_SECONDS * CYCLES_PER_SEASON;
  const FULL_YEAR_SECONDS = SEASON_SECONDS * 4;
  const EARTH_PILL_COOLDOWN_SECONDS = 20;
  const PELLET_REFILL_THRESHOLD = 60;
  const PELLET_REFILL_AMOUNT = 50;
  const TRANSITION_SECONDS = 8;

  const SEASONS = Object.freeze([
    {
      id: "spring",
      name: "Spring",
      icon: "✦",
      accent: "#b8e7be"
    },
    {
      id: "summer",
      name: "Summer",
      icon: "☀",
      accent: "#ffd66b"
    },
    {
      id: "autumn",
      name: "Autumn",
      icon: "◆",
      accent: "#d89a57"
    },
    {
      id: "winter",
      name: "Winter",
      icon: "❄",
      accent: "#bfe9f4"
    }
  ]);

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let ui = null;
  let lastAnnouncedSeasonIndex = null;
  let announcementTimer = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function hash(value) {
    let x = Math.trunc(value) || 1;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967295;
  }

  function sharedElapsed() {
    const value = Number(
      window.PacmanLivingCity?.getSharedElapsed?.()
    );
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function getEnvironment() {
    const elapsed = sharedElapsed();
    const cycleSeconds =
      ((elapsed % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS;
    const cycleNumber = Math.floor(elapsed / CYCLE_SECONDS);
    const seasonIndex =
      Math.floor(cycleNumber / CYCLES_PER_SEASON) % SEASONS.length;
    const season = SEASONS[seasonIndex];

    let nightAmount = 0;

    if (
      cycleSeconds >= DAY_SECONDS - TRANSITION_SECONDS &&
      cycleSeconds < DAY_SECONDS
    ) {
      nightAmount = smoothstep(
        DAY_SECONDS - TRANSITION_SECONDS,
        DAY_SECONDS,
        cycleSeconds
      );
    } else if (
      cycleSeconds >= DAY_SECONDS &&
      cycleSeconds < CYCLE_SECONDS - TRANSITION_SECONDS
    ) {
      nightAmount = 1;
    } else if (cycleSeconds >= CYCLE_SECONDS - TRANSITION_SECONDS) {
      nightAmount =
        1 -
        smoothstep(
          CYCLE_SECONDS - TRANSITION_SECONDS,
          CYCLE_SECONDS,
          cycleSeconds
        );
    }

    const phase =
      cycleSeconds < DAY_SECONDS - TRANSITION_SECONDS
        ? "day"
        : cycleSeconds < DAY_SECONDS
          ? "dusk"
          : cycleSeconds < CYCLE_SECONDS - TRANSITION_SECONDS
            ? "night"
            : "dawn";

    const showerCycle = elapsed % 45;
    const showerAmount =
      season.id === "spring"
        ? smoothstep(10, 14, showerCycle) *
          (1 - smoothstep(28, 34, showerCycle))
        : 0;

    return {
      elapsed,
      cycleSeconds,
      cycleNumber,
      seasonIndex,
      season,
      seasonProgress:
        ((elapsed % SEASON_SECONDS) + SEASON_SECONDS) % SEASON_SECONDS /
        SEASON_SECONDS,
      yearProgress:
        ((elapsed % FULL_YEAR_SECONDS) + FULL_YEAR_SECONDS) %
        FULL_YEAR_SECONDS /
        FULL_YEAR_SECONDS,
      dayAmount: 1 - nightAmount,
      nightAmount,
      isNight: cycleSeconds >= DAY_SECONDS,
      phase,
      showerAmount
    };
  }

  function ensureUI() {
    if (ui) return ui;

    const board = document.querySelector("#gameShell .board-wrap");
    if (!board) return null;

    let seasonStatus = document.getElementById("seasonStatus");
    if (!seasonStatus) {
      seasonStatus = document.createElement("p");
      seasonStatus.id = "seasonStatus";
      seasonStatus.className = "season-status";
      seasonStatus.hidden = true;
      seasonStatus.setAttribute("aria-live", "polite");
      board.appendChild(seasonStatus);
    }

    let announcement = document.getElementById("seasonAnnouncement");
    if (!announcement) {
      announcement = document.createElement("div");
      announcement.id = "seasonAnnouncement";
      announcement.className = "season-announcement";
      announcement.setAttribute("aria-live", "polite");
      announcement.setAttribute("aria-atomic", "true");
      board.appendChild(announcement);
    }

    let danger = document.getElementById("dangerVignette");
    if (!danger) {
      danger = document.createElement("div");
      danger.id = "dangerVignette";
      danger.className = "danger-vignette";
      danger.dataset.level = "0";
      danger.setAttribute("aria-hidden", "true");
      board.appendChild(danger);
    }

    ui = { board, seasonStatus, announcement, danger };
    return ui;
  }

  function announceSeason(environment) {
    const elements = ensureUI();
    if (!elements) return;

    if (announcementTimer) {
      window.clearTimeout(announcementTimer);
      announcementTimer = null;
    }

    elements.announcement.textContent =
      `${environment.season.name.toUpperCase()} HAS ARRIVED`;
    elements.announcement.dataset.season = environment.season.id;
    elements.announcement.classList.remove("is-visible");

    window.requestAnimationFrame(() => {
      elements.announcement.classList.add("is-visible");
    });

    announcementTimer = window.setTimeout(() => {
      elements.announcement.classList.remove("is-visible");
    }, 2400);
  }

  function updateSeasonUI(environment) {
    const elements = ensureUI();
    if (!elements) return;

    const running = Boolean(window.ElementalPacman?.isRunning?.());
    elements.seasonStatus.hidden = !running;

    if (!running) {
      elements.board.dataset.season = "";
      return;
    }

    const phaseLabel =
      environment.phase === "dusk"
        ? "DUSK"
        : environment.phase === "dawn"
          ? "DAWN"
          : environment.isNight
            ? "NIGHT"
            : "DAY";

    elements.board.dataset.season = environment.season.id;
    elements.seasonStatus.dataset.season = environment.season.id;
    elements.seasonStatus.textContent =
      `${environment.season.icon} ${environment.season.name.toUpperCase()} · ${phaseLabel}`;

    if (lastAnnouncedSeasonIndex !== environment.seasonIndex) {
      lastAnnouncedSeasonIndex = environment.seasonIndex;
      announceSeason(environment);
    }
  }

  function updateDangerLevel(manager) {
    const elements = ensureUI();
    if (!elements || !manager?.creeps) return;

    const currentUserId =
      window.PacmanMultiplayer?.state?.user?.id || "local-player";

    const dangerCount = manager.creeps.filter(
      (creep) =>
        creep.alerted &&
        creep.targetUserId &&
        creep.targetUserId === currentUserId
    ).length;

    elements.danger.dataset.level =
      dangerCount >= 3 ? "3" : dangerCount >= 2 ? "2" : dangerCount >= 1 ? "1" : "0";
  }

  function clearSeasonUI() {
    const elements = ensureUI();
    if (!elements) return;

    elements.seasonStatus.hidden = true;
    elements.announcement.classList.remove("is-visible");
    elements.danger.dataset.level = "0";
    elements.board.dataset.season = "";
    lastAnnouncedSeasonIndex = null;
  }

  function installCitizenClock(map) {
    const routines = map?.citizenRoutines;
    if (!routines || routines.__pacSeasonClockInstalled) return;

    const originalDraw = routines.draw.bind(routines);

    routines.draw = function drawSeasonalCitizens(
      ctx,
      viewport,
      _legacyEnvironment
    ) {
      const environment = getEnvironment();

      originalDraw(ctx, viewport, {
        ...environment,
        // Existing citizen routes were authored for a 120-second daytime.
        // Doubling the new 60-second clock preserves those routines.
        cycleSeconds: environment.cycleSeconds * 2
      });
    };

    routines.__pacSeasonClockInstalled = true;
  }

  function drawSpringParticles(ctx, viewport, environment) {
    const { width, height } = viewport;
    const time = environment.elapsed;
    const reduced = reducedMotionQuery.matches;
    const petalCount = reduced ? 8 : 22;

    ctx.save();

    for (let index = 0; index < petalCount; index += 1) {
      const seed = hash(index * 997 + 41);
      const travel = reduced ? 0 : time * (10 + seed * 8);
      const x =
        ((seed * width + travel + index * 53) % (width + 80)) - 40;
      const y =
        ((hash(index * 733 + 19) * height +
          time * (8 + seed * 6) +
          index * 31) %
          (height + 80)) -
        40;

      ctx.globalAlpha = 0.18 + seed * 0.22;
      ctx.fillStyle = index % 3 === 0 ? "#f0d8eb" : "#d7e6c8";
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        2.2 + seed * 1.8,
        1.1 + seed,
        seed * Math.PI + time * 0.2,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    if (environment.showerAmount > 0.02) {
      const rainCount = reduced ? 18 : 48;
      ctx.strokeStyle =
        `rgba(178, 215, 229, ${0.12 + environment.showerAmount * 0.2})`;
      ctx.lineWidth = 1;

      for (let index = 0; index < rainCount; index += 1) {
        const seed = hash(index * 811 + 97);
        const x =
          ((seed * width + time * (170 + seed * 60)) % (width + 100)) -
          50;
        const y =
          ((hash(index * 577 + 13) * height +
            time * (280 + seed * 70)) %
            (height + 120)) -
          60;

        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
          x - 5 - seed * 4,
          y + 12 + environment.showerAmount * 10
        );
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawAutumnParticles(ctx, viewport, environment) {
    const { width, height } = viewport;
    const time = environment.elapsed;
    const reduced = reducedMotionQuery.matches;
    const count = reduced ? 8 : 24;
    const palette = ["#b76b34", "#d09443", "#7f4b2e", "#c8a04f"];

    ctx.save();

    for (let index = 0; index < count; index += 1) {
      const seed = hash(index * 1237 + 5);
      const wind = reduced ? 0 : time * (16 + seed * 14);
      const x =
        ((seed * width + wind + index * 61) % (width + 100)) - 50;
      const y =
        ((hash(index * 719 + 31) * height +
          time * (5 + seed * 6) +
          Math.sin(time * 0.8 + index) * 22) %
          (height + 90)) -
        45;

      ctx.globalAlpha = 0.2 + seed * 0.3;
      ctx.fillStyle = palette[index % palette.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(time * 0.55 + seed * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, -3.4);
      ctx.quadraticCurveTo(3.2, -0.5, 0.4, 3.5);
      ctx.quadraticCurveTo(-3.1, 0.7, 0, -3.4);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawWinterParticles(ctx, viewport, environment) {
    const { width, height } = viewport;
    const time = environment.elapsed;
    const reduced = reducedMotionQuery.matches;
    const count = reduced ? 14 : 38;

    ctx.save();

    for (let index = 0; index < count; index += 1) {
      const seed = hash(index * 929 + 71);
      const x =
        ((seed * width +
          (reduced ? 0 : Math.sin(time * 0.4 + index) * 24) +
          index * 47) %
          (width + 70)) -
        35;
      const y =
        ((hash(index * 557 + 43) * height +
          time * (10 + seed * 12) +
          index * 17) %
          (height + 80)) -
        40;

      ctx.globalAlpha = 0.18 + seed * 0.38;
      ctx.fillStyle = "#eef8fb";
      ctx.beginPath();
      ctx.arc(x, y, 1 + seed * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawSeasonParticles(ctx, viewport, environment) {
    if (environment.season.id === "spring") {
      drawSpringParticles(ctx, viewport, environment);
    } else if (environment.season.id === "autumn") {
      drawAutumnParticles(ctx, viewport, environment);
    } else if (environment.season.id === "winter") {
      drawWinterParticles(ctx, viewport, environment);
    }
  }

  function installMapSeasonRendering() {
    const MapClass = window.MazeMap;
    if (!MapClass?.prototype || MapClass.prototype.__pacSeasonInstalled) return;

    const prototype = MapClass.prototype;
    const originalDraw = prototype.draw;
    const originalAmbient = prototype.drawAmbientOverlay;
    const originalLights = prototype.drawLightEffects;
    const originalLampPost = prototype.drawLampPost;
    const originalGrass = prototype.drawGrassTile;
    const originalRoad = prototype.drawRoadTile;
    const originalWalkway = prototype.drawWalkwayTile;
    const originalLot = prototype.drawLot;

    prototype.drawAmbientOverlay = function drawSeasonAmbient(
      ctx,
      viewport,
      _legacyEnvironment
    ) {
      const environment = getEnvironment();

      if (typeof originalAmbient === "function") {
        originalAmbient.call(this, ctx, viewport, environment);
      }

      ctx.save();

      if (environment.season.id === "summer") {
        const sunlight = ctx.createLinearGradient(
          0,
          0,
          viewport.width,
          viewport.height
        );
        sunlight.addColorStop(
          0,
          `rgba(255, 226, 146, ${0.12 * environment.dayAmount})`
        );
        sunlight.addColorStop(
          0.5,
          `rgba(255, 206, 100, ${0.045 * environment.dayAmount})`
        );
        sunlight.addColorStop(1, "rgba(255, 206, 100, 0)");
        ctx.fillStyle = sunlight;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      } else if (environment.season.id === "autumn") {
        ctx.fillStyle =
          `rgba(107, 55, 31, ${0.055 + environment.nightAmount * 0.025})`;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      } else if (environment.season.id === "spring") {
        ctx.fillStyle =
          `rgba(126, 177, 153, ${0.035 + environment.showerAmount * 0.025})`;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      } else if (environment.season.id === "winter") {
        ctx.fillStyle =
          `rgba(191, 220, 230, ${0.07 + environment.dayAmount * 0.055})`;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      }

      ctx.restore();
    };

    prototype.drawLightEffects = function drawSeasonLights(
      ctx,
      viewport,
      _legacyEnvironment
    ) {
      if (typeof originalLights === "function") {
        originalLights.call(this, ctx, viewport, getEnvironment());
      }
    };

    prototype.drawLampPost = function drawSeasonLampPost(
      ctx,
      x,
      y,
      size,
      lightColor
    ) {
      const previous = this._livingEnvironment;
      this._livingEnvironment = getEnvironment();

      try {
        return originalLampPost.call(this, ctx, x, y, size, lightColor);
      } finally {
        this._livingEnvironment = previous;
      }
    };

    prototype.drawGrassTile = function drawSeasonGrass(
      ctx,
      x,
      y,
      size
    ) {
      originalGrass.call(this, ctx, x, y, size);
      const environment = getEnvironment();
      const px = x * size;
      const py = y * size;

      ctx.save();

      if (environment.season.id === "summer") {
        ctx.fillStyle = "rgba(30, 124, 47, 0.28)";
        ctx.fillRect(px, py, size + 0.5, size + 0.5);
      } else if (environment.season.id === "autumn") {
        ctx.fillStyle = "rgba(116, 73, 37, 0.34)";
        ctx.fillRect(px, py, size + 0.5, size + 0.5);
      } else if (environment.season.id === "spring") {
        ctx.fillStyle = "rgba(65, 139, 69, 0.18)";
        ctx.fillRect(px, py, size + 0.5, size + 0.5);

        if (hash(x * 137 + y * 271 + 17) > 0.86) {
          ctx.fillStyle = "rgba(224, 211, 232, 0.72)";
          ctx.beginPath();
          ctx.arc(
            px + size * 0.68,
            py + size * 0.34,
            Math.max(1, size * 0.025),
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      } else if (environment.season.id === "winter") {
        const snow = ctx.createLinearGradient(px, py, px, py + size);
        snow.addColorStop(0, "rgba(238, 247, 249, 0.9)");
        snow.addColorStop(1, "rgba(198, 218, 225, 0.82)");
        ctx.fillStyle = snow;
        ctx.fillRect(px, py, size + 0.5, size + 0.5);
      }

      ctx.restore();
    };

    prototype.drawRoadTile = function drawSeasonRoad(
      ctx,
      x,
      y,
      size,
      showLaneMarkings = true
    ) {
      originalRoad.call(this, ctx, x, y, size, showLaneMarkings);
      const environment = getEnvironment();
      const px = x * size;
      const py = y * size;

      ctx.save();

      if (
        environment.season.id === "spring" &&
        environment.showerAmount > 0.02
      ) {
        const reflection = ctx.createLinearGradient(
          px,
          py,
          px + size,
          py + size
        );
        reflection.addColorStop(
          0,
          `rgba(170, 215, 226, ${0.09 * environment.showerAmount})`
        );
        reflection.addColorStop(
          0.52,
          `rgba(225, 240, 244, ${0.16 * environment.showerAmount})`
        );
        reflection.addColorStop(1, "rgba(170, 215, 226, 0)");
        ctx.fillStyle = reflection;
        ctx.fillRect(px, py, size + 0.5, size + 0.5);
      } else if (environment.season.id === "winter") {
        ctx.fillStyle = "rgba(170, 194, 204, 0.18)";
        ctx.fillRect(px, py, size + 0.5, size + 0.5);
        ctx.fillStyle = "rgba(235, 244, 247, 0.2)";
        ctx.fillRect(px, py, size, Math.max(1, size * 0.05));
      }

      ctx.restore();
    };

    prototype.drawWalkwayTile = function drawSeasonWalkway(
      ctx,
      x,
      y,
      size
    ) {
      originalWalkway.call(this, ctx, x, y, size);
      const environment = getEnvironment();

      if (environment.season.id !== "winter") return;

      const px = x * size;
      const py = y * size;

      ctx.save();
      ctx.fillStyle = "rgba(226, 239, 243, 0.66)";
      ctx.fillRect(px, py, size + 0.5, size + 0.5);
      ctx.strokeStyle = "rgba(126, 157, 168, 0.18)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
      ctx.restore();
    };

    prototype.drawLot = function drawSeasonLot(
      ctx,
      lot,
      size,
      depthMode
    ) {
      originalLot.call(this, ctx, lot, size, depthMode);
      const environment = getEnvironment();
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;

      ctx.save();

      if (environment.season.id === "winter") {
        if (lot.kind === "park") {
          ctx.fillStyle = "rgba(229, 241, 244, 0.64)";
          ctx.fillRect(x, y, width, height);
        } else if (lot.kind !== "cone") {
          const inset = size * 0.12;
          const capHeight = Math.max(2, size * 0.12);
          const snow = ctx.createLinearGradient(
            x,
            y + inset,
            x,
            y + inset + capHeight * 2
          );
          snow.addColorStop(0, "rgba(250, 253, 253, 0.95)");
          snow.addColorStop(1, "rgba(201, 220, 227, 0.72)");
          ctx.fillStyle = snow;
          ctx.fillRect(
            x + inset,
            y + inset,
            Math.max(0, width - inset * 2),
            capHeight
          );

          ctx.fillStyle = "rgba(242, 249, 250, 0.72)";
          ctx.beginPath();
          ctx.arc(
            x + width * 0.25,
            y + inset + capHeight,
            capHeight * 0.55,
            0,
            Math.PI
          );
          ctx.arc(
            x + width * 0.68,
            y + inset + capHeight,
            capHeight * 0.7,
            0,
            Math.PI
          );
          ctx.fill();
        }
      } else if (environment.season.id === "autumn") {
        ctx.fillStyle = "rgba(101, 62, 34, 0.075)";
        ctx.fillRect(x, y, width, height);
      }

      ctx.restore();
    };

    prototype.draw = function drawSeasonalMap(
      ctx,
      viewport,
      depthMode = true
    ) {
      const environment = getEnvironment();
      this._pacSeasonEnvironment = environment;
      installCitizenClock(this);

      originalDraw.call(this, ctx, viewport, depthMode);
      drawSeasonParticles(ctx, viewport, environment);
      updateSeasonUI(environment);
    };

    prototype.__pacSeasonInstalled = true;
  }

  function captureCreepBase(creep) {
    if (creep.__pacSeasonBase) return creep.__pacSeasonBase;

    creep.__pacSeasonBase = {
      speed: Number(creep.profile?.speed) || 0,
      color: creep.profile?.color || "#ffffff",
      glow: creep.profile?.glow || "rgba(255,255,255,0.4)",
      sightRadius: Number(creep.sightRadius) || 4.05
    };

    return creep.__pacSeasonBase;
  }

  function applySeasonToCreep(creep) {
    if (!creep?.profile || creep.isElite) return;

    const base = captureCreepBase(creep);
    const seasonId = getEnvironment().season.id;

    creep.profile.speed = base.speed;
    creep.profile.color = base.color;
    creep.profile.glow = base.glow;
    creep.sightRadius = base.sightRadius;

    if (seasonId === "winter" && creep.element === "water") {
      creep.profile.speed = base.speed * 0.75;
      creep.profile.color = "#a7e2ef";
      creep.profile.glow = "rgba(173, 235, 247, 0.95)";
    } else if (seasonId === "summer" && creep.element === "fire") {
      creep.sightRadius = base.sightRadius + 1;
      creep.profile.glow = "rgba(255, 42, 42, 0.98)";
    } else if (seasonId === "autumn" && creep.element === "earth") {
      creep.profile.color = "#315f3b";
      creep.profile.glow = "rgba(64, 117, 70, 0.9)";
    } else if (
      seasonId === "spring" &&
      creep.element === "lightning"
    ) {
      creep.profile.speed = base.speed * 1.25;
      creep.profile.glow = "rgba(255, 239, 89, 0.96)";
    }
  }

  function drawSeasonalCreepAccent(creep, ctx, viewport, timeSeconds) {
    if (creep.isElite || !creep.isVisible?.(viewport)) return;

    const environment = getEnvironment();
    const { tileSize, offsetX, offsetY } = viewport;
    const cx = offsetX + (creep.x + 0.5) * tileSize;
    const cy = offsetY + (creep.y + 0.5) * tileSize;
    const radius = creep.radius * tileSize;

    ctx.save();

    if (environment.season.id === "winter" && creep.element === "water") {
      ctx.translate(cx, cy);
      ctx.strokeStyle = "rgba(218, 248, 255, 0.72)";
      ctx.lineWidth = Math.max(1, tileSize * 0.025);

      for (let index = 0; index < 3; index += 1) {
        const angle =
          timeSeconds * 0.35 +
          creep.animOffset +
          index * (Math.PI * 2 / 3);
        const x = Math.cos(angle) * radius * 1.12;
        const y = Math.sin(angle) * radius * 0.72;
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.12, y);
        ctx.lineTo(x, y - radius * 0.15);
        ctx.lineTo(x + radius * 0.12, y);
        ctx.lineTo(x, y + radius * 0.15);
        ctx.closePath();
        ctx.stroke();
      }
    } else if (
      environment.season.id === "spring" &&
      creep.element === "lightning"
    ) {
      ctx.strokeStyle = "rgba(255, 239, 98, 0.26)";
      ctx.lineWidth = Math.max(1, tileSize * 0.025);
      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        radius * (1.28 + Math.sin(timeSeconds * 7) * 0.07),
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  function consumeAutumnPowerUps(manager, elapsed) {
    if (getEnvironment().season.id !== "autumn") return;

    const powerUps = window.__pacSeasonPowerUps;
    if (!powerUps?.powerUps?.size) return;

    for (const creep of manager.creeps) {
      if (creep.isElite || creep.element !== "earth") continue;

      const readyAt = Number(creep.__pacSeasonAbilityReadyAt) || 0;
      if (elapsed < readyAt) continue;

      let eaten = null;

      for (const item of powerUps.powerUps.values()) {
        if (Math.hypot(item.x - creep.x, item.y - creep.y) < 0.52) {
          eaten = powerUps.removeById(item.id);
          break;
        }
      }

      if (!eaten) continue;

      creep.__pacSeasonAbilityReadyAt =
        elapsed + EARTH_PILL_COOLDOWN_SECONDS;

      window.PacmanWorldSync?.sendEvent?.({
        type: "powerup-collected",
        powerUpId: eaten.id,
        powerUpType: eaten.type,
        userId: null,
        eatenBy: "earth",
        creepId: creep.id
      });
    }
  }

  function installCreepSeasons() {
    const CreepClass = window.Creep;
    const ManagerClass = window.CreepManager;
    if (
      !CreepClass?.prototype ||
      !ManagerClass?.prototype ||
      CreepClass.prototype.__pacSeasonInstalled
    ) {
      return;
    }

    const creepPrototype = CreepClass.prototype;
    const managerPrototype = ManagerClass.prototype;

    const originalUpdate = creepPrototype.update;
    const originalDraw = creepPrototype.draw;
    const originalDrawEyes = creepPrototype.drawEyes;
    const originalNetworkState = creepPrototype.applyNetworkState;
    const originalSnapshotState = creepPrototype.applySnapshotState;
    const originalToSnapshot = creepPrototype.toSnapshot;

    creepPrototype.update = function updateSeasonalCreep(...args) {
      applySeasonToCreep(this);
      return originalUpdate.apply(this, args);
    };

    creepPrototype.applyNetworkState = function applySeasonNetworkState(
      state
    ) {
      const result = originalNetworkState.call(this, state);
      this.__pacSeasonAbilityReadyAt = Math.max(
        0,
        Number(state?.seasonAbilityReadyAt) || 0
      );
      applySeasonToCreep(this);
      return result;
    };

    creepPrototype.applySnapshotState = function applySeasonSnapshotState(
      state
    ) {
      const result = originalSnapshotState.call(this, state);
      this.__pacSeasonAbilityReadyAt = Math.max(
        0,
        Number(state?.seasonAbilityReadyAt) || 0
      );
      applySeasonToCreep(this);
      return result;
    };

    creepPrototype.toSnapshot = function toSeasonSnapshot() {
      return {
        ...originalToSnapshot.call(this),
        seasonAbilityReadyAt: Math.max(
          0,
          Number(this.__pacSeasonAbilityReadyAt) || 0
        )
      };
    };

    creepPrototype.drawEyes = function drawSeasonEyes(ctx, radius) {
      const environment = getEnvironment();

      if (
        !this.isElite &&
        this.element === "fire" &&
        environment.season.id === "summer"
      ) {
        ctx.save();
        ctx.shadowColor = "rgba(255, 24, 24, 0.98)";
        ctx.shadowBlur = radius * 0.72;
        originalDrawEyes.call(this, ctx, radius);
        ctx.restore();
        return;
      }

      originalDrawEyes.call(this, ctx, radius);
    };

    creepPrototype.draw = function drawSeasonCreep(
      ctx,
      viewport,
      timeSeconds
    ) {
      applySeasonToCreep(this);
      originalDraw.call(this, ctx, viewport, timeSeconds);
      drawSeasonalCreepAccent(this, ctx, viewport, timeSeconds);
    };

    const originalManagerUpdate = managerPrototype.update;
    const originalApplyFrame = managerPrototype.applyFrame;
    const originalApplySnapshot = managerPrototype.applySnapshot;

    managerPrototype.update = function updateSeasonManager(
      dt,
      players,
      elapsed,
      pellets
    ) {
      const result = originalManagerUpdate.call(
        this,
        dt,
        players,
        elapsed,
        pellets
      );
      consumeAutumnPowerUps(this, elapsed);
      updateDangerLevel(this);
      return result;
    };

    managerPrototype.applyFrame = function applySeasonFrame(states) {
      const result = originalApplyFrame.call(this, states);
      this.creeps.forEach(applySeasonToCreep);
      updateDangerLevel(this);
      return result;
    };

    managerPrototype.applySnapshot = function applySeasonSnapshot(states) {
      const result = originalApplySnapshot.call(this, states);
      this.creeps.forEach(applySeasonToCreep);
      updateDangerLevel(this);
      return result;
    };

    creepPrototype.__pacSeasonInstalled = true;
  }

  function installPowerUpRegistration() {
    const BasePowerUpManager = window.PowerUpManager;
    if (
      !BasePowerUpManager ||
      BasePowerUpManager.__pacSeasonRegistered
    ) {
      return;
    }

    class SeasonalPowerUpManager extends BasePowerUpManager {
      constructor(...args) {
        super(...args);
        window.__pacSeasonPowerUps = this;
      }

      reset(...args) {
        const result = super.reset(...args);
        window.__pacSeasonPowerUps = this;
        return result;
      }
    }

    SeasonalPowerUpManager.__pacSeasonRegistered = true;
    window.PowerUpManager = SeasonalPowerUpManager;
  }

  function installPelletRefill() {
    const PelletClass = window.PelletManager;
    if (
      !PelletClass?.prototype ||
      PelletClass.prototype.__pacSeasonRefillInstalled
    ) {
      return;
    }

    const originalSpawn = PelletClass.prototype.spawn;

    PelletClass.prototype.spawn = function spawnSeasonalPellets(
      count,
      exclusions = []
    ) {
      let requested = Math.max(0, Number(count) || 0);

      if (
        requested > 0 &&
        requested <= 10 &&
        window.ElementalPacman?.isRunning?.()
      ) {
        requested =
          this.count < PELLET_REFILL_THRESHOLD
            ? PELLET_REFILL_AMOUNT
            : 0;
      }

      return originalSpawn.call(this, requested, exclusions);
    };

    PelletClass.prototype.__pacSeasonRefillInstalled = true;
  }

  installPowerUpRegistration();
  installPelletRefill();
  installCreepSeasons();
  installMapSeasonRendering();
  ensureUI();

  document.addEventListener("pacman:room-started", () => {
    lastAnnouncedSeasonIndex = null;
  });

  document.addEventListener("pacman:room-left", clearSeasonUI);
  document.addEventListener("pacman:room-closed", clearSeasonUI);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      updateSeasonUI(getEnvironment());
    }
  });

  window.PacmanSeasons = Object.freeze({
    getEnvironment,
    seasons: SEASONS,
    daySeconds: DAY_SECONDS,
    nightSeconds: NIGHT_SECONDS,
    cyclesPerSeason: CYCLES_PER_SEASON,
    pelletRefillThreshold: PELLET_REFILL_THRESHOLD,
    pelletRefillAmount: PELLET_REFILL_AMOUNT
  });
})();
