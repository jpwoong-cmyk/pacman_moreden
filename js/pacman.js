(function () {
  "use strict";

  const STOP = { x: 0, y: 0 };

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

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.angle);

      ctx.shadowColor = remote
        ? "rgba(207, 218, 229, 0.68)"
        : "rgba(255, 202, 37, 0.62)";
      ctx.shadowBlur = tileSize * 0.24;

      const body = ctx.createRadialGradient(
        -radius * 0.3,
        -radius * 0.35,
        radius * 0.05,
        0,
        0,
        radius
      );

      if (remote) {
        body.addColorStop(0, "#ffffff");
        body.addColorStop(0.42, "#c9d0d8");
        body.addColorStop(1, "#69717c");
      } else {
        body.addColorStop(0, "#fff47a");
        body.addColorStop(0.45, "#ffd632");
        body.addColorStop(1, "#d59a00");
      }

      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, mouth, Math.PI * 2 - mouth);
      ctx.closePath();
      ctx.fill();

      if (remote) {
        ctx.strokeStyle = "rgba(244, 248, 252, 0.76)";
        ctx.lineWidth = Math.max(1, tileSize * 0.025);
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      ctx.fillStyle = remote ? "#1d232a" : "#1a1300";
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
        ctx.strokeStyle = "rgba(5, 8, 11, 0.86)";
        ctx.strokeText(options.label, cx, cy - radius - tileSize * 0.13);
        ctx.fillStyle = "#e3e8ee";
        ctx.fillText(options.label, cx, cy - radius - tileSize * 0.13);
        ctx.restore();
      }
    }

  }

  window.Pacman = Pacman;
})();
