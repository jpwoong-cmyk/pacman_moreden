(function () {
  "use strict";

  const ELEMENTS = {
    fire: {
      name: "Fire",
      color: "#ff4f2d",
      glow: "rgba(255, 79, 45, 0.85)",
      speed: 4.15,
      behavior: "chase"
    },
    water: {
      name: "Water",
      color: "#3aa6ff",
      glow: "rgba(58, 166, 255, 0.85)",
      speed: 3.8,
      behavior: "predict"
    },
    lightning: {
      name: "Lightning",
      color: "#f5df3f",
      glow: "rgba(245, 223, 63, 0.88)",
      speed: 4.65,
      behavior: "erratic"
    },
    earth: {
      name: "Earth",
      color: "#77c95a",
      glow: "rgba(119, 201, 90, 0.82)",
      speed: 3.35,
      behavior: "intercept"
    },
    shadow: {
      name: "Shadow",
      color: "#0f1217",
      glow: "rgba(98, 103, 122, 0.95)",
      speed: 4.2,
      behavior: "chase"
    }
  };

  const ELITE_TYPES = ["speed", "sight", "eater"];
  const ELITE_BEHAVIORS = ["chase", "predict", "erratic", "intercept"];

  const CHASE_SIGHT_RADIUS = 16;
  const CHASE_SPEED_MULTIPLIER = 1.12;
  const CHASE_ACCELERATION_SECONDS = 0.4;
  const CHASE_DECELERATION_SECONDS = 0.6;
  const NORMAL_GHOST_SPEED_CAP = 5.75;

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `creep-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  class Creep {
    constructor(element, tile, map, options = {}) {
      this.id = options.id || createId();
      this.element = element;
      this.isElite = Boolean(options.isElite);
      this.eliteType = options.eliteType || null;
      this.profile = this.buildProfile(element, options);
      this.behavior = options.behavior || this.profile.behavior;
      this.x = Number(tile.x) || 0;
      this.y = Number(tile.y) || 0;
      this.dir = { x: 0, y: 0 };
      this.radius = this.isElite ? 0.36 : 0.34;
      this.sightRadius =
        this.isElite && this.eliteType === "sight" ? 6.1 : 4.05;
      this.canEatPellets = this.isElite && this.eliteType === "eater";
      this.alerted = false;
      this.targetUserId = null;
      this.chaseSpeedMultiplier = 1;
      this.animOffset = Number.isFinite(Number(options.animOffset))
        ? Number(options.animOffset)
        : Math.random() * Math.PI * 2;
      this.networkTargetX = this.x;
      this.networkTargetY = this.y;
      this.hasNetworkState = false;
      this.chooseDirection(map, null, true, 0);
    }

    buildProfile(element, options) {
      const base = { ...(ELEMENTS[element] || ELEMENTS.fire) };
      if (!options.isElite) return base;

      const profile = {
        ...ELEMENTS.shadow,
        behavior: options.behavior || randomItem(ELITE_BEHAVIORS)
      };

      if (options.eliteType === "speed") {
        profile.speed = 5.55;
        profile.glow = "rgba(146, 149, 176, 0.95)";
      } else if (options.eliteType === "sight") {
        profile.speed = 4.35;
        profile.glow = "rgba(116, 118, 150, 0.95)";
      } else if (options.eliteType === "eater") {
        profile.speed = 4.25;
        profile.glow = "rgba(169, 134, 84, 0.95)";
      }

      return profile;
    }

    visibleTarget(map, players = []) {
      const livingPlayers = players.filter(
        (player) => player?.alive !== false
      );

      /*
       * An alerted creep keeps tracking the same player while there is a
       * clear line of sight. The longer chase radius prevents it from giving
       * up halfway down a straight road, but a corner breaks the chase.
       */
      if (this.alerted && this.targetUserId) {
        const trackedPlayer = livingPlayers.find(
          (player) => player.userId === this.targetUserId
        );

        if (
          trackedPlayer &&
          map.hasLineOfSight(
            this.x,
            this.y,
            trackedPlayer.x,
            trackedPlayer.y,
            CHASE_SIGHT_RADIUS
          )
        ) {
          return trackedPlayer;
        }
      }

      /*
       * Calm creeps use their normal elemental or elite awareness radius to
       * acquire the nearest visible player.
       */
      const visible = livingPlayers
        .filter((player) =>
          map.hasLineOfSight(
            this.x,
            this.y,
            player.x,
            player.y,
            this.sightRadius
          )
        )
        .map((player) => ({
          player,
          distance: Math.hypot(player.x - this.x, player.y - this.y)
        }))
        .sort((a, b) => a.distance - b.distance);

      return visible[0]?.player || null;
    }

    updateChaseSpeed(dt, chasing) {
      const targetMultiplier = chasing
        ? CHASE_SPEED_MULTIPLIER
        : 1;
      const transitionSeconds = chasing
        ? CHASE_ACCELERATION_SECONDS
        : CHASE_DECELERATION_SECONDS;
      const maximumChange =
        (CHASE_SPEED_MULTIPLIER - 1) *
        (dt / Math.max(0.01, transitionSeconds));

      if (this.chaseSpeedMultiplier < targetMultiplier) {
        this.chaseSpeedMultiplier = Math.min(
          targetMultiplier,
          this.chaseSpeedMultiplier + maximumChange
        );
      } else if (this.chaseSpeedMultiplier > targetMultiplier) {
        this.chaseSpeedMultiplier = Math.max(
          targetMultiplier,
          this.chaseSpeedMultiplier - maximumChange
        );
      }
    }

    update(dt, map, players, elapsed, pellets) {
      let target = this.visibleTarget(map, players);
      this.alerted = Boolean(target);
      this.targetUserId = target?.userId || null;

      this.updateChaseSpeed(dt, this.alerted);

      const baseMovementSpeed =
        Math.max(0, Number(this.profile.speed) || 0);
      const acceleratedSpeed =
        baseMovementSpeed * this.chaseSpeedMultiplier;
      const movementSpeed = this.isElite
        ? acceleratedSpeed
        : Math.min(acceleratedSpeed, NORMAL_GHOST_SPEED_CAP);

      let remaining = movementSpeed * dt;
      let safety = 0;

      while (remaining > 0.0001 && safety < 7) {
        safety += 1;
        const centerX = Math.round(this.x);
        const centerY = Math.round(this.y);
        const atCenter =
          Math.abs(this.x - centerX) < 0.0001 &&
          Math.abs(this.y - centerY) < 0.0001;

        if (atCenter) {
          this.x = centerX;
          this.y = centerY;
          target = this.visibleTarget(map, players);
          this.alerted = Boolean(target);
          this.targetUserId = target?.userId || null;
          this.chooseDirection(map, target, false, elapsed);
        }

        if (this.dir.x === 0 && this.dir.y === 0) break;

        const distanceToCenter = this.distanceToNextCenter();
        const step = Math.min(remaining, distanceToCenter);
        this.x += this.dir.x * step;
        this.y += this.dir.y * step;
        remaining -= step;

        if (Math.abs(step - distanceToCenter) < 0.0001) {
          this.x = Math.round(this.x);
          this.y = Math.round(this.y);

          if (this.canEatPellets && pellets) {
            pellets.removeAt(this.x, this.y, 0.48);
          }
        }
      }

      if (this.canEatPellets && pellets) {
        pellets.removeAt(this.x, this.y, 0.46);
      }
    }

    applyNetworkState(state) {
      const x = Number(state?.x);
      const y = Number(state?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      this.networkTargetX = x;
      this.networkTargetY = y;
      this.dir = {
        x: Number(state.dirX) || 0,
        y: Number(state.dirY) || 0
      };
      this.alerted = Boolean(state.alerted);
      this.targetUserId = state.targetUserId || null;
      this.chaseSpeedMultiplier = Math.max(
        1,
        Math.min(
          CHASE_SPEED_MULTIPLIER,
          Number(state.chaseSpeedMultiplier) || 1
        )
      );

      if (
        !this.hasNetworkState ||
        Math.hypot(this.x - x, this.y - y) > 3
      ) {
        this.x = x;
        this.y = y;
      }

      this.hasNetworkState = true;
    }

    updateNetwork(dt) {
      if (!this.hasNetworkState) return;

      const distance = Math.hypot(
        this.networkTargetX - this.x,
        this.networkTargetY - this.y
      );
      const smoothing = 1 - Math.exp(-18 * dt);

      if (distance > 2.5) {
        this.x = this.networkTargetX;
        this.y = this.networkTargetY;
      } else {
        this.x += (this.networkTargetX - this.x) * smoothing;
        this.y += (this.networkTargetY - this.y) * smoothing;
      }
    }

    applySnapshotState(state) {
      this.x = Number(state.x) || 0;
      this.y = Number(state.y) || 0;
      this.networkTargetX = this.x;
      this.networkTargetY = this.y;
      this.dir = {
        x: Number(state.dirX) || 0,
        y: Number(state.dirY) || 0
      };
      this.alerted = Boolean(state.alerted);
      this.targetUserId = state.targetUserId || null;
      this.chaseSpeedMultiplier = Math.max(
        1,
        Math.min(
          CHASE_SPEED_MULTIPLIER,
          Number(state.chaseSpeedMultiplier) || 1
        )
      );
      this.hasNetworkState = true;
    }

    toSnapshot() {
      return {
        id: this.id,
        element: this.element,
        x: Number(this.x.toFixed(4)),
        y: Number(this.y.toFixed(4)),
        dirX: this.dir.x,
        dirY: this.dir.y,
        isElite: this.isElite,
        eliteType: this.eliteType,
        behavior: this.behavior,
        alerted: this.alerted,
        targetUserId: this.targetUserId,
        chaseSpeedMultiplier: Number(
          this.chaseSpeedMultiplier.toFixed(4)
        ),
        animOffset: this.animOffset
      };
    }

    distanceToNextCenter() {
      if (this.dir.x > 0) {
        return Math.floor(this.x + 0.0001) + 1 - this.x;
      }
      if (this.dir.x < 0) {
        return this.x - (Math.ceil(this.x - 0.0001) - 1);
      }
      if (this.dir.y > 0) {
        return Math.floor(this.y + 0.0001) + 1 - this.y;
      }
      if (this.dir.y < 0) {
        return this.y - (Math.ceil(this.y - 0.0001) - 1);
      }
      return 0;
    }

    chooseDirection(map, target, initial = false, elapsed = 0) {
      const tx = Math.round(this.x);
      const ty = Math.round(this.y);
      let options = map.walkableNeighbors(tx, ty).map((tile) => ({
        x: tile.x - tx,
        y: tile.y - ty,
        tile
      }));

      if (!initial && options.length > 1) {
        const reverse = { x: -this.dir.x, y: -this.dir.y };
        const withoutReverse = options.filter(
          (option) =>
            option.x !== reverse.x || option.y !== reverse.y
        );
        if (withoutReverse.length) options = withoutReverse;
      }

      if (!options.length) {
        this.dir = { x: -this.dir.x, y: -this.dir.y };
        return;
      }

      if (initial || !target || !this.alerted) {
        this.chooseRoamingDirection(options);
        return;
      }

      const targetTile = this.getTarget(target, map, elapsed);
      const scored = options.map((option) => ({
        option,
        score: this.pathDistance(map, option.tile, targetTile)
      }));

      if (this.behavior === "erratic" && Math.random() < 0.34) {
        const random = options[Math.floor(Math.random() * options.length)];
        this.dir = { x: random.x, y: random.y };
        return;
      }

      scored.sort((a, b) => a.score - b.score || Math.random() - 0.5);
      this.dir = {
        x: scored[0].option.x,
        y: scored[0].option.y
      };
    }

    chooseRoamingDirection(options) {
      const forward = options.find(
        (option) =>
          option.x === this.dir.x && option.y === this.dir.y
      );

      if (forward && Math.random() < 0.62) {
        this.dir = { x: forward.x, y: forward.y };
        return;
      }

      const random = options[Math.floor(Math.random() * options.length)];
      this.dir = { x: random.x, y: random.y };
    }

    getTarget(player, map, elapsed) {
      const px = Math.round(player.x);
      const py = Math.round(player.y);
      const dir = player.dir || { x: 0, y: 0 };

      if (this.behavior === "predict") {
        return map.findNearestFloor(px + dir.x * 2, py + dir.y * 2);
      }

      if (this.behavior === "intercept") {
        const pulse = Math.floor(elapsed * 2) % 2;
        return pulse === 0
          ? map.findNearestFloor(px, py)
          : map.findNearestFloor(px + dir.x, py + dir.y);
      }

      return map.findNearestFloor(px, py);
    }

    pathDistance(map, start, target) {
      if (start.x === target.x && start.y === target.y) return 0;

      const queue = [{ x: start.x, y: start.y, d: 0 }];
      const visited = new Set([`${start.x},${start.y}`]);

      while (queue.length) {
        const current = queue.shift();

        for (const neighbor of map.walkableNeighbors(current.x, current.y)) {
          const key = `${neighbor.x},${neighbor.y}`;
          if (visited.has(key)) continue;
          if (neighbor.x === target.x && neighbor.y === target.y) {
            return current.d + 1;
          }

          visited.add(key);
          queue.push({ x: neighbor.x, y: neighbor.y, d: current.d + 1 });
        }
      }

      return Math.abs(start.x - target.x) + Math.abs(start.y - target.y);
    }

    isVisible(viewport, padding = 1.5) {
      const screenX =
        viewport.offsetX + (this.x + 0.5) * viewport.tileSize;
      const screenY =
        viewport.offsetY + (this.y + 0.5) * viewport.tileSize;
      const pad = viewport.tileSize * padding;

      return (
        screenX >= -pad &&
        screenX <= viewport.width + pad &&
        screenY >= -pad &&
        screenY <= viewport.height + pad
      );
    }

    draw(ctx, viewport, timeSeconds) {
      if (!this.isVisible(viewport)) return;

      const { tileSize, offsetX, offsetY } = viewport;
      const cx = offsetX + (this.x + 0.5) * tileSize;
      const cy = offsetY + (this.y + 0.5) * tileSize;
      const radius = this.radius * tileSize;
      const bob =
        Math.sin(timeSeconds * 5 + this.animOffset) * tileSize * 0.04;

      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.shadowColor = this.alerted
        ? "rgba(255, 72, 72, 0.95)"
        : this.profile.glow;
      ctx.shadowBlur = tileSize * (this.alerted ? 0.38 : 0.25);

      const body = ctx.createLinearGradient(0, -radius, 0, radius);
      if (this.isElite) {
        body.addColorStop(0, "#7f8691");
        body.addColorStop(0.12, "#1b1f26");
        body.addColorStop(1, this.profile.color);
      } else {
        body.addColorStop(0, "#f4fbff");
        body.addColorStop(0.14, this.profile.color);
        body.addColorStop(1, this.profile.color);
      }
      ctx.fillStyle = body;

      ctx.beginPath();
      ctx.arc(0, -radius * 0.12, radius, Math.PI, 0);
      ctx.lineTo(radius, radius * 0.72);
      const waveCount = 4;
      const step = radius * 2 / waveCount;

      for (let i = waveCount; i > 0; i -= 1) {
        const x = -radius + i * step;
        const y =
          radius * 0.72 + (i % 2 === 0 ? radius * 0.24 : 0);
        ctx.lineTo(x, y);
      }

      ctx.lineTo(-radius, -radius * 0.12);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      this.drawElementMark(ctx, radius, timeSeconds);
      this.drawEyes(ctx, radius);

      if (this.alerted) {
        ctx.fillStyle = "#ff5a5a";
        ctx.beginPath();
        ctx.moveTo(0, -radius * 1.55);
        ctx.lineTo(radius * 0.22, -radius * 1.15);
        ctx.lineTo(-radius * 0.22, -radius * 1.15);
        ctx.closePath();
        ctx.fill();
      }

      if (this.isElite) {
        ctx.strokeStyle = "rgba(228, 231, 241, 0.9)";
        ctx.lineWidth = Math.max(1.5, radius * 0.08);
        ctx.beginPath();
        ctx.arc(
          0,
          -radius * 0.12,
          radius * 1.08,
          Math.PI * 1.06,
          Math.PI * 1.94
        );
        ctx.stroke();
      }

      ctx.restore();
    }

    drawEyes(ctx, radius) {
      const eyeY = -radius * 0.16;

      [-0.34, 0.34].forEach((side) => {
        ctx.fillStyle = "#f9fbff";
        ctx.beginPath();
        ctx.ellipse(
          radius * side,
          eyeY,
          radius * 0.21,
          radius * 0.28,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        ctx.fillStyle = this.alerted
          ? "#b50f1b"
          : this.isElite
            ? "#000000"
            : "#131b2b";
        ctx.beginPath();
        ctx.arc(
          radius * side + this.dir.x * radius * 0.07,
          eyeY + this.dir.y * radius * 0.07,
          radius * 0.09,
          0,
          Math.PI * 2
        );
        ctx.fill();
      });
    }

    drawElementMark(ctx, radius, timeSeconds) {
      ctx.save();
      ctx.translate(0, radius * 0.34);
      ctx.fillStyle = this.isElite
        ? "rgba(226, 230, 238, 0.92)"
        : "rgba(9, 13, 20, 0.82)";
      ctx.lineWidth = Math.max(1.5, radius * 0.09);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (this.isElite) {
        if (this.eliteType === "speed") {
          ctx.beginPath();
          ctx.moveTo(radius * 0.05, -radius * 0.3);
          ctx.lineTo(-radius * 0.18, radius * 0.02);
          ctx.lineTo(radius * 0.02, radius * 0.02);
          ctx.lineTo(-radius * 0.08, radius * 0.31);
          ctx.lineTo(radius * 0.23, -radius * 0.08);
          ctx.lineTo(0, -radius * 0.08);
          ctx.closePath();
          ctx.fill();
        } else if (this.eliteType === "sight") {
          ctx.beginPath();
          ctx.ellipse(0, 0, radius * 0.3, radius * 0.18, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#1b2027";
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.08, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(0, -radius * 0.03, radius * 0.16, 0, Math.PI * 2);
          ctx.fill();

          for (let i = 0; i < 3; i += 1) {
            const a =
              timeSeconds * 2.6 +
              this.animOffset +
              i * (Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.arc(
              Math.cos(a) * radius * 0.24,
              Math.sin(a) * radius * 0.16,
              radius * 0.06,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }

        ctx.restore();
        return;
      }

      if (this.element === "fire") {
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.28);
        ctx.quadraticCurveTo(radius * 0.28, 0, 0, radius * 0.26);
        ctx.quadraticCurveTo(-radius * 0.28, 0, 0, -radius * 0.28);
        ctx.fill();
      } else if (this.element === "water") {
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.3);
        ctx.quadraticCurveTo(radius * 0.28, 0, 0, radius * 0.29);
        ctx.quadraticCurveTo(-radius * 0.28, 0, 0, -radius * 0.3);
        ctx.fill();
      } else if (this.element === "lightning") {
        ctx.beginPath();
        ctx.moveTo(radius * 0.05, -radius * 0.32);
        ctx.lineTo(-radius * 0.2, radius * 0.02);
        ctx.lineTo(radius * 0.03, radius * 0.02);
        ctx.lineTo(-radius * 0.05, radius * 0.32);
        ctx.lineTo(radius * 0.24, -radius * 0.07);
        ctx.lineTo(0, -radius * 0.07);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.rotate(Math.sin(timeSeconds * 1.8 + this.animOffset) * 0.08);
        ctx.beginPath();
        ctx.moveTo(0, -radius * 0.26);
        ctx.lineTo(radius * 0.25, 0);
        ctx.lineTo(0, radius * 0.26);
        ctx.lineTo(-radius * 0.25, 0);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  class CreepManager {
    constructor(map) {
      this.map = map;
      this.creeps = [];
      this.maxCreeps = 24;
      this.waveNumber = 0;
      this.eliteChance = 0.05;
    }

    reset(map) {
      this.map = map;
      this.creeps = [];
      this.waveNumber = 0;
    }

    spawnCornerWave() {
      const created = [];
      const elements = ["fire", "water", "lightning", "earth"];
      const availableSlots = Math.max(
        0,
        this.maxCreeps - this.creeps.length
      );
      const waveSize = Math.min(elements.length, availableSlots);

      for (let i = 0; i < waveSize; i += 1) {
        const corner = this.map.spawnTiles[i % this.map.spawnTiles.length];
        const spawnTile = this.findOpenCornerTile(corner, i);
        const creep = new Creep(elements[i], spawnTile, this.map);
        this.creeps.push(creep);
        created.push(creep.toSnapshot());
      }

      const remainingSlots = Math.max(
        0,
        this.maxCreeps - this.creeps.length
      );

      if (remainingSlots > 0 && Math.random() < this.eliteChance) {
        const eliteCornerIndex =
          (this.waveNumber + waveSize) % this.map.spawnTiles.length;
        const eliteCorner = this.map.spawnTiles[eliteCornerIndex];
        const eliteSpawn = this.findOpenCornerTile(
          eliteCorner,
          eliteCornerIndex + 7
        );
        const elite = new Creep("shadow", eliteSpawn, this.map, {
          isElite: true,
          eliteType: randomItem(ELITE_TYPES),
          behavior: randomItem(ELITE_BEHAVIORS)
        });
        this.creeps.push(elite);
        created.push(elite.toSnapshot());
      }

      this.waveNumber += 1;
      return created;
    }

    findOpenCornerTile(corner, cornerIndex) {
      const candidates = [];
      const radius = 3;

      for (let y = corner.y - radius; y <= corner.y + radius; y += 1) {
        for (let x = corner.x - radius; x <= corner.x + radius; x += 1) {
          if (!this.map.isWalkableTile(x, y)) continue;
          if (Math.abs(x - corner.x) + Math.abs(y - corner.y) > radius) {
            continue;
          }

          const occupied = this.creeps.some(
            (creep) => Math.hypot(creep.x - x, creep.y - y) < 0.8
          );
          if (!occupied) candidates.push({ x, y });
        }
      }

      if (!candidates.length) return corner;
      const index = (this.waveNumber + cornerIndex) % candidates.length;
      return candidates[index];
    }

    update(dt, players, elapsed, pellets) {
      this.creeps.forEach((creep) =>
        creep.update(dt, this.map, players, elapsed, pellets)
      );
    }

    updateNetwork(dt) {
      this.creeps.forEach((creep) => creep.updateNetwork(dt));
    }

    draw(ctx, viewport, timeSeconds) {
      this.creeps.forEach((creep) =>
        creep.draw(ctx, viewport, timeSeconds)
      );
    }

    collidingUserIds(players = []) {
      const caught = new Set();

      players.forEach((player) => {
        if (player?.alive === false) return;

        const collided = this.creeps.some(
          (creep) =>
            Math.hypot(creep.x - player.x, creep.y - player.y) <
            creep.radius + (Number(player.radius) || 0.34) - 0.08
        );

        if (collided && player.userId) caught.add(player.userId);
      });

      return Array.from(caught);
    }

    getAlertedUserIds() {
      return Array.from(
        new Set(
          this.creeps
            .filter((creep) => creep.alerted && creep.targetUserId)
            .map((creep) => creep.targetUserId)
        )
      );
    }

    createFromState(state) {
      const creep = new Creep(
        state.element || "fire",
        { x: Number(state.x) || 0, y: Number(state.y) || 0 },
        this.map,
        {
          id: state.id,
          isElite: Boolean(state.isElite),
          eliteType: state.eliteType || null,
          behavior: state.behavior || undefined,
          animOffset: state.animOffset
        }
      );

      creep.applySnapshotState(state);
      return creep;
    }

    applySnapshot(states = []) {
      this.creeps = (Array.isArray(states) ? states : []).map((state) =>
        this.createFromState(state)
      );
    }

    applyFrame(states = []) {
      const activeIds = new Set();
      const byId = new Map(this.creeps.map((creep) => [creep.id, creep]));

      (Array.isArray(states) ? states : []).forEach((state) => {
        if (!state?.id) return;
        activeIds.add(state.id);

        let creep = byId.get(state.id);
        if (!creep) {
          creep = this.createFromState(state);
          this.creeps.push(creep);
          byId.set(state.id, creep);
        }

        creep.applyNetworkState(state);
      });

      this.creeps = this.creeps.filter((creep) => activeIds.has(creep.id));
    }

    toSnapshot() {
      return this.creeps.map((creep) => creep.toSnapshot());
    }

    get count() {
      return this.creeps.length;
    }

    get alertedCount() {
      return this.creeps.filter((creep) => creep.alerted).length;
    }

    get eliteCount() {
      return this.creeps.filter((creep) => creep.isElite).length;
    }
  }

  window.Creep = Creep;
  window.CreepManager = CreepManager;
})();
