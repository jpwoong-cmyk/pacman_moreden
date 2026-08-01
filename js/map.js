(function () {
  "use strict";

  const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  const BUILDING_PALETTES = [
    { roof: "#5d6f7d", roofLight: "#8496a3", side: "#34434e", edge: "#b7c5ce", glass: "#76c8df" },
    { roof: "#795d55", roofLight: "#9b766a", side: "#49342f", edge: "#d5b4a9", glass: "#85d4df" },
    { roof: "#596856", roofLight: "#7f927a", side: "#344037", edge: "#b5c5b0", glass: "#80c9ce" },
    { roof: "#6f657a", roofLight: "#9285a0", side: "#453e4d", edge: "#c8bdd1", glass: "#7dcde1" },
    { roof: "#6e6d63", roofLight: "#929186", side: "#434238", edge: "#cbc9ba", glass: "#8bd0da" }
  ];

  const SHOP_NAMES = ["MINIMART", "PHARMACY", "NOODLE", "RAMEN", "ARCADE", "CAFE", "BOOKS", "TECH", "FLORIST", "BAKERY"];
  const MALL_NAMES = ["CITY MALL", "CENTREPOINT", "HARBOUR", "SKYLINE", "GALLERIA", "MEGAPLAZA"];
  const STALL_COLORS = ["#f06543", "#f4c95d", "#5bc0be", "#9b5de5", "#ef476f", "#ff7f50"];

  function normalizeSeed(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return (Math.trunc(numeric) >>> 0) || 1;

    const source = String(value || "elemental-pacman");
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  function mixSeed(seed, salt) {
    let value = (normalizeSeed(seed) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b);
    value ^= value >>> 13;
    value = Math.imul(value, 0xc2b2ae35);
    value ^= value >>> 16;
    return (value >>> 0) || 1;
  }

  function createSeededRandom(seed) {
    let state = normalizeSeed(seed);
    return function seededRandom() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomItem(items, random) {
    return items[Math.floor(random() * items.length)];
  }

  function tileHash(x, y, seed) {
    let value = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
    value = (value ^ (value >> 13)) * 1274126177;
    return ((value ^ (value >> 16)) >>> 0) / 4294967295;
  }

  class MazeMap {
    constructor(cols = 65, rows = 49, seed = null) {
      this.cols = cols;
      this.rows = rows;
      this.grid = [];
      this.roomSeed = normalizeSeed(
        seed ?? Math.floor(Math.random() * 0xffffffff)
      );
      this.seed = this.roomSeed;
      this.random = createSeededRandom(this.seed);
      this.spawnTiles = [];
      this.lots = [];
      this.surfaceGrid = [];
      this.generate();
    }

    resetRandomForAttempt(attempt) {
      this.seed = mixSeed(this.roomSeed, attempt);
      this.random = createSeededRandom(this.seed);
    }

    generate() {
      let accepted = false;
      let attempt = 0;

      while (!accepted && attempt < 180) {
        attempt += 1;
        this.resetRandomForAttempt(attempt);
        this.grid = Array.from({ length: this.rows }, (_, y) =>
          Array.from({ length: this.cols }, (_, x) =>
            x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1 ? 1 : 0
          )
        );
        this.lots = [];

        const targetLots = 48 + Math.floor(this.random() * 13);
        let placementAttempts = 0;

        while (this.lots.length < targetLots && placementAttempts < targetLots * 22) {
          placementAttempts += 1;
          const definition = this.randomLotDefinition();
          const x = 2 + Math.floor(this.random() * Math.max(1, this.cols - definition.w - 4));
          const y = 2 + Math.floor(this.random() * Math.max(1, this.rows - definition.h - 4));

          if (this.isReservedArea(x, y, definition.w, definition.h)) continue;
          if (!this.canPlaceLot(x, y, definition.w, definition.h, definition.padding)) continue;

          this.placeLot(x, y, definition);
        }

        this.carveGuaranteedZones();
        accepted = this.isValidNoDeadEndMap();
      }

      if (!accepted) this.createFallbackMap();
      this.lots.sort((a, b) => (a.y + a.h) - (b.y + b.h) || a.x - b.x);
      this.buildSurfaceMap();
      this.spawnTiles = this.getCornerSpawnTiles();
    }

    randomLotDefinition() {
      const roll = this.random();

      if (roll < 0.14) {
        return { kind: "cone", w: 1, h: 1, padding: 1 };
      }

      if (roll < 0.29) {
        return {
          kind: "stall",
          w: this.random() < 0.65 ? 1 : 2,
          h: 1,
          padding: 1
        };
      }

      if (roll < 0.54) {
        return {
          kind: "shop",
          w: 2 + Math.floor(this.random() * 3),
          h: 2,
          padding: 2
        };
      }

      if (roll < 0.7) {
        return {
          kind: "smallBuilding",
          w: 2 + Math.floor(this.random() * 2),
          h: 2 + Math.floor(this.random() * 2),
          padding: 2
        };
      }

      if (roll < 0.84) {
        return {
          kind: "mall",
          w: 4 + Math.floor(this.random() * 2),
          h: 3,
          padding: 2
        };
      }

      return {
        kind: "bigBuilding",
        w: 3 + Math.floor(this.random() * 3),
        h: 3 + Math.floor(this.random() * 2),
        padding: 2
      };
    }

    placeLot(x, y, definition) {
      for (let yy = y; yy < y + definition.h; yy += 1) {
        for (let xx = x; xx < x + definition.w; xx += 1) {
          this.grid[yy][xx] = 1;
        }
      }

      const palette = randomItem(BUILDING_PALETTES, this.random);
      this.lots.push({
        x,
        y,
        w: definition.w,
        h: definition.h,
        kind: definition.kind,
        palette,
        accent: randomItem(STALL_COLORS, this.random),
        sign: definition.kind === "mall" ? randomItem(MALL_NAMES, this.random) : randomItem(SHOP_NAMES, this.random),
        subSign: randomItem(["OPEN 24H", "FOOD", "SALE", "MARKET", "SHOPS", "LEVEL 1"], this.random),
        variant: Math.floor(this.random() * 5),
        rooftopUnits: 1 + Math.floor(this.random() * 4),
        lightColor: randomItem(["#ffd978", "#8fe7ff", "#fcb8ff", "#fff2a2"], this.random),
        lampPosts: definition.kind === "cone" ? 0 : 1 + Math.floor(this.random() * 2)
      });
    }

    canPlaceLot(x, y, width, height, padding) {
      for (let yy = y - padding; yy < y + height + padding; yy += 1) {
        for (let xx = x - padding; xx < x + width + padding; xx += 1) {
          if (!this.inBounds(xx, yy) || this.grid[yy][xx] === 1) return false;
        }
      }
      return true;
    }

    isReservedArea(x, y, width, height) {
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      const protectedTiles = [
        { x: cx, y: cy, radius: 2 },
        { x: 2, y: 2, radius: 3 },
        { x: this.cols - 3, y: 2, radius: 3 },
        { x: 2, y: this.rows - 3, radius: 3 },
        { x: this.cols - 3, y: this.rows - 3, radius: 3 }
      ];

      return protectedTiles.some((tile) =>
        tile.x >= x - tile.radius &&
        tile.x <= x + width - 1 + tile.radius &&
        tile.y >= y - tile.radius &&
        tile.y <= y + height - 1 + tile.radius
      );
    }

    carveGuaranteedZones() {
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      const zones = [];

      for (let y = cy - 1; y <= cy + 1; y += 1) {
        for (let x = cx - 1; x <= cx + 1; x += 1) zones.push([x, y]);
      }

      [
        [1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [1, 3],
        [this.cols - 2, 1], [this.cols - 3, 1], [this.cols - 4, 1], [this.cols - 2, 2], [this.cols - 3, 2], [this.cols - 2, 3],
        [1, this.rows - 2], [2, this.rows - 2], [3, this.rows - 2], [1, this.rows - 3], [2, this.rows - 3], [1, this.rows - 4],
        [this.cols - 2, this.rows - 2], [this.cols - 3, this.rows - 2], [this.cols - 4, this.rows - 2], [this.cols - 2, this.rows - 3], [this.cols - 3, this.rows - 3], [this.cols - 2, this.rows - 4]
      ].forEach((tile) => zones.push(tile));

      zones.forEach(([x, y]) => {
        if (this.inBounds(x, y)) this.grid[y][x] = 0;
      });
    }

    createFallbackMap() {
      this.grid = Array.from({ length: this.rows }, (_, y) =>
        Array.from({ length: this.cols }, (_, x) =>
          x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1 ? 1 : 0
        )
      );
      this.lots = [];

      const fallbackLots = [
        [6, 5, 4, 3, "bigBuilding"], [16, 4, 3, 2, "shop"], [26, 5, 3, 3, "smallBuilding"], [38, 4, 5, 3, "bigBuilding"], [51, 5, 3, 2, "shop"],
        [5, 16, 3, 2, "shop"], [15, 15, 4, 4, "bigBuilding"], [28, 16, 2, 2, "smallBuilding"], [39, 15, 3, 2, "shop"], [51, 15, 4, 4, "bigBuilding"],
        [7, 29, 4, 3, "bigBuilding"], [18, 30, 2, 2, "smallBuilding"], [29, 29, 4, 2, "shop"], [41, 29, 3, 3, "smallBuilding"], [53, 30, 3, 2, "shop"],
        [5, 40, 3, 2, "shop"], [17, 39, 4, 3, "bigBuilding"], [30, 40, 2, 2, "smallBuilding"], [41, 39, 4, 3, "bigBuilding"], [54, 40, 2, 2, "smallBuilding"]
      ];

      fallbackLots.forEach(([x, y, w, h, kind]) => {
        this.placeLot(x, y, { w, h, kind });
      });

      [[12, 10], [34, 11], [47, 23], [24, 36], [58, 34]].forEach(([x, y]) => {
        this.placeLot(x, y, { w: 1, h: 1, kind: "cone" });
      });
      this.carveGuaranteedZones();
    }

    isValidNoDeadEndMap() {
      const floors = this.getFloorTiles();
      if (floors.length < this.cols * this.rows * 0.62) return false;

      for (const tile of floors) {
        if (this.walkableNeighbors(tile.x, tile.y).length < 2) return false;
      }

      const visited = new Set();
      const queue = [floors[0]];
      visited.add(`${floors[0].x},${floors[0].y}`);

      while (queue.length) {
        const current = queue.shift();
        for (const neighbor of this.walkableNeighbors(current.x, current.y)) {
          const key = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(key)) {
            visited.add(key);
            queue.push(neighbor);
          }
        }
      }

      return visited.size === floors.length;
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
    }

    isWalkable(x, y) {
      const tx = Math.round(x);
      const ty = Math.round(y);
      return this.inBounds(tx, ty) && this.grid[ty][tx] === 0;
    }

    isWalkableTile(x, y) {
      return this.inBounds(x, y) && this.grid[y][x] === 0;
    }

    walkableNeighbors(x, y) {
      return DIRS
        .map((dir) => ({ x: x + dir.x, y: y + dir.y }))
        .filter((tile) => this.isWalkableTile(tile.x, tile.y));
    }

    getFloorTiles() {
      const tiles = [];
      for (let y = 0; y < this.rows; y += 1) {
        for (let x = 0; x < this.cols; x += 1) {
          if (this.grid[y][x] === 0) tiles.push({ x, y });
        }
      }
      return tiles;
    }

    getStartTile() {
      const center = { x: Math.floor(this.cols / 2), y: Math.floor(this.rows / 2) };
      if (this.isWalkableTile(center.x, center.y)) return center;
      return this.findNearestFloor(center.x, center.y);
    }

    getPlayerStartTile(playerSlot = 1) {
      const center = this.getStartTile();
      const offsets = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 }
      ];
      const offset = offsets[Math.max(0, Math.min(3, Number(playerSlot) - 1))] || offsets[0];
      return this.findNearestFloor(center.x + offset.x, center.y + offset.y);
    }

    getCornerSpawnTiles() {
      const corners = [
        { x: 2, y: 2 },
        { x: this.cols - 3, y: 2 },
        { x: 2, y: this.rows - 3 },
        { x: this.cols - 3, y: this.rows - 3 }
      ];

      return corners.map((corner) => this.findNearestFloor(corner.x, corner.y));
    }

    findNearestFloor(startX, startY) {
      startX = Math.max(0, Math.min(this.cols - 1, Math.round(startX)));
      startY = Math.max(0, Math.min(this.rows - 1, Math.round(startY)));
      const queue = [{ x: startX, y: startY }];
      const visited = new Set([`${startX},${startY}`]);

      while (queue.length) {
        const tile = queue.shift();
        if (this.isWalkableTile(tile.x, tile.y)) return tile;

        for (const dir of DIRS) {
          const next = { x: tile.x + dir.x, y: tile.y + dir.y };
          const key = `${next.x},${next.y}`;
          if (this.inBounds(next.x, next.y) && !visited.has(key)) {
            visited.add(key);
            queue.push(next);
          }
        }
      }

      return this.getFloorTiles()[0];
    }

    randomFloorTile(exclusions = []) {
      const excluded = new Set(exclusions.map((tile) => `${Math.round(tile.x)},${Math.round(tile.y)}`));
      const candidates = this.getFloorTiles().filter((tile) => !excluded.has(`${tile.x},${tile.y}`));
      return candidates[Math.floor(this.random() * candidates.length)] || this.getStartTile();
    }

    buildSurfaceMap() {
      this.surfaceGrid = Array.from({ length: this.rows }, () =>
        Array.from({ length: this.cols }, () => ({ type: "grass", orientation: null }))
      );

      for (let y = 0; y < this.rows; y += 1) {
        for (let x = 0; x < this.cols; x += 1) {
          if (!this.isWalkableTile(x, y)) continue;
          this.surfaceGrid[y][x] = {
            type: this.hasObstacleNearby(x, y) ? "walkway" : "road",
            orientation: null
          };
        }
      }
    }

    hasObstacleNearby(x, y) {
      for (let yy = y - 1; yy <= y + 1; yy += 1) {
        for (let xx = x - 1; xx <= x + 1; xx += 1) {
          if (xx === x && yy === y) continue;
          if (this.inBounds(xx, yy) && this.grid[yy][xx] === 1) return true;
        }
      }
      return false;
    }

    markCrossingFromLot(lot, side) {
      const vertical = side === "north" || side === "south";
      const direction = side === "south"
        ? { x: 0, y: 1 }
        : side === "north"
          ? { x: 0, y: -1 }
          : side === "east"
            ? { x: 1, y: 0 }
            : { x: -1, y: 0 };
      const span = vertical ? lot.w : lot.h;
      const crossingWidth = Math.min(2, Math.max(1, span));
      const anchor = vertical
        ? lot.x + Math.floor((lot.w - crossingWidth) / 2)
        : lot.y + Math.floor((lot.h - crossingWidth) / 2);

      for (let offset = 0; offset < crossingWidth; offset += 1) {
        const startX = vertical
          ? anchor + offset
          : side === "east"
            ? lot.x + lot.w
            : lot.x - 1;
        const startY = vertical
          ? side === "south"
            ? lot.y + lot.h
            : lot.y - 1
          : anchor + offset;

        const path = [];
        let cursorX = startX;
        let cursorY = startY;
        let roadSeen = false;
        let foundOppositeWalkway = false;

        for (let depth = 0; depth < 12; depth += 1) {
          if (!this.isWalkableTile(cursorX, cursorY)) break;
          const surface = this.getSurface(cursorX, cursorY);

          if (surface.type === "walkway") {
            if (roadSeen) {
              foundOppositeWalkway = true;
              break;
            }
          } else if (surface.type === "road" || surface.type === "zebra") {
            roadSeen = true;
            path.push({ x: cursorX, y: cursorY });
          } else {
            break;
          }

          cursorX += direction.x;
          cursorY += direction.y;
        }

        if (!roadSeen || !foundOppositeWalkway || path.length < 2) continue;

        path.forEach((tile) => {
          const surface = this.surfaceGrid[tile.y][tile.x];
          if (!surface) return;
          surface.type = "zebra";
          surface.orientation = vertical ? "vertical" : "horizontal";
        });
      }
    }

    getSurface(x, y) {
      if (!this.inBounds(x, y)) return { type: "grass", orientation: null };
      return this.surfaceGrid[y][x];
    }

    isRoadSurface(x, y) {
      const type = this.getSurface(x, y).type;
      return type === "road" || type === "zebra";
    }

    hasLineOfSight(fromX, fromY, toX, toY, maxDistance = 4.05) {
      const distance = Math.hypot(toX - fromX, toY - fromY);
      if (distance > maxDistance) return false;

      const steps = Math.max(2, Math.ceil(distance * 12));
      for (let i = 1; i < steps; i += 1) {
        const progress = i / steps;
        const x = fromX + (toX - fromX) * progress;
        const y = fromY + (toY - fromY) * progress;
        if (!this.isWalkable(x, y)) return false;
      }
      return true;
    }

    getVisibleBounds(viewport, padding = 2) {
      const minX = Math.max(0, Math.floor((-viewport.offsetX) / viewport.tileSize) - padding);
      const minY = Math.max(0, Math.floor((-viewport.offsetY) / viewport.tileSize) - padding);
      const maxX = Math.min(this.cols - 1, Math.ceil((viewport.width - viewport.offsetX) / viewport.tileSize) + padding);
      const maxY = Math.min(this.rows - 1, Math.ceil((viewport.height - viewport.offsetY) / viewport.tileSize) + padding);
      return { minX, minY, maxX, maxY };
    }

    draw(ctx, viewport, depthMode = true) {
      const { tileSize, offsetX, offsetY } = viewport;
      const visible = this.getVisibleBounds(viewport, 3);

      ctx.save();
      ctx.translate(offsetX, offsetY);

      ctx.fillStyle = "#365b35";
      ctx.fillRect(0, 0, this.cols * tileSize, this.rows * tileSize);

      for (let y = visible.minY; y <= visible.maxY; y += 1) {
        for (let x = visible.minX; x <= visible.maxX; x += 1) {
          if (this.grid[y][x] === 0) {
            this.drawSurfaceTile(ctx, x, y, tileSize);
          } else {
            this.drawGrassTile(ctx, x, y, tileSize);
          }
        }
      }

      this.drawPerimeter(ctx, tileSize, visible, depthMode);

      this.lots.forEach((lot) => {
        if (
          lot.x > visible.maxX + 2 ||
          lot.y > visible.maxY + 2 ||
          lot.x + lot.w < visible.minX - 2 ||
          lot.y + lot.h < visible.minY - 2
        ) return;

        this.drawLot(ctx, lot, tileSize, depthMode);
      });

      ctx.restore();
    }

    drawSurfaceTile(ctx, x, y, size) {
      const surface = this.getSurface(x, y);
      if (surface.type === "walkway") {
        this.drawWalkwayTile(ctx, x, y, size);
      } else if (surface.type === "zebra") {
        this.drawZebraTile(ctx, x, y, size, surface.orientation);
      } else {
        this.drawRoadTile(ctx, x, y, size, true);
      }
    }

    drawRoadTile(ctx, x, y, size, showLaneMarkings = true) {
      const px = x * size;
      const py = y * size;
      const variation = tileHash(x, y, this.seed);
      const crack = tileHash(x + 19, y + 31, this.seed + 71);

      ctx.fillStyle = variation > 0.5 ? "#2d3437" : "#262d30";
      ctx.fillRect(px, py, size + 0.5, size + 0.5);

      const sheen = ctx.createLinearGradient(px, py, px, py + size);
      sheen.addColorStop(0, "rgba(255,255,255,0.035)");
      sheen.addColorStop(1, "rgba(0,0,0,0.08)");
      ctx.fillStyle = sheen;
      ctx.fillRect(px, py, size, size);

      ctx.strokeStyle = "rgba(216, 227, 228, 0.02)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);

      if (crack > 0.72) {
        ctx.strokeStyle = "rgba(180, 190, 190, 0.09)";
        ctx.lineWidth = Math.max(1, size * 0.02);
        ctx.beginPath();
        ctx.moveTo(px + size * (0.18 + (crack * 0.12)), py + size * 0.22);
        ctx.lineTo(px + size * 0.45, py + size * 0.5);
        ctx.lineTo(px + size * (0.62 + (crack * 0.08)), py + size * 0.78);
        ctx.stroke();
      }
    }

    drawWalkwayTile(ctx, x, y, size) {
      const px = x * size;
      const py = y * size;
      const variation = tileHash(x, y, this.seed + 97);

      ctx.fillStyle = variation > 0.54 ? "#c0c5c1" : "#b0b7b3";
      ctx.fillRect(px, py, size + 0.5, size + 0.5);

      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(px, py, size, size * 0.08);
      ctx.fillRect(px, py, size * 0.08, size);

      ctx.strokeStyle = "rgba(69, 76, 75, 0.24)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
      ctx.beginPath();
      ctx.moveTo(px + size * 0.5, py);
      ctx.lineTo(px + size * 0.5, py + size);
      ctx.moveTo(px, py + size * 0.5);
      ctx.lineTo(px + size, py + size * 0.5);
      ctx.stroke();

      const curbThickness = Math.max(2, size * 0.09);
      const roadNorth = this.isRoadSurface(x, y - 1);
      const roadSouth = this.isRoadSurface(x, y + 1);
      const roadWest = this.isRoadSurface(x - 1, y);
      const roadEast = this.isRoadSurface(x + 1, y);

      if (roadNorth) {
        ctx.fillStyle = "rgba(235, 225, 188, 0.96)";
        ctx.fillRect(px, py, size, curbThickness);
        ctx.fillStyle = "rgba(58, 63, 66, 0.22)";
        ctx.fillRect(px, py + curbThickness, size, Math.max(1, size * 0.03));
      }
      if (roadSouth) {
        ctx.fillStyle = "rgba(235, 225, 188, 0.96)";
        ctx.fillRect(px, py + size - curbThickness, size, curbThickness);
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(px, py + size - curbThickness, size, Math.max(1, size * 0.03));
      }
      if (roadWest) {
        ctx.fillStyle = "rgba(235, 225, 188, 0.96)";
        ctx.fillRect(px, py, curbThickness, size);
        ctx.fillStyle = "rgba(58, 63, 66, 0.22)";
        ctx.fillRect(px + curbThickness, py, Math.max(1, size * 0.03), size);
      }
      if (roadEast) {
        ctx.fillStyle = "rgba(235, 225, 188, 0.96)";
        ctx.fillRect(px + size - curbThickness, py, curbThickness, size);
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(px + size - curbThickness, py, Math.max(1, size * 0.03), size);
      }
    }

    drawZebraTile(ctx, x, y, size, orientation) {
      const px = x * size;
      const py = y * size;
      this.drawRoadTile(ctx, x, y, size, false);

      ctx.fillStyle = "rgba(244, 241, 226, 0.94)";
      const stripeCount = 5;
      const margin = size * 0.08;
      const usable = size - margin * 2;

      for (let i = 0; i < stripeCount; i += 1) {
        if (orientation === "vertical") {
          const stripeHeight = usable / (stripeCount * 1.55);
          const yPos = py + margin + i * (usable / stripeCount);
          ctx.fillRect(px + size * 0.1, yPos, size * 0.8, stripeHeight);
        } else {
          const stripeWidth = usable / (stripeCount * 1.55);
          const xPos = px + margin + i * (usable / stripeCount);
          ctx.fillRect(xPos, py + size * 0.1, stripeWidth, size * 0.8);
        }
      }

      ctx.strokeStyle = "rgba(16, 20, 21, 0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    }

    drawGrassTile(ctx, x, y, size) {
      const px = x * size;
      const py = y * size;
      const variation = tileHash(x, y, this.seed + 211);
      const blade = tileHash(x + 7, y + 13, this.seed + 37);

      ctx.fillStyle = variation > 0.55 ? "#456f3e" : "#3d6538";
      ctx.fillRect(px, py, size + 0.5, size + 0.5);

      ctx.strokeStyle = "rgba(128, 174, 91, 0.3)";
      ctx.lineWidth = Math.max(1, size * 0.018);
      ctx.beginPath();
      ctx.moveTo(px + size * (0.18 + blade * 0.55), py + size * 0.76);
      ctx.lineTo(px + size * (0.16 + blade * 0.55), py + size * 0.58);
      ctx.moveTo(px + size * (0.18 + blade * 0.55), py + size * 0.76);
      ctx.lineTo(px + size * (0.23 + blade * 0.55), py + size * 0.62);
      ctx.stroke();

      if (variation > 0.82) {
        ctx.fillStyle = "rgba(223, 205, 126, 0.34)";
        ctx.beginPath();
        ctx.arc(px + size * 0.72, py + size * 0.3, Math.max(1, size * 0.025), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawPerimeter(ctx, size, visible, depthMode) {
      const startX = visible.minX;
      const endX = visible.maxX;
      const startY = visible.minY;
      const endY = visible.maxY;

      for (let x = startX; x <= endX; x += 1) {
        if (this.grid[0] && this.grid[0][x] === 1) this.drawBarrier(ctx, x * size, 0, size, depthMode);
        if (this.grid[this.rows - 1] && this.grid[this.rows - 1][x] === 1) this.drawBarrier(ctx, x * size, (this.rows - 1) * size, size, depthMode);
      }

      for (let y = Math.max(1, startY); y <= Math.min(this.rows - 2, endY); y += 1) {
        if (this.grid[y][0] === 1) this.drawBarrier(ctx, 0, y * size, size, depthMode);
        if (this.grid[y][this.cols - 1] === 1) this.drawBarrier(ctx, (this.cols - 1) * size, y * size, size, depthMode);
      }
    }

    drawBarrier(ctx, x, y, size, depthMode) {
      const inset = size * 0.12;
      const depth = depthMode ? size * 0.1 : 0;
      ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
      ctx.fillRect(x + inset + depth, y + inset + depth, size - inset * 2, size - inset * 2);
      ctx.fillStyle = "#3a4247";
      ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
      ctx.strokeStyle = "#7c898f";
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
      ctx.strokeStyle = "rgba(238, 190, 67, 0.8)";
      ctx.beginPath();
      ctx.moveTo(x + inset, y + size * 0.52);
      ctx.lineTo(x + size - inset, y + size * 0.52);
      ctx.stroke();
    }

    drawLot(ctx, lot, size, depthMode) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;

      const lotVariation = tileHash(lot.x, lot.y, this.seed + 401);
      ctx.fillStyle = lotVariation > 0.5 ? "rgba(74, 119, 61, 0.96)" : "rgba(62, 104, 54, 0.96)";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "rgba(158, 191, 111, 0.34)";
      ctx.lineWidth = Math.max(1, size * 0.022);
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

      if (lot.kind === "cone") {
        this.drawCone(ctx, lot, size, depthMode);
      } else if (lot.kind === "stall") {
        this.drawStall(ctx, lot, size, depthMode);
      } else if (lot.kind === "shop") {
        this.drawShop(ctx, lot, size, depthMode);
      } else if (lot.kind === "mall") {
        this.drawMall(ctx, lot, size, depthMode);
      } else {
        this.drawBuilding(ctx, lot, size, depthMode);
      }

      if (lot.kind !== "cone") this.drawLotStreetProps(ctx, lot, size);
    }

    drawBuilding(ctx, lot, size, depthMode) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const inset = size * 0.12;
      const depth = depthMode ? Math.min(size * 0.3, size * (lot.kind === "bigBuilding" ? 0.28 : 0.2)) : size * 0.06;
      const palette = lot.palette;

      ctx.fillStyle = "rgba(0, 0, 0, 0.46)";
      ctx.fillRect(x + inset + depth, y + inset + depth, width - inset * 2, height - inset * 2);

      ctx.fillStyle = palette.side;
      ctx.fillRect(x + inset + depth * 0.45, y + inset + depth * 0.45, width - inset * 2, height - inset * 2);

      const roof = ctx.createLinearGradient(x, y, x + width, y + height);
      roof.addColorStop(0, palette.roofLight);
      roof.addColorStop(1, palette.roof);
      ctx.fillStyle = roof;
      ctx.fillRect(x + inset, y + inset, width - inset * 2, height - inset * 2);

      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(1, size * 0.045);
      ctx.strokeRect(x + inset, y + inset, width - inset * 2, height - inset * 2);

      const windowCount = Math.max(2, lot.w * 2);
      const facadeY = y + height - inset - Math.max(size * 0.18, depth * 0.7);
      for (let i = 0; i < windowCount; i += 1) {
        const windowWidth = (width - inset * 2) / windowCount;
        ctx.fillStyle = i % 3 === lot.variant % 3 ? "#ffd57a" : palette.glass;
        ctx.fillRect(
          x + inset + i * windowWidth + windowWidth * 0.2,
          facadeY,
          windowWidth * 0.6,
          Math.max(2, size * 0.11)
        );
      }

      const unitSize = Math.max(size * 0.16, Math.min(width, height) * 0.12);
      for (let i = 0; i < lot.rooftopUnits; i += 1) {
        const columns = Math.max(1, Math.floor((width - inset * 2) / (unitSize * 2)));
        const ux = x + inset + unitSize * 0.65 + (i % columns) * unitSize * 1.75;
        const uy = y + inset + unitSize * 0.65 + Math.floor(i / columns) * unitSize * 1.65;
        if (ux + unitSize > x + width - inset || uy + unitSize > y + height - inset) continue;
        ctx.fillStyle = "#30383c";
        ctx.fillRect(ux, uy, unitSize, unitSize * 0.72);
        ctx.strokeStyle = "#8b989e";
        ctx.lineWidth = 1;
        ctx.strokeRect(ux, uy, unitSize, unitSize * 0.72);
      }

      const signWidth = Math.min(width * 0.56, size * 2.2);
      ctx.fillStyle = "rgba(27, 35, 42, 0.82)";
      ctx.fillRect(x + inset + size * 0.16, y + inset + size * 0.16, signWidth, size * 0.26);
      ctx.strokeStyle = lot.lightColor;
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.strokeRect(x + inset + size * 0.16, y + inset + size * 0.16, signWidth, size * 0.26);
      ctx.save();
      ctx.fillStyle = "#eef2f7";
      ctx.font = `700 ${Math.max(8, size * 0.14)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lot.sign, x + inset + size * 0.16 + signWidth * 0.5, y + inset + size * 0.29, signWidth - size * 0.12);
      ctx.restore();

      if (lot.kind === "bigBuilding") {
        ctx.strokeStyle = "rgba(215, 232, 235, 0.35)";
        ctx.lineWidth = Math.max(1, size * 0.025);
        ctx.beginPath();
        ctx.moveTo(x + width * 0.5, y + inset);
        ctx.lineTo(x + width * 0.5, y + height - inset);
        ctx.stroke();
      }
    }

    drawShop(ctx, lot, size, depthMode) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const inset = size * 0.12;
      const depth = depthMode ? size * 0.18 : size * 0.05;
      const palette = lot.palette;

      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(x + inset + depth, y + inset + depth, width - inset * 2, height - inset * 2);
      ctx.fillStyle = palette.side;
      ctx.fillRect(x + inset + depth * 0.45, y + inset + depth * 0.45, width - inset * 2, height - inset * 2);
      ctx.fillStyle = palette.roof;
      ctx.fillRect(x + inset, y + inset, width - inset * 2, height - inset * 2);

      const signH = size * 0.28;
      ctx.fillStyle = lot.accent;
      ctx.fillRect(x + inset + size * 0.1, y + inset + size * 0.08, width - inset * 2 - size * 0.2, signH);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.strokeRect(x + inset + size * 0.1, y + inset + size * 0.08, width - inset * 2 - size * 0.2, signH);

      const awningY = y + height - inset - size * 0.42;
      const awningHeight = size * 0.22;
      const stripeWidth = Math.max(size * 0.22, width / 8);
      for (let px = x + inset; px < x + width - inset; px += stripeWidth) {
        const index = Math.floor((px - x - inset) / stripeWidth);
        ctx.fillStyle = index % 2 === 0 ? lot.accent : "#f3ead8";
        ctx.fillRect(px, awningY, Math.min(stripeWidth, x + width - inset - px), awningHeight);
      }

      ctx.fillStyle = "rgba(75, 205, 224, 0.82)";
      ctx.fillRect(x + inset + size * 0.14, awningY + awningHeight + size * 0.04, width - inset * 2 - size * 0.28, size * 0.22);
      ctx.strokeStyle = "rgba(227, 247, 250, 0.72)";
      ctx.lineWidth = Math.max(1, size * 0.025);
      ctx.strokeRect(x + inset + size * 0.14, awningY + awningHeight + size * 0.04, width - inset * 2 - size * 0.28, size * 0.22);

      ctx.fillStyle = lot.lightColor;
      for (let i = 0; i < 4; i += 1) {
        const bx = x + inset + size * 0.25 + i * (width - inset * 2 - size * 0.5) / 3;
        ctx.beginPath();
        ctx.arc(bx, awningY - size * 0.05, Math.max(1.5, size * 0.035), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#171d20";
      ctx.fillRect(x + width * 0.43, y + height - inset - size * 0.18, width * 0.14, size * 0.18);

      ctx.save();
      ctx.fillStyle = "#f7f1df";
      ctx.font = `800 ${Math.max(9, size * 0.16)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lot.sign, x + width * 0.5, y + inset + size * 0.22, width - size * 0.4);
      ctx.restore();
    }

    drawStall(ctx, lot, size, depthMode) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const pad = size * 0.14;
      const depth = depthMode ? size * 0.12 : size * 0.04;

      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(x + pad + depth, y + pad + depth, width - pad * 2, height - pad * 2);

      const stripeWidth = Math.max(size * 0.2, width / 5);
      for (let px = x + pad; px < x + width - pad; px += stripeWidth) {
        const index = Math.floor((px - x - pad) / stripeWidth);
        ctx.fillStyle = index % 2 === 0 ? lot.accent : "#f7ecd5";
        ctx.fillRect(px, y + pad, Math.min(stripeWidth, x + width - pad - px), height * 0.48);
      }

      ctx.fillStyle = "#5b3822";
      ctx.fillRect(x + pad, y + height * 0.62, width - pad * 2, height * 0.2);
      ctx.fillStyle = "#d9a45f";
      ctx.fillRect(x + pad + size * 0.08, y + height * 0.66, width - pad * 2 - size * 0.16, height * 0.08);

      ctx.strokeStyle = "#3a2b22";
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(x + pad, y + pad);
      ctx.lineTo(x + pad, y + height - pad);
      ctx.moveTo(x + width - pad, y + pad);
      ctx.lineTo(x + width - pad, y + height - pad);
      ctx.stroke();

      ctx.save();
      ctx.fillStyle = "#fff6de";
      ctx.font = `700 ${Math.max(7, size * 0.12)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lot.sign.slice(0, Math.max(4, Math.min(8, lot.sign.length))), x + width * 0.5, y + height * 0.26, width - size * 0.08);
      ctx.restore();
    }

    drawMall(ctx, lot, size, depthMode) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const inset = size * 0.12;
      const depth = depthMode ? size * 0.2 : size * 0.05;

      ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
      ctx.fillRect(x + inset + depth, y + inset + depth, width - inset * 2, height - inset * 2);

      const shell = ctx.createLinearGradient(x, y, x + width, y + height);
      shell.addColorStop(0, "#5e6478");
      shell.addColorStop(1, "#868ea5");
      ctx.fillStyle = shell;
      ctx.fillRect(x + inset, y + inset, width - inset * 2, height - inset * 2);

      ctx.fillStyle = "rgba(110, 218, 240, 0.82)";
      ctx.fillRect(x + inset + size * 0.16, y + inset + size * 0.6, width - inset * 2 - size * 0.32, height - inset * 2 - size * 1.05);
      ctx.strokeStyle = "rgba(226, 246, 250, 0.84)";
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.strokeRect(x + inset + size * 0.16, y + inset + size * 0.6, width - inset * 2 - size * 0.32, height - inset * 2 - size * 1.05);

      ctx.fillStyle = "#28323d";
      ctx.fillRect(x + inset + size * 0.18, y + inset + size * 0.12, width - inset * 2 - size * 0.36, size * 0.38);
      ctx.strokeStyle = lot.lightColor;
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.strokeRect(x + inset + size * 0.18, y + inset + size * 0.12, width - inset * 2 - size * 0.36, size * 0.38);

      ctx.save();
      ctx.fillStyle = "#f7f4ea";
      ctx.font = `800 ${Math.max(8, size * 0.17)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lot.sign, x + width * 0.5, y + inset + size * 0.31, width - size * 0.6);
      ctx.font = `700 ${Math.max(6, size * 0.1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(lot.subSign, x + width * 0.5, y + inset + size * 0.48, width - size * 0.6);
      ctx.restore();

      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? lot.lightColor : "#fff5c0";
        ctx.beginPath();
        ctx.arc(x + inset + size * 0.34 + i * (width - inset * 2 - size * 0.68) / 4, y + inset + size * 0.54, Math.max(1.5, size * 0.035), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = "#151b21";
      ctx.fillRect(x + width * 0.44, y + height - inset - size * 0.2, width * 0.12, size * 0.2);
    }

    drawLotStreetProps(ctx, lot, size) {
      const frontY = (lot.y + lot.h) * size - size * 0.1;
      const leftX = lot.x * size + size * 0.32;
      const rightX = (lot.x + lot.w) * size - size * 0.32;
      const count = Math.min(2, lot.lampPosts || 1);

      if (count >= 1) this.drawLampPost(ctx, leftX, frontY, size, lot.lightColor);
      if (count >= 2 && lot.w > 1) this.drawLampPost(ctx, rightX, frontY, size, lot.lightColor);

      if ((lot.kind === "shop" || lot.kind === "mall") && lot.w >= 2) {
        this.drawBillboard(ctx, lot, size);
      }
    }

    drawLampPost(ctx, x, y, size, lightColor) {
      ctx.save();
      ctx.strokeStyle = "#2a3136";
      ctx.lineWidth = Math.max(1.5, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - size * 0.55);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y - size * 0.55);
      ctx.lineTo(x + size * 0.13, y - size * 0.67);
      ctx.stroke();
      ctx.fillStyle = lightColor;
      ctx.beginPath();
      ctx.arc(x + size * 0.17, y - size * 0.67, Math.max(1.5, size * 0.05), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 245, 190, 0.12)";
      ctx.beginPath();
      ctx.moveTo(x + size * 0.17, y - size * 0.62);
      ctx.lineTo(x + size * 0.32, y - size * 0.05);
      ctx.lineTo(x + size * 0.02, y - size * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawBillboard(ctx, lot, size) {
      const boardW = Math.min(lot.w * size * 0.46, size * 1.9);
      const boardH = size * 0.22;
      const bx = lot.x * size + lot.w * size * 0.5 - boardW * 0.5;
      const by = lot.y * size + lot.h * size - size * 0.52;
      ctx.fillStyle = "rgba(27, 35, 42, 0.96)";
      ctx.fillRect(bx, by, boardW, boardH);
      ctx.strokeStyle = lot.lightColor;
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.strokeRect(bx, by, boardW, boardH);
      ctx.save();
      ctx.fillStyle = "#eef3f8";
      ctx.font = `700 ${Math.max(6, size * 0.1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lot.subSign, bx + boardW * 0.5, by + boardH * 0.53, boardW - size * 0.1);
      ctx.restore();
    }

    drawCone(ctx, lot, size, depthMode) {
      const cx = (lot.x + 0.5) * size;
      const cy = (lot.y + 0.5) * size;
      const depth = depthMode ? size * 0.09 : size * 0.03;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.ellipse(depth, size * 0.18 + depth, size * 0.27, size * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#282d30";
      ctx.fillRect(-size * 0.3, size * 0.12, size * 0.6, size * 0.14);
      ctx.fillStyle = "#f47721";
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.34);
      ctx.lineTo(size * 0.21, size * 0.13);
      ctx.lineTo(-size * 0.21, size * 0.13);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#f8eee2";
      ctx.beginPath();
      ctx.moveTo(-size * 0.11, -size * 0.02);
      ctx.lineTo(size * 0.11, -size * 0.02);
      ctx.lineTo(size * 0.15, size * 0.07);
      ctx.lineTo(-size * 0.15, size * 0.07);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  window.MazeMap = MazeMap;
  window.MAZE_DIRECTIONS = DIRS;
})();
