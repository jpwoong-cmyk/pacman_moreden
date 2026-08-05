(function () {
  "use strict";

  const WEATHER_SEGMENT_SECONDS = 32;
  const WEATHER_FADE_SECONDS = 5;
  const WET_GROUND_DECAY_SECONDS = 12;
  const SPRING_SHOWER_CYCLE_SECONDS = 45;

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  const WEATHER_PROFILES = Object.freeze({
    spring: [
      { id: "clear", name: "Clear", icon: "☀", weight: 34 },
      { id: "overcast", name: "Overcast", icon: "☁", weight: 25 },
      {
        id: "light-shower",
        name: "Light Shower",
        icon: "🌦",
        weight: 33,
        rain: 0.72,
        overcast: 0.55
      },
      { id: "mist", name: "Morning Mist", icon: "≋", weight: 8, mist: 0.58 }
    ],
    summer: [
      { id: "sunny", name: "Sunny", icon: "☀", weight: 53 },
      { id: "overcast", name: "Overcast", icon: "☁", weight: 19 },
      {
        id: "brief-rain",
        name: "Brief Rain",
        icon: "🌧",
        weight: 19,
        rain: 0.62,
        overcast: 0.5
      },
      { id: "heat-haze", name: "Heat Haze", icon: "⌁", weight: 9, haze: 0.45 }
    ],
    autumn: [
      { id: "clear", name: "Clear", icon: "☀", weight: 40 },
      { id: "breezy", name: "Breezy", icon: "〰", weight: 35, wind: 0.72 },
      { id: "mist", name: "Cool Mist", icon: "≋", weight: 16, mist: 0.5 },
      {
        id: "light-shower",
        name: "Light Shower",
        icon: "🌦",
        weight: 9,
        rain: 0.42,
        overcast: 0.38
      }
    ],
    winter: [
      { id: "frosty", name: "Frosty", icon: "❄", weight: 38, frost: 0.48 },
      { id: "overcast", name: "Overcast", icon: "☁", weight: 25, frost: 0.35 },
      {
        id: "light-snow",
        name: "Light Snow",
        icon: "❄",
        weight: 29,
        snow: 0.68,
        frost: 0.72,
        overcast: 0.42
      },
      {
        id: "snow-flurry",
        name: "Snow Flurry",
        icon: "✻",
        weight: 8,
        snow: 1,
        frost: 0.9,
        wind: 0.52,
        overcast: 0.58
      }
    ]
  });

  let activeMap = null;
  let activeRenderEnvironment = null;
  let originalSeasonAPI = null;
  let weatherInstalled = false;

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

    const source = String(value || "pac-weather");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  function seededHash(value) {
    let x = Math.trunc(value) || 1;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967295;
  }

  function worldHash(seed, slot, salt = 0) {
    return seededHash(
      normalizeSeed(seed) +
      Math.imul(Math.trunc(slot) + 1, 0x9e3779b1) +
      Math.imul(Math.trunc(salt) + 1, 0x85ebca6b)
    );
  }

  function seededMapHash(x, y, salt, seed) {
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

  function currentMapSeed() {
    return (
      activeMap?.roomSeed ??
      activeMap?.seed ??
      window.ElementalPacman?.getMapSeed?.() ??
      "PAC-WEATHER"
    );
  }

  function profileFor(seasonId, slot, seed = currentMapSeed()) {
    const profiles = WEATHER_PROFILES[seasonId] || WEATHER_PROFILES.spring;
    const totalWeight = profiles.reduce(
      (total, profile) => total + Math.max(0, Number(profile.weight) || 0),
      0
    );
    let roll = worldHash(seed, slot, seasonId.length) * totalWeight;

    for (const profile of profiles) {
      roll -= Math.max(0, Number(profile.weight) || 0);
      if (roll <= 0) return profile;
    }

    return profiles[profiles.length - 1];
  }

  function precipitationEnvelope(slotProgress) {
    return (
      smoothstep(0, WEATHER_FADE_SECONDS, slotProgress) *
      (1 - smoothstep(
        WEATHER_SEGMENT_SECONDS - WEATHER_FADE_SECONDS,
        WEATHER_SEGMENT_SECONDS,
        slotProgress
      ))
    );
  }

  function weatherForEnvironment(baseEnvironment = {}) {
    const elapsed = Math.max(0, Number(baseEnvironment.elapsed) || 0);
    const season = baseEnvironment.season || { id: "spring", name: "Spring" };
    const seasonId = season.id || "spring";
    const slot = Math.floor(elapsed / WEATHER_SEGMENT_SECONDS);
    const slotProgress =
      ((elapsed % WEATHER_SEGMENT_SECONDS) + WEATHER_SEGMENT_SECONDS) %
      WEATHER_SEGMENT_SECONDS;
    const envelope = precipitationEnvelope(slotProgress);
    const seed = currentMapSeed();
    const profile = profileFor(seasonId, slot, seed);
    const previousProfile = profileFor(seasonId, slot - 1, seed);

    const rainAmount = clamp((Number(profile.rain) || 0) * envelope, 0, 1);
    const snowAmount = clamp((Number(profile.snow) || 0) * envelope, 0, 1);
    const mistAmount = clamp(
      (Number(profile.mist) || 0) *
      (0.55 + 0.45 * Math.sin(Math.PI * slotProgress / WEATHER_SEGMENT_SECONDS)),
      0,
      1
    );
    const overcastAmount = clamp(
      Number(profile.overcast) ||
      (profile.id === "overcast" ? 0.72 : 0),
      0,
      1
    );
    const heatHazeAmount = clamp(Number(profile.haze) || 0, 0, 1);
    const windAmount = clamp(Number(profile.wind) || 0, 0, 1);

    const previousWetStrength = Math.max(
      Number(previousProfile.rain) || 0,
      Number(previousProfile.snow) || 0
    );
    const wetCarry =
      slotProgress < WET_GROUND_DECAY_SECONDS
        ? previousWetStrength * (1 - slotProgress / WET_GROUND_DECAY_SECONDS)
        : 0;
    const wetAmount = clamp(
      Math.max(rainAmount, snowAmount * 0.22, wetCarry * 0.62),
      0,
      1
    );

    const groundSnowAmount = seasonId === "winter"
      ? clamp(0.28 + (Number(profile.frost) || 0) * 0.3 + snowAmount * 0.45, 0, 1)
      : 0;

    return {
      id: profile.id,
      name: profile.name,
      icon: profile.icon,
      slot,
      slotProgress,
      segmentSeconds: WEATHER_SEGMENT_SECONDS,
      rainAmount,
      snowAmount,
      mistAmount,
      overcastAmount,
      heatHazeAmount,
      windAmount,
      wetAmount,
      groundSnowAmount,
      isPrecipitating: rainAmount > 0.02 || snowAmount > 0.02
    };
  }

  function enrichEnvironment(baseEnvironment = {}) {
    const weather = weatherForEnvironment(baseEnvironment);
    return {
      ...baseEnvironment,
      weather,
      weatherId: weather.id,
      weatherName: weather.name,
      weatherIcon: weather.icon,
      rainAmount: weather.rainAmount,
      showerAmount: weather.rainAmount,
      snowAmount: weather.snowAmount,
      mistAmount: weather.mistAmount,
      overcastAmount: weather.overcastAmount,
      wetAmount: weather.wetAmount,
      groundSnowAmount: weather.groundSnowAmount,
      windAmount: weather.windAmount,
      heatHazeAmount: weather.heatHazeAmount
    };
  }

  function findElapsedOffsetForShower(elapsed, targetCycle) {
    const daySeconds = Number(originalSeasonAPI?.daySeconds) || 40;
    const nightSeconds = Number(originalSeasonAPI?.nightSeconds) || 40;
    const cyclesPerSeason = Number(originalSeasonAPI?.cyclesPerSeason) || 2;
    const fullYearSeconds =
      Math.max(1, daySeconds + nightSeconds) *
      Math.max(1, cyclesPerSeason) *
      4;

    let bestOffset = 0;
    let bestDistance = Infinity;

    for (let multiplier = 0; multiplier < SPRING_SHOWER_CYCLE_SECONDS; multiplier += 1) {
      const offset = multiplier * fullYearSeconds;
      const cycle =
        ((elapsed + offset) % SPRING_SHOWER_CYCLE_SECONDS +
          SPRING_SHOWER_CYCLE_SECONDS) %
        SPRING_SHOWER_CYCLE_SECONDS;
      const direct = Math.abs(cycle - targetCycle);
      const wrapped = SPRING_SHOWER_CYCLE_SECONDS - direct;
      const distance = Math.min(direct, wrapped);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestOffset = offset;
      }
    }

    return bestOffset;
  }

  function spoofedSpringElapsed(baseEnvironment, weather) {
    const elapsed = Math.max(0, Number(baseEnvironment.elapsed) || 0);
    const targetCycle = weather.rainAmount > 0.58
      ? 20
      : weather.rainAmount > 0.08
        ? 12
        : 2;
    return elapsed + findElapsedOffsetForShower(elapsed, targetCycle);
  }

  function withSeasonClockOverride(environment, callback) {
    const livingCity = window.PacmanLivingCity;
    if (!livingCity?.getSharedElapsed || environment.season?.id !== "spring") {
      return callback();
    }

    const replacement = Object.freeze({
      ...livingCity,
      getSharedElapsed: () =>
        spoofedSpringElapsed(environment, environment.weather)
    });

    window.PacmanLivingCity = replacement;
    try {
      return callback();
    } finally {
      window.PacmanLivingCity = livingCity;
    }
  }

  function drawRainOverlay(ctx, viewport, environment) {
    const rain = clamp(Number(environment.rainAmount) || 0, 0, 1);
    if (rain <= 0.02) return;

    // Spring rain is already drawn by the existing 2D season renderer after
    // its clock is aligned with the shared weather state.
    if (environment.season?.id === "spring") return;

    const count = reducedMotionQuery.matches
      ? Math.round(18 + rain * 10)
      : Math.round(34 + rain * 42);
    const time = Number(environment.elapsed) || 0;

    ctx.save();
    ctx.strokeStyle = `rgba(174, 216, 230, ${0.12 + rain * 0.24})`;
    ctx.lineWidth = Math.max(0.8, 0.9 + rain * 0.55);

    for (let index = 0; index < count; index += 1) {
      const seed = seededHash(index * 811 + 97);
      const x =
        ((seed * viewport.width + time * (150 + seed * 65)) %
          (viewport.width + 100)) -
        50;
      const y =
        ((seededHash(index * 577 + 13) * viewport.height +
          time * (240 + seed * 90)) %
          (viewport.height + 120)) -
        60;
      const length = 9 + rain * 13 + seed * 5;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5 - rain * 3, y + length);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawSnowOverlay(ctx, viewport, environment) {
    const snow = clamp(Number(environment.snowAmount) || 0, 0, 1);
    if (snow <= 0.05) return;

    const count = reducedMotionQuery.matches
      ? Math.round(8 + snow * 12)
      : Math.round(12 + snow * 28);
    const time = Number(environment.elapsed) || 0;

    ctx.save();
    ctx.fillStyle = "rgba(244, 251, 255, 0.78)";

    for (let index = 0; index < count; index += 1) {
      const seed = seededHash(index * 929 + 71);
      const x =
        ((seed * viewport.width +
          Math.sin(time * 0.45 + index) * (18 + snow * 16) +
          index * 47) %
          (viewport.width + 70)) -
        35;
      const y =
        ((seededHash(index * 557 + 43) * viewport.height +
          time * (8 + seed * 12 + snow * 7) +
          index * 17) %
          (viewport.height + 80)) -
        40;

      ctx.globalAlpha = 0.22 + seed * 0.46;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + seed * 1.8 + snow * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawAtmosphereOverlay(ctx, viewport, environment) {
    const mist = clamp(Number(environment.mistAmount) || 0, 0, 1);
    const overcast = clamp(Number(environment.overcastAmount) || 0, 0, 1);
    const haze = clamp(Number(environment.heatHazeAmount) || 0, 0, 1);

    ctx.save();

    if (overcast > 0.02) {
      ctx.fillStyle = `rgba(44, 57, 64, ${overcast * 0.075})`;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }

    if (mist > 0.02) {
      const mistGradient = ctx.createLinearGradient(
        0,
        viewport.height * 0.25,
        0,
        viewport.height
      );
      mistGradient.addColorStop(0, "rgba(226, 238, 238, 0)");
      mistGradient.addColorStop(
        1,
        `rgba(218, 231, 231, ${0.08 + mist * 0.17})`
      );
      ctx.fillStyle = mistGradient;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }

    if (haze > 0.02) {
      const pulse = 0.5 + Math.sin((Number(environment.elapsed) || 0) * 0.7) * 0.5;
      ctx.fillStyle = `rgba(244, 194, 112, ${haze * (0.025 + pulse * 0.018)})`;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }

    ctx.restore();
  }

  function drawWeatherOverlay(ctx, viewport, environment) {
    drawAtmosphereOverlay(ctx, viewport, environment);
    drawRainOverlay(ctx, viewport, environment);
    drawSnowOverlay(ctx, viewport, environment);
  }

  function drawRoadWeather(ctx, x, y, size, environment) {
    if (!environment) return;

    const wet = clamp(Number(environment.wetAmount) || 0, 0, 1);
    const snow = clamp(Number(environment.groundSnowAmount) || 0, 0, 1);
    const px = x * size;
    const py = y * size;
    const seed = seededMapHash(x, y, 91, currentMapSeed());

    ctx.save();

    // Dark Singapore-style asphalt aggregate and occasional repaired seams.
    ctx.fillStyle = "rgba(16, 20, 22, 0.08)";
    for (let stone = 0; stone < 3; stone += 1) {
      const sx = px + size * seededMapHash(x, y, stone + 11, currentMapSeed());
      const sy = py + size * seededMapHash(x, y, stone + 31, currentMapSeed());
      ctx.fillRect(sx, sy, Math.max(0.7, size * 0.018), Math.max(0.7, size * 0.012));
    }

    if (seed > 0.82) {
      ctx.strokeStyle = "rgba(12, 15, 17, 0.2)";
      ctx.lineWidth = Math.max(1, size * 0.025);
      ctx.beginPath();
      ctx.moveTo(px + size * 0.12, py + size * 0.72);
      ctx.quadraticCurveTo(
        px + size * 0.48,
        py + size * 0.58,
        px + size * 0.9,
        py + size * 0.68
      );
      ctx.stroke();
    }

    if (wet > 0.03) {
      const shine = ctx.createLinearGradient(px, py, px + size, py + size);
      shine.addColorStop(0, `rgba(11, 20, 25, ${wet * 0.18})`);
      shine.addColorStop(0.48, `rgba(190, 221, 230, ${wet * 0.13})`);
      shine.addColorStop(0.62, `rgba(31, 51, 58, ${wet * 0.08})`);
      shine.addColorStop(1, `rgba(10, 16, 19, ${wet * 0.14})`);
      ctx.fillStyle = shine;
      ctx.fillRect(px, py, size + 0.5, size + 0.5);

      if (seed > 0.72) {
        ctx.fillStyle = `rgba(151, 196, 211, ${wet * 0.12})`;
        ctx.beginPath();
        ctx.ellipse(
          px + size * 0.68,
          py + size * 0.7,
          size * 0.18,
          size * 0.055,
          -0.18,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    if (snow > 0.08) {
      ctx.fillStyle = `rgba(231, 241, 244, ${snow * 0.42})`;
      ctx.fillRect(px, py, size, Math.max(1.5, size * 0.07));
      ctx.fillRect(px, py + size - Math.max(1.5, size * 0.06), size, Math.max(1.5, size * 0.06));
    }

    ctx.restore();
  }

  function drawWalkwayWeather(ctx, x, y, size, environment) {
    if (!environment) return;

    const wet = clamp(Number(environment.wetAmount) || 0, 0, 1);
    const snow = clamp(Number(environment.groundSnowAmount) || 0, 0, 1);
    const px = x * size;
    const py = y * size;

    ctx.save();

    // Grey rectangular concrete pavers with staggered joints, common on
    // Singapore pedestrian paths and estate walkways.
    ctx.strokeStyle = "rgba(75, 83, 85, 0.2)";
    ctx.lineWidth = Math.max(0.65, size * 0.014);
    const rowHeight = size / 3;

    for (let row = 1; row < 3; row += 1) {
      ctx.beginPath();
      ctx.moveTo(px, py + row * rowHeight);
      ctx.lineTo(px + size, py + row * rowHeight);
      ctx.stroke();
    }

    for (let row = 0; row < 3; row += 1) {
      const offset = row % 2 === 0 ? 0 : size * 0.25;
      for (let column = -1; column < 3; column += 1) {
        const jointX = px + offset + column * size * 0.5;
        ctx.beginPath();
        ctx.moveTo(jointX, py + row * rowHeight);
        ctx.lineTo(jointX, py + (row + 1) * rowHeight);
        ctx.stroke();
      }
    }

    ctx.fillStyle = "rgba(245, 244, 224, 0.12)";
    ctx.fillRect(px, py, Math.max(1, size * 0.035), size);

    if (wet > 0.03) {
      const shine = ctx.createLinearGradient(px, py, px + size, py + size);
      shine.addColorStop(0, `rgba(72, 93, 99, ${wet * 0.12})`);
      shine.addColorStop(0.5, `rgba(228, 240, 241, ${wet * 0.18})`);
      shine.addColorStop(1, `rgba(67, 83, 88, ${wet * 0.11})`);
      ctx.fillStyle = shine;
      ctx.fillRect(px, py, size + 0.5, size + 0.5);
    }

    if (snow > 0.04) {
      ctx.fillStyle = `rgba(235, 244, 246, ${0.28 + snow * 0.42})`;
      ctx.fillRect(px, py, size + 0.5, size + 0.5);
      ctx.strokeStyle = `rgba(126, 155, 164, ${0.12 + snow * 0.1})`;
      ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
    }

    ctx.restore();
  }

  function drawSeasonalParkTrees(ctx, lot, size, environment, mapSeed) {
    const seasonId = environment?.season?.id || "spring";
    const x = lot.x * size;
    const y = lot.y * size;
    const width = lot.w * size;
    const height = lot.h * size;
    const treePoints = [
      [0.18, 0.2],
      [0.82, 0.2],
      [0.2, 0.8],
      [0.8, 0.78]
    ];

    ctx.save();

    treePoints.forEach(([px, py], index) => {
      if (seededMapHash(lot.x, lot.y, index, mapSeed) < 0.18) return;

      const tx = x + width * px;
      const ty = y + height * py;
      const radius = Math.max(3, size * 0.17);

      if (seasonId === "winter") {
        // Cover the original green crown before drawing the winter silhouette.
        // This keeps the tree genuinely seasonal instead of adding snow on top
        // of a still-green canopy.
        ctx.fillStyle = "rgba(211, 224, 226, 0.96)";
        ctx.beginPath();
        ctx.arc(tx, ty, radius * 1.08, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(88, 68, 50, 0.92)";
        ctx.lineWidth = Math.max(1, size * 0.035);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx, ty + size * 0.15);
        ctx.lineTo(tx, ty - size * 0.13);
        ctx.moveTo(tx, ty - size * 0.05);
        ctx.lineTo(tx - size * 0.12, ty - size * 0.16);
        ctx.moveTo(tx, ty - size * 0.04);
        ctx.lineTo(tx + size * 0.13, ty - size * 0.14);
        ctx.stroke();

        ctx.fillStyle = `rgba(241, 248, 249, ${0.45 + environment.groundSnowAmount * 0.35})`;
        ctx.beginPath();
        ctx.ellipse(tx, ty - size * 0.15, radius * 0.72, radius * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      const colors = seasonId === "summer"
        ? ["rgba(25, 91, 42, 0.72)", "rgba(34, 111, 49, 0.7)"]
        : seasonId === "autumn"
          ? ["rgba(188, 99, 42, 0.74)", "rgba(218, 147, 52, 0.72)"]
          : ["rgba(62, 139, 71, 0.58)", "rgba(74, 155, 80, 0.55)"];

      ctx.fillStyle = colors[index % colors.length];
      ctx.beginPath();
      ctx.arc(tx, ty, radius * (seasonId === "summer" ? 1.06 : 1), 0, Math.PI * 2);
      ctx.fill();

      if (seasonId === "spring") {
        for (let blossom = 0; blossom < 3; blossom += 1) {
          const angle = blossom * (Math.PI * 2 / 3) + index;
          ctx.fillStyle = blossom % 2 === 0
            ? "rgba(244, 201, 225, 0.78)"
            : "rgba(248, 229, 208, 0.72)";
          ctx.beginPath();
          ctx.arc(
            tx + Math.cos(angle) * radius * 0.55,
            ty + Math.sin(angle) * radius * 0.45,
            Math.max(1, size * 0.024),
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      }
    });

    ctx.restore();
  }

  function updateWeatherStatus(environment) {
    const status = document.getElementById("seasonStatus");
    if (!status || status.hidden) return;

    const phase = String(environment.phase || "day").toUpperCase();
    const seasonName = String(environment.season?.name || "Spring").toUpperCase();
    const weatherName = String(environment.weather?.name || "Clear").toUpperCase();
    status.textContent =
      `${environment.season?.icon || "✦"} ${seasonName} · ${phase} · ` +
      `${environment.weather?.icon || "☀"} ${weatherName}`;
    status.dataset.weather = environment.weather?.id || "clear";
  }

  function install2DWeatherPatches() {
    const MapClass = window.MazeMap;
    if (!MapClass?.prototype || MapClass.prototype.__pacWeatherInstalled) return;

    const prototype = MapClass.prototype;
    const seasonDraw = prototype.draw;
    const seasonRoad = prototype.drawRoadTile;
    const seasonWalkway = prototype.drawWalkwayTile;
    const seasonPark = prototype.drawPark;

    prototype.drawRoadTile = function drawWeatherRoad(...args) {
      const result = seasonRoad.apply(this, args);
      drawRoadWeather(args[0], args[1], args[2], args[3], activeRenderEnvironment);
      return result;
    };

    prototype.drawWalkwayTile = function drawWeatherWalkway(...args) {
      const result = seasonWalkway.apply(this, args);
      drawWalkwayWeather(args[0], args[1], args[2], args[3], activeRenderEnvironment);
      return result;
    };

    if (typeof seasonPark === "function") {
      prototype.drawPark = function drawWeatherPark(...args) {
        const result = seasonPark.apply(this, args);
        if (activeRenderEnvironment) {
          drawSeasonalParkTrees(
            args[0],
            args[1],
            args[2],
            activeRenderEnvironment,
            this.roomSeed
          );
        }
        return result;
      };
    }

    prototype.draw = function drawSharedWeather(ctx, viewport, ...rest) {
      activeMap = this;
      const baseEnvironment = originalSeasonAPI.getEnvironment();
      const environment = enrichEnvironment(baseEnvironment);
      activeRenderEnvironment = environment;

      try {
        const result = withSeasonClockOverride(
          environment,
          () => seasonDraw.call(this, ctx, viewport, ...rest)
        );
        drawWeatherOverlay(ctx, viewport, environment);
        updateWeatherStatus(environment);
        return result;
      } finally {
        activeRenderEnvironment = null;
      }
    };

    prototype.__pacWeatherInstalled = true;
  }

  function installSeasonAPI() {
    if (!window.PacmanSeasons?.getEnvironment) return false;

    originalSeasonAPI = window.PacmanSeasons;
    const weatherAPI = Object.freeze({
      ...originalSeasonAPI,
      getEnvironment() {
        return enrichEnvironment(originalSeasonAPI.getEnvironment());
      }
    });
    window.PacmanSeasons = weatherAPI;
    return true;
  }

  function install() {
    if (weatherInstalled) return;
    if (!installSeasonAPI()) return;

    install2DWeatherPatches();
    weatherInstalled = true;
  }

  install();

  window.PacmanWeather = Object.freeze({
    segmentSeconds: WEATHER_SEGMENT_SECONDS,
    getCurrent() {
      const base = originalSeasonAPI?.getEnvironment?.() || {
        elapsed: Number(window.PacmanLivingCity?.getSharedElapsed?.()) || 0,
        season: { id: "spring", name: "Spring", icon: "✦" }
      };
      return weatherForEnvironment(base);
    },
    enrichEnvironment,
    profiles: WEATHER_PROFILES
  });
})();
