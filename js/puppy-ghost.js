(function () {
  "use strict";

  const BaseCreepManager = window.CreepManager;

  if (typeof BaseCreepManager !== "function") {
    console.error("P.A.C puppy ghost could not load: CreepManager is unavailable.");
    return;
  }

  const HOSTILE_GHOST_LIMIT = 16;
  const PUPPY_RESPAWN_SECONDS = 20;
  const PUPPY_REWARD_PELLETS = 5;
  const PUPPY_SIGHT_RADIUS = 6;
  const PUPPY_FEAR_MEMORY_SECONDS = 1.35;
  const PUPPY_CALM_SPEED = 3.25;
  const PUPPY_FLEE_SPEED = 6.15;
  const PUPPY_META_ID = "__pac-silver-puppy-meta__";

  function createPuppyId() {
    if (window.crypto?.randomUUID) {
      return `puppy-${window.crypto.randomUUID()}`;
    }

    return `puppy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function clampDirection(value) {
    const number = Number(value) || 0;
    if (number > 0) return 1;
    if (number < 0) return -1;
    return 0;
  }

  class SilverPuppyGhost {
    constructor(tile, map, options = {}) {
      this.id = options.id || createPuppyId();
      this.isPuppy = true;
      this.map = map;
      this.x = Number(tile?.x) || 0;
      this.y = Number(tile?.y) || 0;
      this.dir = {
        x: clampDirection(options.dirX),
        y: clampDirection(options.dirY)
      };
      this.radius = 0.32;
      this.sightRadius = PUPPY_SIGHT_RADIUS;
      this.afraid = Boolean(options.afraid);
      this.targetUserId = options.targetUserId || null;
      this.fearMemory = Math.max(0, Number(options.fearMemory) || 0);
      this.animOffset = Number.isFinite(Number(options.animOffset))
        ? Number(options.animOffset)
        : Math.random() * Math.PI * 2;
      this.networkTargetX = this.x;
      this.networkTargetY = this.y;
      this.hasNetworkState = false;

      if (this.dir.x === 0 && this.dir.y === 0) {
        this.chooseDirection(map, null, true);
      }
    }

    findVisiblePacman(map, players = []) {
      return players
        .filter((player) => player?.alive !== false)
        .map((player) => ({
          player,
          distance: Math.hypot(player.x - this.x, player.y - this.y)
        }))
        .filter(({ player, distance }) =>
          distance <= this.sightRadius &&
          map.hasLineOfSight(
            this.x,
            this.y,
            player.x,
            player.y,
            this.sightRadius
          )
        )
        .sort((a, b) => a.distance - b.distance)[0]?.player || null;
    }

    resolveTarget(map, players, dt) {
      const visible = this.findVisiblePacman(map, players);

      if (visible) {
        this.targetUserId = visible.userId || null;
        this.fearMemory = PUPPY_FEAR_MEMORY_SECONDS;
        this.afraid = true;
        return visible;
      }

      this.fearMemory = Math.max(0, this.fearMemory - dt);

      if (this.fearMemory > 0 && this.targetUserId) {
        const remembered = players.find(
          (player) =>
            player?.alive !== false &&
            player.userId === this.targetUserId
        );

        if (remembered) {
          this.afraid = true;
          return remembered;
        }
      }

      this.afraid = false;
      this.targetUserId = null;
      return null;
    }

    update(dt, map, players = []) {
      let target = this.resolveTarget(map, players, dt);
      const movementSpeed = this.afraid
        ? PUPPY_FLEE_SPEED
        : PUPPY_CALM_SPEED;

      let remaining = movementSpeed * dt;
      let safety = 0;

      while (remaining > 0.0001 && safety < 8) {
        safety += 1;

        const centerX = Math.round(this.x);
        const centerY = Math.round(this.y);
        const atCenter =
          Math.abs(this.x - centerX) < 0.0001 &&
          Math.abs(this.y - centerY) < 0.0001;

        if (atCenter) {
          this.x = centerX;
          this.y = centerY;
          target = this.resolveTarget(map, players, 0);
          this.chooseDirection(map, target, false);
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
        }
      }
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

    chooseDirection(map, target, initial = false) {
      const tileX = Math.round(this.x);
      const tileY = Math.round(this.y);

      let options = map.walkableNeighbors(tileX, tileY).map((tile) => ({
        x: tile.x - tileX,
        y: tile.y - tileY,
        tile
      }));

      if (!options.length) {
        this.dir = {
          x: -this.dir.x,
          y: -this.dir.y
        };
        return;
      }

      if (!target || !this.afraid) {
        if (!initial && options.length > 1) {
          const reverseX = -this.dir.x;
          const reverseY = -this.dir.y;
          const withoutReverse = options.filter(
            (option) =>
              option.x !== reverseX || option.y !== reverseY
          );

          if (withoutReverse.length) options = withoutReverse;
        }

        const forward = options.find(
          (option) =>
            option.x === this.dir.x && option.y === this.dir.y
        );

        if (forward && Math.random() < 0.7) {
          this.dir = { x: forward.x, y: forward.y };
          return;
        }

        const roaming = options[Math.floor(Math.random() * options.length)];
        this.dir = { x: roaming.x, y: roaming.y };
        return;
      }

      const targetTile = map.findNearestFloor(target.x, target.y);
      const scored = options
        .map((option) => ({
          option,
          score:
            this.pathDistance(map, option.tile, targetTile) +
            Math.hypot(
              option.tile.x - target.x,
              option.tile.y - target.y
            ) * 0.15
        }))
        .sort((a, b) => b.score - a.score || Math.random() - 0.5);

      const choicePool = scored.slice(0, Math.min(2, scored.length));
      const selected =
        Math.random() < 0.18 && choicePool.length > 1
          ? choicePool[1]
          : choicePool[0];

      this.dir = {
        x: selected.option.x,
        y: selected.option.y
      };
    }

    pathDistance(map, start, target) {
      if (start.x === target.x && start.y === target.y) return 0;

      const queue = [{ x: start.x, y: start.y, distance: 0 }];
      const visited = new Set([`${start.x},${start.y}`]);
      let cursor = 0;

      while (cursor < queue.length) {
        const current = queue[cursor];
        cursor += 1;

        for (const neighbor of map.walkableNeighbors(current.x, current.y)) {
          const key = `${neighbor.x},${neighbor.y}`;
          if (visited.has(key)) continue;

          if (neighbor.x === target.x && neighbor.y === target.y) {
            return current.distance + 1;
          }

          visited.add(key);
          queue.push({
            x: neighbor.x,
            y: neighbor.y,
            distance: current.distance + 1
          });
        }
      }

      return Math.abs(start.x - target.x) + Math.abs(start.y - target.y);
    }

    applyNetworkState(state) {
      const x = Number(state?.x);
      const y = Number(state?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      this.networkTargetX = x;
      this.networkTargetY = y;
      this.dir = {
        x: clampDirection(state.dirX),
        y: clampDirection(state.dirY)
      };
      this.afraid = Boolean(state.afraid);
      this.targetUserId = state.targetUserId || null;
      this.fearMemory = Math.max(0, Number(state.fearMemory) || 0);

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
      this.x = Number(state?.x) || 0;
      this.y = Number(state?.y) || 0;
      this.networkTargetX = this.x;
      this.networkTargetY = this.y;
      this.dir = {
        x: clampDirection(state?.dirX),
        y: clampDirection(state?.dirY)
      };
      this.afraid = Boolean(state?.afraid);
      this.targetUserId = state?.targetUserId || null;
      this.fearMemory = Math.max(0, Number(state?.fearMemory) || 0);
      this.animOffset = Number.isFinite(Number(state?.animOffset))
        ? Number(state.animOffset)
        : this.animOffset;
      this.hasNetworkState = true;
    }

    toSnapshot() {
      return {
        id: this.id,
        isPuppy: true,
        x: Number(this.x.toFixed(4)),
        y: Number(this.y.toFixed(4)),
        dirX: this.dir.x,
        dirY: this.dir.y,
        afraid: this.afraid,
        targetUserId: this.targetUserId,
        fearMemory: Number(this.fearMemory.toFixed(4)),
        animOffset: this.animOffset
      };
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
      const centerX = offsetX + (this.x + 0.5) * tileSize;
      const centerY = offsetY + (this.y + 0.5) * tileSize;
      const radius = Math.max(4, tileSize * 0.34 - 1);
      const bob =
        Math.sin(timeSeconds * 5.4 + this.animOffset) * tileSize * 0.035;
      const panicShake = this.afraid
        ? Math.sin(timeSeconds * 24 + this.animOffset) * tileSize * 0.018
        : 0;

      ctx.save();
      ctx.translate(centerX + panicShake, centerY + bob);

      ctx.shadowColor = this.afraid
        ? "rgba(174, 224, 255, 0.92)"
        : "rgba(225, 235, 245, 0.82)";
      ctx.shadowBlur = tileSize * (this.afraid ? 0.31 : 0.2);

      const body = ctx.createRadialGradient(
        -radius * 0.32,
        -radius * 0.38,
        radius * 0.08,
        0,
        0,
        radius * 1.12
      );
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.28, "#edf2f5");
      body.addColorStop(0.7, "#b9c2cb");
      body.addColorStop(1, "#77818d");

      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
      ctx.lineWidth = Math.max(1, radius * 0.055);
      ctx.beginPath();
      ctx.arc(
        -radius * 0.2,
        -radius * 0.2,
        radius * 0.56,
        Math.PI * 1.08,
        Math.PI * 1.62
      );
      ctx.stroke();

      this.drawFace(ctx, radius, timeSeconds);
      ctx.restore();
    }

    drawFace(ctx, radius, timeSeconds) {
      const eyeY = -radius * 0.16;
      const pupilOffsetX = this.dir.x * radius * 0.055;
      const pupilOffsetY = this.dir.y * radius * 0.045;

      [-0.34, 0.34].forEach((side) => {
        ctx.fillStyle = "#fbfdff";
        ctx.beginPath();
        ctx.ellipse(
          radius * side,
          eyeY,
          radius * 0.245,
          radius * 0.315,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        ctx.fillStyle = this.afraid ? "#243347" : "#172131";
        ctx.beginPath();
        ctx.ellipse(
          radius * side + pupilOffsetX,
          eyeY + radius * 0.055 + pupilOffsetY,
          radius * 0.112,
          radius * 0.145,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.beginPath();
        ctx.arc(
          radius * side - radius * 0.035 + pupilOffsetX,
          eyeY + radius * 0.005 + pupilOffsetY,
          radius * 0.038,
          0,
          Math.PI * 2
        );
        ctx.fill();
      });

      ctx.strokeStyle = "#56616d";
      ctx.lineWidth = Math.max(1.2, radius * 0.07);
      ctx.lineCap = "round";

      if (this.afraid) {
        ctx.beginPath();
        ctx.moveTo(-radius * 0.5, -radius * 0.54);
        ctx.lineTo(-radius * 0.16, -radius * 0.42);
        ctx.moveTo(radius * 0.5, -radius * 0.54);
        ctx.lineTo(radius * 0.16, -radius * 0.42);
        ctx.stroke();

        ctx.fillStyle = "#37414c";
        ctx.beginPath();
        ctx.ellipse(
          0,
          radius * 0.38,
          radius * 0.18,
          radius * 0.14,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();

        this.drawTears(ctx, radius, timeSeconds);
      } else {
        ctx.beginPath();
        ctx.moveTo(-radius * 0.47, -radius * 0.47);
        ctx.quadraticCurveTo(
          -radius * 0.32,
          -radius * 0.6,
          -radius * 0.15,
          -radius * 0.47
        );
        ctx.moveTo(radius * 0.47, -radius * 0.47);
        ctx.quadraticCurveTo(
          radius * 0.32,
          -radius * 0.6,
          radius * 0.15,
          -radius * 0.47
        );
        ctx.stroke();

        ctx.strokeStyle = "#4e5965";
        ctx.beginPath();
        ctx.arc(0, radius * 0.24, radius * 0.17, 0.12, Math.PI - 0.12);
        ctx.stroke();
      }
    }

    drawTears(ctx, radius, timeSeconds) {
      const fall = (timeSeconds * 2.7 + this.animOffset) % 1;

      [-0.34, 0.34].forEach((side, index) => {
        const offset = (fall + index * 0.43) % 1;
        const tearY = radius * (0.05 + offset * 0.68);
        const tearX = radius * side + this.dir.x * radius * 0.035;
        const tearSize = radius * (0.065 + offset * 0.025);

        ctx.fillStyle = "rgba(103, 197, 255, 0.9)";
        ctx.beginPath();
        ctx.moveTo(tearX, tearY - tearSize * 1.4);
        ctx.quadraticCurveTo(
          tearX + tearSize,
          tearY,
          tearX,
          tearY + tearSize
        );
        ctx.quadraticCurveTo(
          tearX - tearSize,
          tearY,
          tearX,
          tearY - tearSize * 1.4
        );
        ctx.fill();
      });
    }
  }

  class PuppyCreepManager extends BaseCreepManager {
    constructor(map) {
      super(map);
      this.maxCreeps = HOSTILE_GHOST_LIMIT;
      this.puppy = null;
      this.puppyRespawnTimer = 0;
      this.puppyRewardDrops = [];
      this.lastPlayers = [];
    }

    reset(map) {
      super.reset(map);
      this.maxCreeps = HOSTILE_GHOST_LIMIT;
      this.puppy = null;
      this.puppyRespawnTimer = 0;
      this.puppyRewardDrops = [];
      this.lastPlayers = [];
    }

    spawnCornerWave() {
      const created = super.spawnCornerWave();
      this.maxCreeps = HOSTILE_GHOST_LIMIT;

      if (!this.puppy && this.puppyRespawnTimer <= 0) {
        this.spawnPuppy(this.lastPlayers);
      }

      return created;
    }

    spawnPuppy(players = []) {
      const spawnTile = this.findPuppySpawnTile(players);
      this.puppy = new SilverPuppyGhost(spawnTile, this.map);
      this.puppyRespawnTimer = 0;
      return this.puppy;
    }

    findPuppySpawnTile(players = []) {
      const center = this.map.getStartTile();
      const blockers = [
        ...this.creeps,
        ...this.map.spawnTiles,
        ...players.filter((player) => player?.alive !== false)
      ];

      const candidates = this.map.getFloorTiles().filter((tile) => {
        if (Math.hypot(tile.x - center.x, tile.y - center.y) < 8) {
          return false;
        }

        return blockers.every(
          (blocker) =>
            Math.hypot(tile.x - blocker.x, tile.y - blocker.y) >= 3
        );
      });

      if (candidates.length) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }

      return this.map.randomFloorTile(blockers);
    }

    update(dt, players, elapsed, pellets) {
      this.lastPlayers = Array.isArray(players) ? players : [];
      super.update(dt, this.lastPlayers, elapsed, pellets);

      if (this.puppy) {
        this.puppy.update(dt, this.map, this.lastPlayers);
        this.resolvePuppyCollision(this.lastPlayers);
      } else if (this.puppyRespawnTimer > 0) {
        this.puppyRespawnTimer = Math.max(
          0,
          this.puppyRespawnTimer - dt
        );

        if (this.puppyRespawnTimer <= 0) {
          this.spawnPuppy(this.lastPlayers);
        }
      } else {
        this.spawnPuppy(this.lastPlayers);
      }

      this.processRewardDrops(this.lastPlayers, pellets);
    }

    resolvePuppyCollision(players = []) {
      if (!this.puppy) return;

      const eater = players
        .filter(
          (player) =>
            player?.alive !== false &&
            player.userId
        )
        .map((player) => ({
          player,
          distance: Math.hypot(
            player.x - this.puppy.x,
            player.y - this.puppy.y
          )
        }))
        .filter(
          ({ player, distance }) =>
            distance <
            this.puppy.radius + (Number(player.radius) || 0.34) - 0.07
        )
        .sort((a, b) => a.distance - b.distance)[0]?.player;

      if (!eater) return;

      this.puppy = null;
      this.puppyRespawnTimer = PUPPY_RESPAWN_SECONDS;
      this.puppyRewardDrops.push({
        userId: eater.userId,
        remaining: PUPPY_REWARD_PELLETS,
        activeKey: null
      });
    }

    processRewardDrops(players = [], pellets) {
      if (
        !pellets ||
        typeof pellets.addPellet !== "function" ||
        typeof pellets.hasKey !== "function"
      ) {
        return;
      }

      this.puppyRewardDrops = this.puppyRewardDrops.filter((drop) => {
        const actor = players.find(
          (player) =>
            player?.alive !== false &&
            player.userId === drop.userId
        );

        if (!actor) return drop.remaining > 0;

        if (drop.activeKey) {
          if (pellets.hasKey(drop.activeKey)) return true;

          drop.activeKey = null;
          drop.remaining -= 1;
        }

        if (drop.remaining <= 0) return false;

        const tileX = Math.round(actor.x);
        const tileY = Math.round(actor.y);
        const key = pellets.key(tileX, tileY);

        if (pellets.hasKey(key)) return true;

        pellets.addPellet({
          key,
          x: tileX,
          y: tileY,
          phase: Math.random() * Math.PI * 2,
          spin: 1.25
        });
        drop.activeKey = key;
        return true;
      });
    }

    updateNetwork(dt) {
      super.updateNetwork(dt);
      this.puppy?.updateNetwork(dt);
    }

    draw(ctx, viewport, timeSeconds) {
      super.draw(ctx, viewport, timeSeconds);
      this.puppy?.draw(ctx, viewport, timeSeconds);
    }

    splitStates(states = []) {
      const list = Array.isArray(states) ? states : [];
      return {
        hostileStates: list.filter(
          (state) => !state?.isPuppy && !state?.isPuppyMeta
        ),
        puppyState: list.find((state) => state?.isPuppy) || null,
        metaState: list.find((state) => state?.isPuppyMeta) || null
      };
    }

    createPuppyFromState(state) {
      const puppy = new SilverPuppyGhost(
        {
          x: Number(state?.x) || 0,
          y: Number(state?.y) || 0
        },
        this.map,
        state || {}
      );
      puppy.applySnapshotState(state || {});
      return puppy;
    }

    applySnapshot(states = []) {
      const { hostileStates, puppyState, metaState } = this.splitStates(states);
      super.applySnapshot(hostileStates);
      this.maxCreeps = HOSTILE_GHOST_LIMIT;
      this.puppy = puppyState
        ? this.createPuppyFromState(puppyState)
        : null;
      this.puppyRespawnTimer = this.puppy
        ? 0
        : Math.max(0, Number(metaState?.respawnRemaining) || 0);
      this.puppyRewardDrops = [];
    }

    applyFrame(states = []) {
      const { hostileStates, puppyState, metaState } = this.splitStates(states);
      super.applyFrame(hostileStates);
      this.maxCreeps = HOSTILE_GHOST_LIMIT;

      if (puppyState) {
        if (!this.puppy || this.puppy.id !== puppyState.id) {
          this.puppy = this.createPuppyFromState(puppyState);
        } else {
          this.puppy.applyNetworkState(puppyState);
        }
        this.puppyRespawnTimer = 0;
      } else {
        this.puppy = null;
        this.puppyRespawnTimer = Math.max(
          0,
          Number(metaState?.respawnRemaining) || 0
        );
      }
    }

    toSnapshot() {
      const states = super.toSnapshot();

      if (this.puppy) {
        states.push(this.puppy.toSnapshot());
      }

      states.push({
        id: PUPPY_META_ID,
        isPuppyMeta: true,
        respawnRemaining: Number(
          Math.max(0, this.puppyRespawnTimer).toFixed(4)
        )
      });

      return states;
    }
  }

  window.SilverPuppyGhost = SilverPuppyGhost;
  window.CreepManager = PuppyCreepManager;
})();
