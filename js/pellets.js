(function () {
  "use strict";

  class PelletManager {
    constructor(map) {
      this.map = map;
      this.pellets = new Map();
      this.maxPellets = 260;
      this.pendingRemovals = [];
    }

    reset(map) {
      this.map = map;
      this.pellets.clear();
      this.pendingRemovals = [];
    }

    key(x, y) {
      return `${x},${y}`;
    }

    spawn(count, exclusions = []) {
      const blocked = new Set(
        exclusions.map((tile) =>
          this.key(Math.round(tile.x), Math.round(tile.y))
        )
      );

      const candidates = this.map.getFloorTiles().filter((tile) => {
        const key = this.key(tile.x, tile.y);
        return !this.pellets.has(key) && !blocked.has(key);
      });

      for (let i = candidates.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      const remainingCapacity = Math.max(
        0,
        this.maxPellets - this.pellets.size
      );
      const spawnCount = Math.min(
        count,
        candidates.length,
        remainingCapacity
      );
      const created = [];

      for (let i = 0; i < spawnCount; i += 1) {
        const tile = candidates[i];
        const pellet = {
          key: this.key(tile.x, tile.y),
          x: tile.x,
          y: tile.y,
          phase: Math.random() * Math.PI * 2,
          spin: 0.7 + Math.random() * 0.8
        };

        this.pellets.set(pellet.key, pellet);
        created.push({ ...pellet });
      }

      return created;
    }

    addPellet(pellet) {
      const x = Number(pellet?.x);
      const y = Number(pellet?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

      const key = String(pellet.key || this.key(x, y));
      this.pellets.set(key, {
        key,
        x,
        y,
        phase: Number.isFinite(Number(pellet.phase))
          ? Number(pellet.phase)
          : Math.random() * Math.PI * 2,
        spin: Number.isFinite(Number(pellet.spin))
          ? Number(pellet.spin)
          : 1
      });

      return true;
    }

    addMany(pellets = []) {
      pellets.forEach((pellet) => this.addPellet(pellet));
    }

    collectAt(x, y) {
      return this.removeAt(x, y, 0.42);
    }

    removeAt(x, y, radius = 0.42) {
      const tileX = Math.round(x);
      const tileY = Math.round(y);
      const key = this.key(tileX, tileY);
      const pellet = this.pellets.get(key);
      if (!pellet) return null;

      const distance = Math.hypot(x - tileX, y - tileY);
      if (distance > radius) return null;

      this.pellets.delete(key);
      const removed = { ...pellet, key };
      this.pendingRemovals.push(removed);
      return removed;
    }

    removeByKey(key, options = {}) {
      const cleanKey = String(key || "");
      const pellet = this.pellets.get(cleanKey);
      if (!pellet) return null;

      this.pellets.delete(cleanKey);
      const removed = { ...pellet, key: cleanKey };

      if (options.track !== false) {
        this.pendingRemovals.push(removed);
      }

      return removed;
    }

    hasKey(key) {
      return this.pellets.has(String(key || ""));
    }

    drainRemovals() {
      const removed = this.pendingRemovals;
      this.pendingRemovals = [];
      return removed;
    }

    toSnapshot() {
      return Array.from(this.pellets.values(), (pellet) => ({ ...pellet }));
    }

    applySnapshot(pellets = []) {
      this.pellets.clear();
      this.pendingRemovals = [];
      this.addMany(Array.isArray(pellets) ? pellets : []);
    }

    isVisible(pellet, viewport, padding = 1) {
      const screenX =
        viewport.offsetX + (pellet.x + 0.5) * viewport.tileSize;
      const screenY =
        viewport.offsetY + (pellet.y + 0.5) * viewport.tileSize;
      const pad = viewport.tileSize * padding;

      return (
        screenX >= -pad &&
        screenX <= viewport.width + pad &&
        screenY >= -pad &&
        screenY <= viewport.height + pad
      );
    }

    draw(ctx, viewport, timeSeconds) {
      const { tileSize, offsetX, offsetY } = viewport;
      ctx.save();
      ctx.translate(offsetX, offsetY);

      this.pellets.forEach((pellet) => {
        if (!this.isVisible(pellet, viewport)) return;

        const cx = (pellet.x + 0.5) * tileSize;
        const cy = (pellet.y + 0.5) * tileSize;
        const radius = tileSize * 0.085;
        const orbit = tileSize * 0.18;
        const angle = timeSeconds * pellet.spin * 3 + pellet.phase;
        const hover =
          Math.sin(timeSeconds * 3 + pellet.phase) * tileSize * 0.035;

        ctx.save();
        ctx.shadowColor = "rgba(255, 228, 117, 0.95)";
        ctx.shadowBlur = tileSize * 0.24;
        ctx.fillStyle = "#ffe775";
        ctx.beginPath();
        ctx.arc(cx, cy + hover, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        for (let i = 0; i < 3; i += 1) {
          const a = angle + i * (Math.PI * 2 / 3);
          const ox = cx + Math.cos(a) * orbit;
          const oy = cy + hover + Math.sin(a) * orbit * 0.65;
          ctx.fillStyle =
            i === 0 ? "#fff8bd" : "rgba(255, 194, 54, 0.9)";
          ctx.beginPath();
          ctx.arc(
            ox,
            oy,
            Math.max(1.5, tileSize * 0.032),
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      });

      ctx.restore();
    }

    get count() {
      return this.pellets.size;
    }
  }

  window.PelletManager = PelletManager;
})();
