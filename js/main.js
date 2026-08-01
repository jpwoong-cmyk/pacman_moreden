(function () {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const roomValue = document.getElementById("roomValue");
  const scoreValue = document.getElementById("scoreValue");
  const pelletValue = document.getElementById("pelletValue");
  const creepValue = document.getElementById("creepValue");
  const alertValue = document.getElementById("alertValue");
  const spawnValue = document.getElementById("spawnValue");
  const overlay = document.getElementById("startOverlay");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayText = document.getElementById("overlayText");
  const startButton = document.getElementById("startButton");
  const newMapButton = document.getElementById("newMapButton");
  const viewButton = document.getElementById("viewButton");
  const pauseButton = document.getElementById("pauseButton");
  const leaveRoomButton = document.getElementById("leaveRoomButton");
  const swipeHint = document.querySelector(".swipe-hint");

  const state = {
    map: null,
    pellets: null,
    pacman: null,
    creeps: null,
    roomId: "------",
    score: 0,
    running: false,
    paused: false,
    gameOver: false,
    depthMode: true,
    elapsed: 0,
    spawnTimer: 10,
    lastTime: performance.now(),
    viewport: {
      tileSize: 50,
      offsetX: 0,
      offsetY: 0,
      width: 1280,
      height: 720
    }
  };

  const swipeState = {
    active: false,
    pointerId: null,
    x: 0,
    y: 0
  };

  const directionMap = {
    ArrowUp: { x: 0, y: -1 },
    KeyW: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    KeyS: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    KeyA: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    KeyD: { x: 1, y: 0 }
  };

  function normaliseRoomId(roomId) {
    const cleaned = String(roomId || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    return cleaned || "LOCAL1";
  }

  function buildGame(startImmediately = false, roomId = state.roomId) {
    state.roomId = normaliseRoomId(roomId);
    state.map = new MazeMap(65, 49);
    state.pellets = new PelletManager(state.map);
    state.pacman = new Pacman(state.map.getStartTile());
    state.creeps = new CreepManager(state.map);
    state.score = 0;
    state.elapsed = 0;
    state.spawnTimer = 10;
    state.paused = false;
    state.gameOver = false;
    pauseButton.textContent = "Pause";
    pauseButton.setAttribute("aria-pressed", "false");

    const exclusions = [state.pacman, ...state.map.spawnTiles];
    state.pellets.spawn(48, exclusions);
    state.creeps.spawnCornerWave();

    state.running = startImmediately;
    overlay.classList.add("hidden");
    resizeCanvas();
    updateCamera();
    updateHud();

    if (startImmediately) {
      state.lastTime = performance.now();
      canvas.focus({ preventScroll: true });
    }
  }

  function launchRoom(roomId) {
    buildGame(true, roomId);
  }

  function replayRoom() {
    buildGame(true, state.roomId);
  }

  function togglePause() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    pauseButton.textContent = state.paused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(state.paused));
    state.lastTime = performance.now();
  }

  function update(dt) {
    if (!state.running || state.paused || state.gameOver) return;

    state.elapsed += dt;
    state.spawnTimer -= dt;

    state.pacman.update(dt, state.map);
    state.creeps.update(dt, state.pacman, state.elapsed, state.pellets);

    if (state.pellets.collectAt(state.pacman.x, state.pacman.y)) {
      state.score += 10;
    }

    if (state.creeps.collidesWith(state.pacman)) {
      endGame();
      return;
    }

    if (state.spawnTimer <= 0) {
      const exclusions = [state.pacman, ...state.map.spawnTiles, ...state.creeps.creeps];
      state.pellets.spawn(5, exclusions);
      state.creeps.spawnCornerWave();
      state.spawnTimer += 10;
    }

    updateCamera();
    updateHud();
  }

  function endGame() {
    state.gameOver = true;
    state.running = false;
    overlayTitle.textContent = "Caught in the elemental city";
    overlayText.textContent = `Room ${state.roomId} ended with ${state.score} points. The streets are ready to rearrange.`;
    startButton.textContent = "Play Again";
    overlay.classList.remove("hidden");
  }

  function updateHud() {
    roomValue.textContent = state.roomId;
    scoreValue.textContent = String(state.score);
    pelletValue.textContent = String(state.pellets ? state.pellets.count : 0);
    creepValue.textContent = String(state.creeps ? state.creeps.count : 0);
    alertValue.textContent = String(state.creeps ? state.creeps.alertedCount : 0);
    spawnValue.textContent = `${Math.max(0, state.spawnTimer).toFixed(1)}s`;
  }

  function chooseTileSize(width) {
    if (width >= 1500) return 56;
    if (width >= 1100) return 52;
    if (width >= 760) return 46;
    return 40;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(430, Math.floor(rect.height));

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.viewport.width = width;
    state.viewport.height = height;
    state.viewport.tileSize = chooseTileSize(width);
    updateCamera();
  }

  function updateCamera() {
    if (!state.pacman) return;
    const { width, height, tileSize } = state.viewport;

    state.viewport.offsetX = width * 0.5 - (state.pacman.x + 0.5) * tileSize;
    state.viewport.offsetY = height * 0.5 - (state.pacman.y + 0.5) * tileSize;
  }

  function draw(timeSeconds) {
    const { width, height } = state.viewport;
    ctx.clearRect(0, 0, width, height);

    const background = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      40,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.75
    );
    background.addColorStop(0, "#182126");
    background.addColorStop(1, "#050709");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    if (!state.map) return;

    updateCamera();
    state.map.draw(ctx, state.viewport, state.depthMode);
    state.pellets.draw(ctx, state.viewport, timeSeconds);
    state.creeps.draw(ctx, state.viewport, timeSeconds);
    state.pacman.draw(ctx, state.viewport);
    drawCameraVignette(width, height);
  }

  function drawCameraVignette(width, height) {
    const vignette = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.2,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.05)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function frame(now) {
    const dt = Math.min(0.035, (now - state.lastTime) / 1000);
    state.lastTime = now;
    update(dt);
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  function setDirection(direction) {
    if (!state.pacman || !state.running || state.paused) return;
    state.pacman.setDirection(direction);
  }

  function readSwipe(event) {
    if (!swipeState.active || event.pointerId !== swipeState.pointerId) return false;

    const dx = event.clientX - swipeState.x;
    const dy = event.clientY - swipeState.y;
    const threshold = Math.max(24, Math.min(state.viewport.width, state.viewport.height) * 0.035);

    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return false;

    const direction = Math.abs(dx) > Math.abs(dy)
      ? { x: dx > 0 ? 1 : -1, y: 0 }
      : { x: 0, y: dy > 0 ? 1 : -1 };

    setDirection(direction);
    swipeState.x = event.clientX;
    swipeState.y = event.clientY;
    swipeHint?.classList.add("used");

    if (navigator.vibrate) navigator.vibrate(8);
    return true;
  }

  window.addEventListener("keydown", (event) => {
    const direction = directionMap[event.code];
    if (direction) {
      event.preventDefault();
      setDirection(direction);
    }

    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    }
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.preventDefault();
    swipeState.active = true;
    swipeState.pointerId = event.pointerId;
    swipeState.x = event.clientX;
    swipeState.y = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!swipeState.active) return;
    event.preventDefault();
    readSwipe(event);
  });

  function finishSwipe(event) {
    if (!swipeState.active || event.pointerId !== swipeState.pointerId) return;
    event.preventDefault();
    readSwipe(event);
    swipeState.active = false;
    swipeState.pointerId = null;
  }

  canvas.addEventListener("pointerup", finishSwipe);
  canvas.addEventListener("pointercancel", finishSwipe);

  startButton.addEventListener("click", replayRoom);
  newMapButton.addEventListener("click", replayRoom);
  pauseButton.addEventListener("click", togglePause);
  leaveRoomButton.addEventListener("click", () => {
    state.running = false;
    state.paused = true;
    overlay.classList.add("hidden");
    document.dispatchEvent(new CustomEvent("pacman:leave-room", {
      detail: { roomId: state.roomId }
    }));
  });

  viewButton.addEventListener("click", () => {
    state.depthMode = !state.depthMode;
    viewButton.textContent = state.depthMode ? "View: Depth" : "View: Flat";
    viewButton.setAttribute("aria-pressed", String(state.depthMode));
  });

  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.running && !state.gameOver) {
      state.paused = true;
      pauseButton.textContent = "Resume";
      pauseButton.setAttribute("aria-pressed", "true");
    }
  });

  window.ElementalPacman = Object.freeze({
    launchRoom,
    replayRoom,
    getRoomId: () => state.roomId,
    isRunning: () => state.running
  });

  buildGame(false, "LOCAL1");
  requestAnimationFrame(frame);
})();
