(function () {
  "use strict";

  const BaseMazeMap = window.MazeMap;
  if (!BaseMazeMap) return;

  const DAY_SECONDS = 120;
  const NIGHT_SECONDS = 120;
  const FULL_CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS;
  const CITIZEN_COLORS = [
    "#39424d",
    "#59636d",
    "#765b4e",
    "#486273",
    "#6b5f72",
    "#4e6252",
    "#7a6a52",
    "#374f5b"
  ];
  const OFFICE_NAMES = [
    "NORTHSTAR",
    "CIVIC TOWER",
    "CENTRAL WORKS",
    "METRO OFFICE",
    "CITY SERVICES"
  ];
  const SCHOOL_NAMES = [
    "CITY SCHOOL",
    "NORTH ACADEMY",
    "CENTRAL SCHOOL",
    "RIVERSIDE SCHOOL"
  ];
  const HOUSING_NAMES = [
    "RESIDENCE",
    "CITY HOMES",
    "GREEN COURT",
    "PARK VIEW",
    "METRO LIVING"
  ];
  const PARK_NAMES = [
    "CIVIC PARK",
    "GREEN COMMON",
    "CITY GARDEN",
    "CENTRAL PARK"
  ];

  let sharedElapsed = 0;
  let localEpoch = performance.now() / 1000;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function normalizeSeed(value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return (Math.trunc(numeric) >>> 0) || 1;

    const source = String(value || "pac-living-city");
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

  function seededHash(x, y, salt, seed) {
    let value = (
      Math.imul(Math.trunc(x) + 17, 374761393) +
      Math.imul(Math.trunc(y) + 29, 668265263) +
      Math.imul(Math.trunc(salt) + 41, 2246822519) +
      normalizeSeed(seed)
    ) >>> 0;
    value ^= value >>> 13;
    value = Math.imul(value, 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function shuffled(items, random) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function currentCycleSeconds() {
    const gameRunning = Boolean(window.ElementalPacman?.isRunning?.());
    const source = gameRunning
      ? sharedElapsed
      : Math.max(0, performance.now() / 1000 - localEpoch);
    return ((source % FULL_CYCLE_SECONDS) + FULL_CYCLE_SECONDS) % FULL_CYCLE_SECONDS;
  }

  function getEnvironment() {
    const cycleSeconds = currentCycleSeconds();
    let nightAmount = 0;

    if (cycleSeconds >= 110 && cycleSeconds < DAY_SECONDS) {
      nightAmount = smoothstep(110, DAY_SECONDS, cycleSeconds);
    } else if (cycleSeconds >= DAY_SECONDS && cycleSeconds < 230) {
      nightAmount = 1;
    } else if (cycleSeconds >= 230) {
      nightAmount = 1 - smoothstep(230, FULL_CYCLE_SECONDS, cycleSeconds);
    }

    return {
      cycleSeconds,
      nightAmount,
      dayAmount: 1 - nightAmount,
      isNight: cycleSeconds >= DAY_SECONDS,
      phase:
        cycleSeconds < 110
          ? "day"
          : cycleSeconds < DAY_SECONDS
            ? "dusk"
            : cycleSeconds < 230
              ? "night"
              : "dawn"
    };
  }

  function captureElapsed(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) sharedElapsed = parsed;
  }

  function installWorldClockBridge() {
    const sync = window.PacmanWorldSync;
    if (!sync || sync.__livingCityWrapped) return;

    window.PacmanWorldSync = Object.freeze({
      ...sync,
      __livingCityWrapped: true,
      sendFrame(frame) {
        captureElapsed(frame?.elapsed);
        return sync.sendFrame(frame);
      },
      sendSnapshot(snapshot, targetUserId = null) {
        captureElapsed(snapshot?.elapsed);
        return sync.sendSnapshot(snapshot, targetUserId);
      }
    });
  }

  installWorldClockBridge();

  document.addEventListener("pacman:shared-world-frame", (event) => {
    captureElapsed(event.detail?.frame?.elapsed);
  });

  document.addEventListener("pacman:shared-world-snapshot", (event) => {
    captureElapsed(event.detail?.snapshot?.elapsed);
  });

  document.addEventListener("pacman:room-started", () => {
    sharedElapsed = 0;
    localEpoch = performance.now() / 1000;
  });

  document.addEventListener("pacman:room-left", () => {
    sharedElapsed = 0;
    localEpoch = performance.now() / 1000;
  });

  class CitizenRoutineSystem {
    constructor(map) {
      this.map = map;
      this.random = createSeededRandom(mixSeed(map.roomSeed, 9107));
      this.citizens = [];
      this.buildCitizens();
    }

    buildCitizens() {
      const homes = this.map.lots.filter((lot) => lot.kind === "housing");
      const schools = this.map.lots.filter((lot) => lot.kind === "school");
      const offices = this.map.lots.filter((lot) => lot.kind === "office");
      const parks = this.map.lots.filter((lot) => lot.kind === "park");
      const commerce = this.map.lots.filter((lot) =>
        ["mall", "shop"].includes(lot.kind)
      );

      if (!homes.length) return;

      const citizenCount = Math.min(22, Math.max(14, homes.length * 3));

      for (let index = 0; index < citizenCount; index += 1) {
        const home = homes[index % homes.length];
        const roleRoll = this.random();
        let role = "worker";
        let destinations = offices.concat(commerce);

        if (roleRoll < 0.27 && schools.length) {
          role = "student";
          destinations = schools;
        } else if (roleRoll > 0.84 && parks.length) {
          role = "visitor";
          destinations = parks;
        }

        if (!destinations.length) destinations = parks.concat(commerce, offices);
        if (!destinations.length) continue;

        const destination = this.pickNearbyDestination(home, destinations);
        const start = home.entrance || this.map.getLotEntrance(home);
        const end = destination.entrance || this.map.getLotEntrance(destination);
        const route = this.findRoute(start, end);
        if (route.length < 2) continue;

        const speed = 1.18 + this.random() * 0.34;
        const travelSeconds = (route.length - 1) / speed;
        const leaveAt = 5 + this.random() * 25;
        const arrivalAt = leaveAt + travelSeconds;
        const latestReturnStart = Math.max(
          arrivalAt + 10,
          116 - travelSeconds
        );
        const proposedReturn = 84 + this.random() * 20;
        const returnAt = clamp(
          proposedReturn,
          arrivalAt + 10,
          latestReturnStart
        );

        this.citizens.push({
          id: `citizen-${index + 1}`,
          role,
          home,
          destination,
          route,
          speed,
          leaveAt,
          arrivalAt,
          returnAt,
          homeAt: returnAt + travelSeconds,
          phase: this.random() * Math.PI * 2,
          color: CITIZEN_COLORS[
            Math.floor(this.random() * CITIZEN_COLORS.length)
          ]
        });
      }
    }

    pickNearbyDestination(home, destinations) {
      const homePoint = home.entrance || this.map.getLotEntrance(home);
      const ranked = destinations
        .filter((lot) => lot !== home)
        .map((lot) => {
          const point = lot.entrance || this.map.getLotEntrance(lot);
          return {
            lot,
            distance: Math.hypot(point.x - homePoint.x, point.y - homePoint.y)
          };
        })
        .sort((a, b) => a.distance - b.distance);

      const pool = ranked.slice(0, Math.min(4, ranked.length));
      return pool[Math.floor(this.random() * pool.length)]?.lot || destinations[0];
    }

    findRoute(start, end) {
      const startKey = `${start.x},${start.y}`;
      const endKey = `${end.x},${end.y}`;
      if (startKey === endKey) return [start];

      const queue = [start];
      const visited = new Set([startKey]);
      const previous = new Map();
      let cursor = 0;

      while (cursor < queue.length) {
        const current = queue[cursor];
        cursor += 1;

        for (const next of this.map.walkableNeighbors(current.x, current.y)) {
          const key = `${next.x},${next.y}`;
          if (visited.has(key)) continue;

          visited.add(key);
          previous.set(key, current);

          if (key === endKey) {
            const path = [end];
            let step = current;
            while (step) {
              path.push(step);
              const stepKey = `${step.x},${step.y}`;
              if (stepKey === startKey) break;
              step = previous.get(stepKey);
            }
            return path.reverse();
          }

          queue.push(next);
        }
      }

      return [start];
    }

    positionAlong(route, distance, reverse = false) {
      const path = reverse ? route.slice().reverse() : route;
      const maxDistance = Math.max(0, path.length - 1);
      const safeDistance = clamp(distance, 0, maxDistance);
      const index = Math.min(path.length - 2, Math.floor(safeDistance));
      const progress = safeDistance - index;
      const from = path[index] || path[0];
      const to = path[index + 1] || from;

      return {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        dirX: Math.sign(to.x - from.x),
        dirY: Math.sign(to.y - from.y)
      };
    }

    parkPosition(citizen, cycleSeconds) {
      const lot = citizen.destination;
      const angle = cycleSeconds * 0.42 + citizen.phase;
      const radiusX = Math.max(0.15, Math.min(0.62, lot.w * 0.18));
      const radiusY = Math.max(0.15, Math.min(0.48, lot.h * 0.18));
      const centreX = lot.x + lot.w * 0.5 - 0.5;
      const centreY = lot.y + lot.h * 0.5 - 0.5;

      return {
        x: clamp(
          centreX + Math.cos(angle) * radiusX,
          lot.x,
          lot.x + lot.w - 1
        ),
        y: clamp(
          centreY + Math.sin(angle * 0.83) * radiusY,
          lot.y,
          lot.y + lot.h - 1
        ),
        dirX: Math.cos(angle) >= 0 ? 1 : -1,
        dirY: 0
      };
    }

    stateAt(citizen, cycleSeconds) {
      if (cycleSeconds >= DAY_SECONDS) return null;
      if (cycleSeconds < citizen.leaveAt) return null;

      if (cycleSeconds < citizen.arrivalAt) {
        return this.positionAlong(
          citizen.route,
          (cycleSeconds - citizen.leaveAt) * citizen.speed
        );
      }

      if (cycleSeconds < citizen.returnAt) {
        return citizen.destination.kind === "park"
          ? this.parkPosition(citizen, cycleSeconds)
          : null;
      }

      if (cycleSeconds < citizen.homeAt) {
        return this.positionAlong(
          citizen.route,
          (cycleSeconds - citizen.returnAt) * citizen.speed,
          true
        );
      }

      return null;
    }

    isVisible(position, viewport) {
      const screenX = viewport.offsetX + (position.x + 0.5) * viewport.tileSize;
      const screenY = viewport.offsetY + (position.y + 0.5) * viewport.tileSize;
      const padding = viewport.tileSize;
      return (
        screenX >= -padding &&
        screenX <= viewport.width + padding &&
        screenY >= -padding &&
        screenY <= viewport.height + padding
      );
    }

    drawCitizen(ctx, citizen, position, viewport, cycleSeconds, nightAmount) {
      if (!this.isVisible(position, viewport)) return;

      const size = Math.max(3.2, viewport.tileSize * 0.13);
      const cx = (position.x + 0.5) * viewport.tileSize;
      const cy = (position.y + 0.5) * viewport.tileSize;
      const step = Math.sin(cycleSeconds * 11 + citizen.phase) * size * 0.16;
      const facing = position.dirX < 0 ? -1 : 1;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 1 - nightAmount * 0.18;

      ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
      ctx.beginPath();
      ctx.ellipse(0, size * 0.36, size * 0.34, size * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#20262b";
      ctx.lineWidth = Math.max(1, size * 0.16);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-size * 0.08, size * 0.13);
      ctx.lineTo(-size * 0.16 + step, size * 0.4);
      ctx.moveTo(size * 0.08, size * 0.13);
      ctx.lineTo(size * 0.16 - step, size * 0.4);
      ctx.stroke();

      ctx.fillStyle = citizen.color;
      ctx.fillRect(-size * 0.2, -size * 0.13, size * 0.4, size * 0.42);

      ctx.fillStyle = "#c9a98c";
      ctx.beginPath();
      ctx.arc(0, -size * 0.3, size * 0.17, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(232, 238, 241, 0.62)";
      ctx.lineWidth = Math.max(0.7, size * 0.08);
      ctx.beginPath();
      ctx.moveTo(size * 0.04 * facing, -size * 0.3);
      ctx.lineTo(size * 0.12 * facing, -size * 0.3);
      ctx.stroke();

      ctx.restore();
    }

    draw(ctx, viewport, environment) {
      const cycleSeconds = environment.cycleSeconds;
      ctx.save();
      ctx.translate(viewport.offsetX, viewport.offsetY);

      this.citizens.forEach((citizen) => {
        const position = this.stateAt(citizen, cycleSeconds);
        if (!position) return;
        this.drawCitizen(
          ctx,
          citizen,
          position,
          viewport,
          cycleSeconds,
          environment.nightAmount
        );
      });

      ctx.restore();
    }
  }

  class LivingCityMap extends BaseMazeMap {
    constructor(...args) {
      super(...args);
      this._livingEnvironment = getEnvironment();
      this.applyLivingCityMix();
      this.citizenRoutines = new CitizenRoutineSystem(this);
    }

    applyLivingCityMix() {
      const random = createSeededRandom(mixSeed(this.roomSeed, 6421));
      const assigned = new Set();

      this.lots.forEach((lot, index) => {
        lot.livingId = lot.livingId || `lot-${index + 1}`;
      });

      const assignFrom = (kind, count, predicate) => {
        const candidates = shuffled(
          this.lots.filter((lot) => !assigned.has(lot) && predicate(lot)),
          random
        );

        candidates.slice(0, count).forEach((lot) => {
          assigned.add(lot);
          lot.originalKind = lot.originalKind || lot.kind;
          lot.kind = kind;
        });
      };

      const malls = shuffled(
        this.lots.filter((lot) => lot.kind === "mall"),
        random
      );
      malls.slice(3).forEach((lot, index) => {
        lot.originalKind = lot.kind;
        lot.kind = index % 2 === 0 ? "office" : "housing";
        assigned.add(lot);
      });

      assignFrom(
        "housing",
        7,
        (lot) => ["smallBuilding", "bigBuilding"].includes(lot.kind)
      );
      assignFrom(
        "office",
        3,
        (lot) =>
          ["bigBuilding", "smallBuilding"].includes(lot.kind) &&
          lot.w * lot.h >= 6
      );
      assignFrom(
        "school",
        2,
        (lot) =>
          ["bigBuilding", "smallBuilding", "shop"].includes(lot.kind) &&
          lot.w >= 3 &&
          lot.h >= 2
      );
      assignFrom(
        "park",
        3,
        (lot) =>
          ["smallBuilding", "shop", "stall"].includes(lot.kind) &&
          lot.w * lot.h >= 4
      );

      const existingMalls = this.lots.filter((lot) => lot.kind === "mall");
      if (existingMalls.length < 2) {
        assignFrom(
          "mall",
          2 - existingMalls.length,
          (lot) => lot.kind === "bigBuilding" && lot.w >= 4 && lot.h >= 3
        );
      }

      this.lots.forEach((lot, index) => {
        if (lot.kind === "housing") {
          lot.sign = HOUSING_NAMES[index % HOUSING_NAMES.length];
          lot.subSign = `BLOCK ${10 + (index % 30)}`;
        } else if (lot.kind === "office") {
          lot.sign = OFFICE_NAMES[index % OFFICE_NAMES.length];
          lot.subSign = "OFFICES";
        } else if (lot.kind === "school") {
          lot.sign = SCHOOL_NAMES[index % SCHOOL_NAMES.length];
          lot.subSign = "SCHOOL";
        } else if (lot.kind === "park") {
          lot.sign = PARK_NAMES[index % PARK_NAMES.length];
          lot.subSign = "PUBLIC PARK";

          for (let y = lot.y; y < lot.y + lot.h; y += 1) {
            for (let x = lot.x; x < lot.x + lot.w; x += 1) {
              if (this.inBounds(x, y)) this.grid[y][x] = 0;
            }
          }
        }
      });

      this.buildSurfaceMap();
      this.spawnTiles = this.getCornerSpawnTiles();

      this.lots.forEach((lot) => {
        lot.entrance = this.getLotEntrance(lot);
      });
    }

    getLotEntrance(lot) {
      if (!lot) return this.getStartTile();

      if (lot.kind === "park") {
        return this.findNearestFloor(
          lot.x + Math.floor(lot.w / 2),
          lot.y + Math.floor(lot.h / 2)
        );
      }

      const candidates = [];
      for (let x = lot.x; x < lot.x + lot.w; x += 1) {
        candidates.push({ x, y: lot.y - 1 });
        candidates.push({ x, y: lot.y + lot.h });
      }
      for (let y = lot.y; y < lot.y + lot.h; y += 1) {
        candidates.push({ x: lot.x - 1, y });
        candidates.push({ x: lot.x + lot.w, y });
      }

      const walkable = candidates.filter((tile) =>
        this.isWalkableTile(tile.x, tile.y)
      );
      if (!walkable.length) {
        return this.findNearestFloor(
          lot.x + Math.floor(lot.w / 2),
          lot.y + lot.h
        );
      }

      return walkable
        .map((tile) => {
          const surface = this.getSurface(tile.x, tile.y);
          const score = surface.type === "walkway" ? 3 : 1;
          return {
            tile,
            score: score + seededHash(tile.x, tile.y, 73, this.roomSeed)
          };
        })
        .sort((a, b) => b.score - a.score)[0].tile;
    }

    drawRoadTile(ctx, x, y, size, showLaneMarkings = true) {
      super.drawRoadTile(ctx, x, y, size, showLaneMarkings);
      if (!showLaneMarkings) return;

      const north = this.isRoadSurface(x, y - 1);
      const south = this.isRoadSurface(x, y + 1);
      const west = this.isRoadSurface(x - 1, y);
      const east = this.isRoadSurface(x + 1, y);
      const px = x * size;
      const py = y * size;

      ctx.save();
      ctx.strokeStyle = "rgba(226, 217, 174, 0.3)";
      ctx.lineWidth = Math.max(1, size * 0.025);
      ctx.setLineDash([size * 0.18, size * 0.24]);

      if (north && south && !west && !east) {
        ctx.beginPath();
        ctx.moveTo(px + size * 0.5, py + size * 0.12);
        ctx.lineTo(px + size * 0.5, py + size * 0.88);
        ctx.stroke();
      } else if (west && east && !north && !south) {
        ctx.beginPath();
        ctx.moveTo(px + size * 0.12, py + size * 0.5);
        ctx.lineTo(px + size * 0.88, py + size * 0.5);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(12, 17, 19, 0.22)";
      ctx.beginPath();
      ctx.arc(
        px + size * 0.18,
        py + size * 0.8,
        Math.max(1, size * 0.035),
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }

    drawLot(ctx, lot, size, depthMode) {
      if (lot.kind === "park") {
        this.drawPark(ctx, lot, size);
        return;
      }

      super.drawLot(ctx, lot, size, depthMode);

      if (lot.kind === "housing") {
        this.drawHousingDetails(ctx, lot, size);
      } else if (lot.kind === "office") {
        this.drawOfficeDetails(ctx, lot, size);
      } else if (lot.kind === "school") {
        this.drawSchoolDetails(ctx, lot, size);
      }
    }

    drawHousingDetails(ctx, lot, size) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const rows = Math.max(2, Math.min(4, lot.h + 1));
      const columns = Math.max(2, Math.min(6, lot.w * 2));

      ctx.save();
      ctx.strokeStyle = "rgba(231, 236, 233, 0.38)";
      ctx.lineWidth = Math.max(1, size * 0.025);

      for (let row = 0; row < rows; row += 1) {
        const by = y + size * 0.42 + row * (height - size * 0.84) / rows;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.24, by);
        ctx.lineTo(x + width - size * 0.24, by);
        ctx.stroke();
      }

      for (let column = 1; column < columns; column += 1) {
        const bx = x + size * 0.24 + column * (width - size * 0.48) / columns;
        ctx.beginPath();
        ctx.moveTo(bx, y + size * 0.35);
        ctx.lineTo(bx, y + height - size * 0.25);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(47, 58, 62, 0.9)";
      ctx.fillRect(
        x + width * 0.42,
        y + height - size * 0.34,
        width * 0.16,
        size * 0.24
      );
      ctx.restore();
    }

    drawOfficeDetails(ctx, lot, size) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const inset = size * 0.24;

      ctx.save();
      const glass = ctx.createLinearGradient(x, y, x + width, y + height);
      glass.addColorStop(0, "rgba(175, 222, 231, 0.42)");
      glass.addColorStop(1, "rgba(54, 98, 112, 0.58)");
      ctx.fillStyle = glass;
      ctx.fillRect(
        x + inset,
        y + inset,
        width - inset * 2,
        height - inset * 2
      );

      ctx.strokeStyle = "rgba(224, 241, 244, 0.36)";
      ctx.lineWidth = Math.max(1, size * 0.02);
      const columns = Math.max(3, lot.w * 2);
      for (let index = 1; index < columns; index += 1) {
        const gx = x + inset + index * (width - inset * 2) / columns;
        ctx.beginPath();
        ctx.moveTo(gx, y + inset);
        ctx.lineTo(gx, y + height - inset);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawSchoolDetails(ctx, lot, size) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;

      ctx.save();
      ctx.fillStyle = "rgba(224, 191, 105, 0.86)";
      ctx.fillRect(
        x + size * 0.18,
        y + size * 0.18,
        width - size * 0.36,
        size * 0.18
      );

      ctx.strokeStyle = "rgba(240, 242, 230, 0.52)";
      ctx.lineWidth = Math.max(1, size * 0.025);
      ctx.strokeRect(
        x + size * 0.28,
        y + height * 0.56,
        width - size * 0.56,
        height * 0.24
      );
      ctx.beginPath();
      ctx.moveTo(x + width * 0.5, y + height * 0.56);
      ctx.lineTo(x + width * 0.5, y + height * 0.8);
      ctx.stroke();
      ctx.restore();
    }

    drawPark(ctx, lot, size) {
      const x = lot.x * size;
      const y = lot.y * size;
      const width = lot.w * size;
      const height = lot.h * size;
      const seed = this.roomSeed;

      ctx.save();
      ctx.fillStyle = "#4d7444";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "rgba(177, 203, 143, 0.48)";
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);

      ctx.strokeStyle = "rgba(207, 197, 166, 0.74)";
      ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + width * 0.12, y + height * 0.5);
      ctx.lineTo(x + width * 0.88, y + height * 0.5);
      ctx.moveTo(x + width * 0.5, y + height * 0.14);
      ctx.lineTo(x + width * 0.5, y + height * 0.86);
      ctx.stroke();

      const treePoints = [
        [0.18, 0.2],
        [0.82, 0.2],
        [0.2, 0.8],
        [0.8, 0.78]
      ];

      treePoints.forEach(([px, py], index) => {
        if (seededHash(lot.x, lot.y, index, seed) < 0.18) return;
        const tx = x + width * px;
        const ty = y + height * py;
        ctx.fillStyle = "rgba(35, 46, 33, 0.34)";
        ctx.beginPath();
        ctx.ellipse(
          tx + size * 0.06,
          ty + size * 0.08,
          size * 0.2,
          size * 0.11,
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = index % 2 === 0 ? "#2f5f35" : "#3a6d3d";
        ctx.beginPath();
        ctx.arc(tx, ty, Math.max(3, size * 0.17), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#6e5135";
        ctx.fillRect(tx - size * 0.025, ty, size * 0.05, size * 0.18);
      });

      ctx.fillStyle = "rgba(92, 69, 48, 0.9)";
      ctx.fillRect(
        x + width * 0.34,
        y + height * 0.66,
        width * 0.32,
        Math.max(2, size * 0.07)
      );
      ctx.restore();
    }

    drawLampPost(ctx, x, y, size, lightColor) {
      const nightAmount = this._livingEnvironment?.nightAmount || 0;

      ctx.save();
      ctx.strokeStyle = "#2a3136";
      ctx.lineWidth = Math.max(1.5, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - size * 0.55);
      ctx.lineTo(x + size * 0.13, y - size * 0.67);
      ctx.stroke();

      ctx.fillStyle = nightAmount > 0.08 ? lightColor : "#7d8588";
      ctx.beginPath();
      ctx.arc(
        x + size * 0.17,
        y - size * 0.67,
        Math.max(1.5, size * 0.05),
        0,
        Math.PI * 2
      );
      ctx.fill();

      if (nightAmount > 0.02) {
        ctx.globalAlpha = nightAmount * 0.32;
        ctx.fillStyle = lightColor;
        ctx.beginPath();
        ctx.moveTo(x + size * 0.17, y - size * 0.61);
        ctx.lineTo(x + size * 0.38, y - size * 0.03);
        ctx.lineTo(x - size * 0.04, y - size * 0.03);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    drawAmbientOverlay(ctx, viewport, environment) {
      const nightAmount = environment.nightAmount;
      if (nightAmount <= 0.001) return;

      ctx.save();
      ctx.fillStyle = `rgba(5, 10, 25, ${0.58 * nightAmount})`;
      ctx.fillRect(0, 0, viewport.width, viewport.height);

      if (environment.phase === "dusk") {
        const dusk = smoothstep(0, 1, nightAmount);
        const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
        gradient.addColorStop(0, `rgba(103, 55, 44, ${0.16 * dusk})`);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, viewport.width, viewport.height);
      }
      ctx.restore();
    }

    drawLightEffects(ctx, viewport, environment) {
      const nightAmount = environment.nightAmount;
      if (nightAmount <= 0.02) return;

      const visible = this.getVisibleBounds(viewport, 3);
      const size = viewport.tileSize;

      ctx.save();
      ctx.translate(viewport.offsetX, viewport.offsetY);
      ctx.globalCompositeOperation = "lighter";

      this.lots.forEach((lot) => {
        if (
          lot.x > visible.maxX + 2 ||
          lot.y > visible.maxY + 2 ||
          lot.x + lot.w < visible.minX - 2 ||
          lot.y + lot.h < visible.minY - 2
        ) {
          return;
        }

        if (lot.kind === "park" || lot.kind === "cone") return;

        const x = lot.x * size;
        const y = lot.y * size;
        const width = lot.w * size;
        const height = lot.h * size;
        const columns = Math.max(2, Math.min(7, lot.w * 2));
        const rows = Math.max(1, Math.min(4, lot.h));

        ctx.fillStyle = `rgba(255, 220, 132, ${0.56 * nightAmount})`;
        ctx.shadowColor = lot.lightColor || "#ffe3a0";
        ctx.shadowBlur = size * 0.12 * nightAmount;

        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            if (
              seededHash(
                lot.x + column,
                lot.y + row,
                row * 17 + column,
                this.roomSeed
              ) < 0.46
            ) {
              continue;
            }

            const wx = x + width * (column + 0.5) / columns;
            const wy = y + height * (row + 0.65) / (rows + 1);
            ctx.fillRect(
              wx - size * 0.045,
              wy - size * 0.035,
              size * 0.09,
              size * 0.07
            );
          }
        }

        if (["shop", "mall"].includes(lot.kind)) {
          ctx.fillStyle = `rgba(128, 225, 245, ${0.36 * nightAmount})`;
          ctx.fillRect(
            x + width * 0.22,
            y + size * 0.2,
            width * 0.56,
            Math.max(2, size * 0.08)
          );
        }

        const lampY = (lot.y + lot.h) * size - size * 0.75;
        const lampX = lot.x * size + size * 0.49;
        const glow = ctx.createRadialGradient(
          lampX,
          lampY,
          0,
          lampX,
          lampY,
          size * 0.55
        );
        glow.addColorStop(0, `rgba(255, 235, 171, ${0.34 * nightAmount})`);
        glow.addColorStop(1, "rgba(255, 235, 171, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lampX, lampY, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();
    }

    draw(ctx, viewport, depthMode = true) {
      const environment = getEnvironment();
      this._livingEnvironment = environment;

      super.draw(ctx, viewport, depthMode);
      this.drawAmbientOverlay(ctx, viewport, environment);
      this.drawLightEffects(ctx, viewport, environment);
      this.citizenRoutines?.draw(ctx, viewport, environment);
    }
  }

  window.MazeMap = LivingCityMap;
  window.PacmanLivingCity = Object.freeze({
    getEnvironment,
    getSharedElapsed: () => sharedElapsed,
    daySeconds: DAY_SECONDS,
    nightSeconds: NIGHT_SECONDS
  });
})();
