(function () {
  "use strict";

  const canvas = document.getElementById("lobbyCreepCanvas");
  if (!canvas || !window.Creep) return;

  const ctx = canvas.getContext("2d");
  const elements = ["fire", "water", "lightning", "earth"];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const previewMap = {
    walkableNeighbors(x, y) {
      return [
        { x: x - 1, y },
        { x: x + 1, y }
      ];
    },
    hasLineOfSight() {
      return false;
    },
    findNearestFloor(x, y) {
      return { x, y };
    }
  };

  const creeps = elements.map((element, index) => {
    const creep = new window.Creep(element, { x: index * 1.35, y: 0 }, previewMap);
    creep.dir = { x: 1, y: 0 };
    creep.alerted = false;
    return creep;
  });

  let width = 760;
  let height = 132;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(280, Math.round(rect.width || 760));
    height = Math.max(92, Math.round(rect.height || 132));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);

    const tileSize = Math.min(72, height * 0.66);
    const groupWidth = tileSize * 5.45;
    const padding = tileSize * 0.38;
    const travel = Math.max(0, width - groupWidth - padding * 2);
    const seconds = now / 1000;
    const cycle = reducedMotion.matches ? 0.5 : (seconds % 8) / 8;
    const goingRight = cycle < 0.5;
    const progress = goingRight ? cycle * 2 : (1 - cycle) * 2;
    const direction = goingRight ? 1 : -1;
    const offsetX = padding + travel * progress;
    const offsetY = height * 0.5 - tileSize * 0.5;

    creeps.forEach((creep, index) => {
      creep.x = index * 1.35;
      creep.y = 0;
      creep.dir = { x: direction, y: 0 };
      creep.draw(ctx, {
        tileSize,
        offsetX,
        offsetY,
        width,
        height
      }, seconds);
    });

    window.requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  window.requestAnimationFrame(draw);
})();
