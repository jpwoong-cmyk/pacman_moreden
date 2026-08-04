(function () {
  "use strict";

  const STOP = { x: 0, y: 0 };

  function drawPacmanPath(ctx, radius, mouth) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, mouth, Math.PI * 2 - mouth);
    ctx.closePath();
  }

  function fallbackSkin(remote) {
    if (remote) {
      return {
        light: "#e4ca68",
        mid: "#c3a33d",
        dark: "#745416",
        glow: "rgba(195, 163, 61, 0.46)",
        labelColor: "#f3df9d",
        sparkle: false,
        metallic: false,
        element: null,
        accent: null,
        accentLight: null,
        particle: null
      };
    }

    return {
      light: "#e4ca68",
      mid: "#c3a33d",
      dark: "#745416",
      glow: "rgba(195, 163, 61, 0.46)",
      labelColor: "#f3df9d",
      sparkle: false,
      metallic: false,
      element: null,
      accent: null,
      accentLight: null,
      particle: null
    };
  }

  function drawMetallicSweep(ctx, radius, mouth, timeSeconds) {
    const sweep = ((timeSeconds * 0.42) % 1.8) - 0.4;
    const startX = -radius * 1.5 + sweep * radius * 2.4;

    ctx.save();
    drawPacmanPath(ctx, radius, mouth);
    ctx.clip();

    const metal = ctx.createLinearGradient(
      startX - radius * 0.55,
      -radius,
      startX + radius * 0.55,
      radius
    );
    metal.addColorStop(0, "rgba(255,255,255,0)");
    metal.addColorStop(0.38, "rgba(255,255,255,0.05)");
    metal.addColorStop(0.5, "rgba(255,255,255,0.72)");
    metal.addColorStop(0.62, "rgba(255,244,178,0.16)");
    metal.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = metal;
    ctx.fillRect(-radius * 1.4, -radius * 1.4, radius * 2.8, radius * 2.8);
    ctx.restore();
  }

  function drawElementAccent(ctx, radius, mouth, skin, timeSeconds) {
    if (!skin.element || !skin.accent) return;

    ctx.save();
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = radius * 0.38;
    ctx.strokeStyle = skin.accent;
    ctx.lineWidth = Math.max(1.2, radius * 0.09);
    drawPacmanPath(ctx, radius * 1.015, mouth);
    ctx.stroke();
    ctx.restore();

    const pulse = 0.65 + Math.sin(timeSeconds * 5.2) * 0.2;
    const particleCount = 3;

    ctx.save();
    ctx.fillStyle = skin.particle || skin.accent;
    ctx.globalCompositeOperation = "lighter";

    for (let index = 0; index < particleCount; index += 1) {
      const phase = timeSeconds * (1.2 + index * 0.18) + index * 2.1;
      const distance = radius * (0.72 + index * 0.28);
      const x = -radius - distance + Math.sin(phase) * radius * 0.18;
      const y = Math.cos(phase * 1.4) * radius * 0.42;
      const size = Math.max(1, radius * (0.055 + index * 0.012) * pulse);

      ctx.globalAlpha = 0.36 - index * 0.07;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawSparkles(ctx, radius, skin, timeSeconds) {
    if (!skin.sparkle) return;

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.globalCompositeOperation = "lighter";

    for (let index = 0; index < 2; index += 1) {
      const phase = timeSeconds * (0.9 + index * 0.3) + index * Math.PI;
      const x = Math.cos(phase) * radius * 0.72;
      const y = Math.sin(phase * 1.3) * radius * 0.66;
      const size = Math.max(0.8, radius * 0.045);

      ctx.globalAlpha = 0.42 + Math.sin(phase * 2.4) * 0.25;
      ctx.fillRect(x - size * 0.5, y - size * 1.7, size, size * 3.4);
      ctx.fillRect(x - size * 1.7, y - size * 0.5, size * 3.4, size);
    }

    ctx.restore();
  }

  class Pacman {
    constructor(startTile) {
      this.speed = 5.8;
      this.radius = 0.37;
      this.reset(startTile);
    }

    reset(startTile) {
      this.x = startTile.x;
      this.y = startTile.y;
      this.dir = { ...STOP };
      this.nextDir = { ...STOP };
      this.angle = 0;
      this.movingTime = 0;
    }

    setDirection(direction) {
      this.nextDir = { ...direction };
    }

    update(dt, map) {
      let remaining = this.speed * dt;
      let safety = 0;

      while (remaining > 0.0001 && safety < 6) {
        safety += 1;
        const centerX = Math.round(this.x);
        const centerY = Math.round(this.y);
        const atCenter = Math.abs(this.x - centerX) < 0.0001 && Math.abs(this.y - centerY) < 0.0001;

        if (atCenter) {
          this.x = centerX;
          this.y = centerY;

          const wantsToMove = this.nextDir.x !== 0 || this.nextDir.y !== 0;
          const canTakeNext = map.isWalkableTile(centerX + this.nextDir.x, centerY + this.nextDir.y);
          if (wantsToMove && canTakeNext) this.dir = { ...this.nextDir };

          const canContinue = map.isWalkableTile(centerX + this.dir.x, centerY + this.dir.y);
          if (!canContinue) this.dir = { ...STOP };
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

      if (this.dir.x !== 0 || this.dir.y !== 0) {
        this.angle = Math.atan2(this.dir.y, this.dir.x);
        this.movingTime += dt;
      }
    }

    distanceToNextCenter() {
      if (this.dir.x > 0) return Math.floor(this.x + 0.0001) + 1 - this.x;
      if (this.dir.x < 0) return this.x - (Math.ceil(this.x - 0.0001) - 1);
      if (this.dir.y > 0) return Math.floor(this.y + 0.0001) + 1 - this.y;
      if (this.dir.y < 0) return this.y - (Math.ceil(this.y - 0.0001) - 1);
      return 0;
    }

    draw(ctx, viewport, options = {}) {
      const { tileSize, offsetX, offsetY } = viewport;
      const cx = offsetX + (this.x + 0.5) * tileSize;
      const cy = offsetY + (this.y + 0.5) * tileSize;
      const radius = this.radius * tileSize;
      const moving = this.dir.x !== 0 || this.dir.y !== 0;
      const mouth = moving ? 0.14 + Math.abs(Math.sin(this.movingTime * 12)) * 0.28 : 0.08;
      const remote = options.variant === "remote";
      const timeSeconds = performance.now() / 1000;
      const skin =
        window.PacmanSkins?.resolveDrawSkin?.(options) ||
        fallbackSkin(remote);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.angle);

      ctx.shadowColor = skin.glow;
      ctx.shadowBlur = tileSize * (skin.metallic ? 0.34 : 0.24);

      const body = ctx.createRadialGradient(
        -radius * 0.3,
        -radius * 0.35,
        radius * 0.05,
        0,
        0,
        radius
      );
      body.addColorStop(0, skin.light);
      body.addColorStop(0.45, skin.mid);
      body.addColorStop(1, skin.dark);

      ctx.fillStyle = body;
      drawPacmanPath(ctx, radius, mouth);
      ctx.fill();

      if (skin.metallic) {
        drawMetallicSweep(ctx, radius, mouth, timeSeconds);
      }

      drawElementAccent(ctx, radius, mouth, skin, timeSeconds);
      drawSparkles(ctx, radius, skin, timeSeconds);

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#1a1300";
      ctx.beginPath();
      ctx.arc(radius * 0.13, -radius * 0.48, radius * 0.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(radius * 0.16, -radius * 0.51, radius * 0.035, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      if (remote && options.label) {
        ctx.save();
        ctx.font = `700 ${Math.max(10, tileSize * 0.2)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2, tileSize * 0.055);
        ctx.strokeStyle = "rgba(5, 8, 11, 0.88)";
        ctx.strokeText(options.label, cx, cy - radius - tileSize * 0.13);
        ctx.fillStyle = skin.labelColor || "#f2df9d";
        ctx.fillText(options.label, cx, cy - radius - tileSize * 0.13);
        ctx.restore();
      }
    }
  }

  window.Pacman = Pacman;
})();
