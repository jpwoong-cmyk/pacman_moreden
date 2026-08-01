(function () {
  "use strict";

  const canvas = document.getElementById("lobbyCreepCanvas");
  if (!canvas || !window.Creep) return;

  const stage = canvas.closest(".in-game-creep-track") || canvas.parentElement;
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

  const spacing = 1.18;
  const creeps = elements.map((element, index) => {
    const creep = new window.Creep(
      element,
      { x: index * spacing, y: 0 },
      previewMap
    );

    creep.dir = { x: 1, y: 0 };
    creep.alerted = false;
    return creep;
  });

  let width = 1;
  let height = 1;
  let lastWidth = 0;
  let lastHeight = 0;

  function resize() {
    const rect = stage?.getBoundingClientRect() || canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));

    if (nextWidth === lastWidth && nextHeight === lastHeight) return;

    lastWidth = nextWidth;
    lastHeight = nextHeight;
    width = nextWidth;
    height = nextHeight;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    resize();
    ctx.clearRect(0, 0, width, height);

    const count = creeps.length;
    const widthLimitedSize = width / ((count - 1) * spacing + 1.65);
    const tileSize = Math.max(
      28,
      Math.min(62, height * 0.74, widthLimitedSize)
    );

    const groupWidth = ((count - 1) * spacing + 1) * tileSize;
    const sidePadding = Math.max(7, tileSize * 0.2);
    const travel = Math.max(0, width - groupWidth - sidePadding * 2);

    const seconds = now / 1000;
    const cycle = reducedMotion.matches ? 0.5 : (seconds % 8) / 8;
    const goingRight = cycle < 0.5;
    const progress = goingRight ? cycle * 2 : (1 - cycle) * 2;
    const direction = goingRight ? 1 : -1;

    const offsetX = sidePadding + travel * progress;
    const offsetY = height * 0.5 - tileSize * 0.5;

    creeps.forEach((creep, index) => {
      creep.x = index * spacing;
      creep.y = 0;
      creep.dir = { x: direction, y: 0 };

      creep.draw(
        ctx,
        {
          tileSize,
          offsetX,
          offsetY,
          width,
          height
        },
        seconds
      );
    });

    window.requestAnimationFrame(draw);
  }

  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(resize)
      : null;

  resizeObserver?.observe(stage || canvas);
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("orientationchange", resize, { passive: true });

  resize();
  window.requestAnimationFrame(draw);
})();
