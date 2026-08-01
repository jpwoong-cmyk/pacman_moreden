(function () {
  "use strict";

  const POSITION_BROADCAST_INTERVAL = 1 / 12;
  const WORLD_FRAME_INTERVAL = 0.1;
  const WORLD_SNAPSHOT_INTERVAL = 2;
  const WORLD_SAVE_INTERVAL = 5;
  const STARTING_PELLET_COUNT = 180;
  const RESPAWN_DELAY_SECONDS = 3;

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
    remotePlayers: null,
    room: null,
    roster: [],
    currentUserId: null,
    playerSlot: 1,
    roomId: "------",
    mapSeed: 1,
    scores: new Map(),
    alive: new Map(),
    respawnAt: new Map(),
    alertedUserIds: new Set(),
    running: false,
    worldReady: false,
    sharedPaused: false,
    localCaught: false,
    depthMode: true,
    elapsed: 0,
    spawnTimer: 10,
    broadcastAccumulator: 0,
    worldFrameAccumulator: 0,
    worldSnapshotAccumulator: 0,
    worldSaveAccumulator: 0,
    broadcastSequence: 0,
    lastTime: performance.now(),
    overlayAction: "none",
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

  function normaliseRoom(roomOrCode) {
    if (roomOrCode && typeof roomOrCode === "object") {
      return {
        ...roomOrCode,
        code: normaliseRoomId(roomOrCode.code)
      };
    }

    return {
      id: null,
      code: normaliseRoomId(roomOrCode),
      map_seed: String(roomOrCode || "LOCAL1"),
      status: "playing",
      host_user_id: "local-player"
    };
  }

  function getCurrentMembership(players, currentUserId) {
    return players.find((player) => player.user_id === currentUserId) || null;
  }

  function generateMapSeed() {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return Number(values[0]);
  }

  function objectFromMap(map) {
    return Object.fromEntries(map.entries());
  }

  function mapFromObject(value, normalise = (item) => item) {
    const map = new Map();
    Object.entries(value || {}).forEach(([key, item]) => {
      map.set(key, normalise(item));
    });
    return map;
  }

  function isHost() {
    return Boolean(window.PacmanWorldSync?.isHost());
  }

  function localAlive() {
    return state.alive.get(state.currentUserId) !== false;
  }

  function localScore() {
    return Math.max(0, Number(state.scores.get(state.currentUserId)) || 0);
  }

  function startTileForUser(userId) {
    const member = state.roster.find((item) => item.user_id === userId);
    return state.map.getPlayerStartTile(member?.player_slot || 1);
  }

  function ensureRosterState() {
    state.roster.forEach((member) => {
      if (!state.scores.has(member.user_id)) {
        state.scores.set(member.user_id, 0);
      }
      if (!state.alive.has(member.user_id)) {
        state.alive.set(member.user_id, true);
      }
    });

    if (state.currentUserId) {
      if (!state.scores.has(state.currentUserId)) {
        state.scores.set(state.currentUserId, 0);
      }
      if (!state.alive.has(state.currentUserId)) {
        state.alive.set(state.currentUserId, true);
      }
    }
  }

  function createGameObjects(mapSeed, resetLocalPlayer = true) {
    state.mapSeed = mapSeed;
    state.map = new MazeMap(65, 49, state.mapSeed);
    state.pellets = new PelletManager(state.map);
    state.creeps = new CreepManager(state.map);

    if (resetLocalPlayer || !state.pacman) {
      state.pacman = new Pacman(
        state.map.getPlayerStartTile(state.playerSlot)
      );
    }

    state.remotePlayers = new RemotePlayerManager(
      state.map,
      state.currentUserId
    );
    state.remotePlayers.setRoster(state.roster);
  }

  function setOverlay(title, text, buttonText = "", action = "none") {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    startButton.textContent = buttonText || "Continue";
    startButton.hidden = !buttonText;
    state.overlayAction = action;
    overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
    state.overlayAction = "none";
  }

  function showSyncOverlay() {
    setOverlay(
      "Synchronising shared city",
      "Loading the room's shared pellets, creeps, scores, and timers…",
      "",
      "sync"
    );
  }

  function showCaughtOverlay() {
    state.localCaught = true;
    setOverlay(
      "Caught in the shared city",
      `You keep your ${localScore()} points. Respawn begins automatically in ${RESPAWN_DELAY_SECONDS} seconds.`,
      "Watch City",
      "watch"
    );

    if (window.PacmanLeaderboard) {
      void window.PacmanLeaderboard.submitScore(localScore())
        .then(() => window.PacmanLeaderboard.refreshTicker())
        .catch(() => {});
    }
  }

  function applyLocalAliveState(alive, playerState = null) {
    const nextAlive = alive !== false;
    state.alive.set(state.currentUserId, nextAlive);

    if (!nextAlive && !state.localCaught) {
      showCaughtOverlay();
      window.PacmanAudio?.setDangerActive(false);
      return;
    }

    if (nextAlive && state.localCaught) {
      state.localCaught = false;

      const x = Number(playerState?.x);
      const y = Number(playerState?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        state.pacman.x = x;
        state.pacman.y = y;
      } else {
        const start = startTileForUser(state.currentUserId);
        state.pacman.x = start.x;
        state.pacman.y = start.y;
      }

      state.pacman.dir = { x: 0, y: 0 };
      hideOverlay();
      canvas.focus({ preventScroll: true });
    }
  }

  function playerStatesFromActors(actors) {
    return actors.map((actor) => ({
      userId: actor.userId,
      playerSlot: actor.playerSlot,
      x: Number(actor.x.toFixed(4)),
      y: Number(actor.y.toFixed(4)),
      dirX: Number(actor.dir?.x) || 0,
      dirY: Number(actor.dir?.y) || 0,
      angle: Number(actor.angle) || 0,
      alive: state.alive.get(actor.userId) !== false,
      score: Math.max(0, Number(state.scores.get(actor.userId)) || 0)
    }));
  }

  function localActor() {
    return {
      userId: state.currentUserId,
      playerSlot: state.playerSlot,
      x: state.pacman.x,
      y: state.pacman.y,
      dir: { ...state.pacman.dir },
      angle: state.pacman.angle,
      radius: state.pacman.radius,
      alive: localAlive(),
      score: localScore()
    };
  }

  function allPlayerActors() {
    return [localActor(), ...state.remotePlayers.getPlayerActors()].map(
      (actor) => ({
        ...actor,
        alive: state.alive.get(actor.userId) !== false,
        score: Math.max(0, Number(state.scores.get(actor.userId)) || 0)
      })
    );
  }

  function buildWorldFrame() {
    const actors = allPlayerActors();

    return {
      elapsed: state.elapsed,
      spawnTimer: state.spawnTimer,
      paused: state.sharedPaused,
      creeps: state.creeps.toSnapshot(),
      scores: objectFromMap(state.scores),
      alive: objectFromMap(state.alive),
      respawnAt: objectFromMap(state.respawnAt),
      alertedUserIds: state.creeps.getAlertedUserIds(),
      players: playerStatesFromActors(actors)
    };
  }

  function buildWorldSnapshot() {
    return {
      schemaVersion: 1,
      roomId: state.room?.id || null,
      mapSeed: state.mapSeed,
      elapsed: state.elapsed,
      spawnTimer: state.spawnTimer,
      paused: state.sharedPaused,
      pellets: state.pellets.toSnapshot(),
      creeps: state.creeps.toSnapshot(),
      scores: objectFromMap(state.scores),
      alive: objectFromMap(state.alive),
      respawnAt: objectFromMap(state.respawnAt),
      alertedUserIds: Array.from(state.alertedUserIds),
      players: playerStatesFromActors(allPlayerActors())
    };
  }

  function applyPlayerStates(playerStates = []) {
    state.remotePlayers.applyWorldPlayers(playerStates);

    const local = playerStates.find(
      (player) => player.userId === state.currentUserId
    );

    if (local) {
      state.scores.set(
        state.currentUserId,
        Math.max(0, Number(local.score) || 0)
      );
      applyLocalAliveState(local.alive !== false, local);
    }
  }

  function applyWorldSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;

    const nextSeed = snapshot.mapSeed ?? state.mapSeed;
    if (!state.map || String(nextSeed) !== String(state.mapSeed)) {
      createGameObjects(nextSeed, true);
    }

    state.elapsed = Math.max(0, Number(snapshot.elapsed) || 0);
    state.spawnTimer = Math.max(0, Number(snapshot.spawnTimer) || 0);
    state.sharedPaused = Boolean(snapshot.paused);
    state.scores = mapFromObject(snapshot.scores, (score) =>
      Math.max(0, Number(score) || 0)
    );
    state.alive = mapFromObject(snapshot.alive, (alive) => alive !== false);
    state.respawnAt = mapFromObject(snapshot.respawnAt, (time) =>
      Math.max(0, Number(time) || 0)
    );
    state.alertedUserIds = new Set(snapshot.alertedUserIds || []);

    ensureRosterState();
    state.pellets.applySnapshot(snapshot.pellets || []);
    state.creeps.applySnapshot(snapshot.creeps || []);
    applyPlayerStates(snapshot.players || []);

    state.worldReady = true;
    pauseButton.textContent = state.sharedPaused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(state.sharedPaused));
    updateAuthorityControls();

    if (localAlive()) hideOverlay();

    window.PacmanAudio?.setDangerActive(
      state.alertedUserIds.has(state.currentUserId)
    );
    updateHud();
    return true;
  }

  function applyWorldFrame(frame) {
    if (!frame || typeof frame !== "object") return;

    state.elapsed = Math.max(0, Number(frame.elapsed) || 0);
    state.spawnTimer = Math.max(0, Number(frame.spawnTimer) || 0);
    state.sharedPaused = Boolean(frame.paused);
    state.scores = mapFromObject(frame.scores, (score) =>
      Math.max(0, Number(score) || 0)
    );
    state.alive = mapFromObject(frame.alive, (alive) => alive !== false);
    state.respawnAt = mapFromObject(frame.respawnAt, (time) =>
      Math.max(0, Number(time) || 0)
    );
    state.alertedUserIds = new Set(frame.alertedUserIds || []);

    ensureRosterState();
    state.creeps.applyFrame(frame.creeps || []);
    applyPlayerStates(frame.players || []);
    state.worldReady = true;

    pauseButton.textContent = state.sharedPaused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(state.sharedPaused));
    window.PacmanAudio?.setDangerActive(
      state.alertedUserIds.has(state.currentUserId)
    );
    updateHud();
  }

  function applyWorldEvent(event) {
    if (!event || typeof event !== "object") return;

    if (event.type === "pellets-removed") {
      (event.removals || []).forEach((removal) => {
        state.pellets.removeByKey(removal.key, { track: false });
        if (removal.userId) {
          state.scores.set(
            removal.userId,
            Math.max(0, Number(removal.score) || 0)
          );
        }
      });
    } else if (event.type === "pellets-spawned") {
      state.pellets.addMany(event.pellets || []);
    } else if (event.type === "player-caught") {
      state.alive.set(event.userId, false);
      state.respawnAt.set(
        event.userId,
        Math.max(0, Number(event.respawnAt) || 0)
      );
      state.remotePlayers.setAlive(event.userId, false);

      if (event.userId === state.currentUserId) {
        applyLocalAliveState(false);
      }
    } else if (event.type === "player-respawned") {
      state.alive.set(event.userId, true);
      state.respawnAt.delete(event.userId);
      state.remotePlayers.setAlive(event.userId, true);
      state.remotePlayers.setPosition(event.userId, event);

      if (event.userId === state.currentUserId) {
        applyLocalAliveState(true, event);
      }
    } else if (event.type === "pause-changed") {
      state.sharedPaused = Boolean(event.paused);
    }

    updateHud();
  }

  async function initialiseSharedWorld() {
    showSyncOverlay();

    try {
      const persisted = await window.PacmanWorldSync.loadPersisted();

      if (persisted?.snapshot) {
        window.PacmanWorldSync.adoptVersion(persisted.version);
        applyWorldSnapshot(persisted.snapshot);
      }

      if (isHost()) {
        if (!state.worldReady) createInitialSharedWorld(state.mapSeed);
        const envelope = window.PacmanWorldSync.sendSnapshot(
          buildWorldSnapshot()
        );
        if (envelope) {
          void window.PacmanWorldSync.savePersisted(
            buildWorldSnapshot()
          ).catch(() => {});
        }
      } else {
        window.PacmanWorldSync.requestSnapshot();

        if (!state.worldReady) {
          window.setTimeout(() => {
            if (!state.worldReady) {
              window.PacmanWorldSync.requestSnapshot();
            }
          }, 1200);
        }
      }
    } catch (error) {
      if (isHost()) {
        createInitialSharedWorld(state.mapSeed);
        window.PacmanWorldSync.sendSnapshot(buildWorldSnapshot());
      } else {
        setOverlay(
          "Shared city unavailable",
          `${error.message} Run supabase/v8-shared-world.sql, then reload.`,
          "Leave Room",
          "leave"
        );
      }
    }
  }

  function createInitialSharedWorld(mapSeed) {
    createGameObjects(mapSeed, true);
    state.scores = new Map();
    state.alive = new Map();
    state.respawnAt = new Map();
    state.alertedUserIds = new Set();
    ensureRosterState();

    state.elapsed = 0;
    state.spawnTimer = 10;
    state.sharedPaused = false;
    state.worldReady = true;
    state.worldFrameAccumulator = 0;
    state.worldSnapshotAccumulator = 0;
    state.worldSaveAccumulator = 0;

    const exclusions = [state.pacman, ...state.map.spawnTiles];
    state.pellets.spawn(STARTING_PELLET_COUNT, exclusions);
    state.pellets.drainRemovals();
    state.creeps.spawnCornerWave();
    hideOverlay();
    updateAuthorityControls();
    updateHud();
  }

  async function buildGame(
    startImmediately = false,
    roomOrCode = state.room || state.roomId,
    players = state.roster,
    currentUserId = state.currentUserId
  ) {
    const room = normaliseRoom(roomOrCode);
    const roster = Array.isArray(players) ? players : [];
    const resolvedUserId =
      currentUserId ||
      window.PacmanMultiplayer?.state?.user?.id ||
      "local-player";
    const membership = getCurrentMembership(roster, resolvedUserId);

    state.room = room;
    state.roster = roster;
    state.currentUserId = resolvedUserId;
    state.playerSlot = Number(membership?.player_slot) || 1;
    state.roomId = room.code;
    state.mapSeed = room.map_seed ?? room.code;
    state.running = startImmediately;
    state.worldReady = false;
    state.localCaught = false;
    state.broadcastAccumulator = POSITION_BROADCAST_INTERVAL;
    state.broadcastSequence = 0;
    state.lastTime = performance.now();

    createGameObjects(state.mapSeed, true);
    state.scores = new Map();
    state.alive = new Map();
    state.respawnAt = new Map();
    ensureRosterState();

    window.PacmanWorldSync?.stop();
    window.PacmanWorldSync?.start(room, resolvedUserId);

    resizeCanvas();
    updateCamera();
    updateAuthorityControls();
    updateHud();

    if (startImmediately) {
      window.PacmanAudio?.playGame();
      canvas.focus({ preventScroll: true });
      await initialiseSharedWorld();
      sendPlayerSnapshot();
    } else {
      createInitialSharedWorld(state.mapSeed);
      state.running = false;
    }
  }

  function launchRoom(room, players = [], currentUserId = null) {
    void buildGame(true, room, players, currentUserId);
  }

  function updateAuthorityControls() {
    const host = isHost();
    newMapButton.disabled = !host;
    newMapButton.title = host
      ? "Create a new shared city for this room"
      : "Only the current host can create a new city";
    pauseButton.disabled = !host;
    pauseButton.title = host
      ? "Pause or resume the shared world"
      : "Only the current host can pause the shared world";
  }

  function togglePause() {
    if (!state.running || !state.worldReady || !isHost()) return;

    state.sharedPaused = !state.sharedPaused;
    pauseButton.textContent = state.sharedPaused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(state.sharedPaused));

    window.PacmanWorldSync.sendEvent({
      type: "pause-changed",
      paused: state.sharedPaused
    });
    window.PacmanWorldSync.sendFrame(buildWorldFrame());
    state.lastTime = performance.now();
  }

  function sendPlayerSnapshot() {
    if (
      !state.running ||
      !state.worldReady ||
      !localAlive() ||
      !state.pacman ||
      !window.PacmanMultiplayer
    ) {
      return;
    }

    state.broadcastSequence += 1;
    window.PacmanMultiplayer.broadcastPlayerState({
      sequence: state.broadcastSequence,
      x: Number(state.pacman.x.toFixed(4)),
      y: Number(state.pacman.y.toFixed(4)),
      dirX: state.pacman.dir.x,
      dirY: state.pacman.dir.y,
      angle: Number(state.pacman.angle.toFixed(4)),
      sentAt: Date.now()
    });
  }

  function resolvePelletsAndCreepEating(actors, dt) {
    const collectors = new Map();

    actors.forEach((actor) => {
      if (actor.alive === false) return;
      const pellet = state.pellets.collectAt(actor.x, actor.y);
      if (pellet) collectors.set(pellet.key, actor.userId);
    });

    state.creeps.update(
      dt,
      actors,
      state.elapsed,
      state.pellets
    );

    const removed = state.pellets.drainRemovals();
    if (!removed.length) return;

    const removals = removed.map((pellet) => {
      const userId = collectors.get(pellet.key) || null;
      let score = null;

      if (userId) {
        score = Math.max(0, Number(state.scores.get(userId)) || 0) + 10;
        state.scores.set(userId, score);
      }

      return {
        key: pellet.key,
        userId,
        score
      };
    });

    window.PacmanWorldSync.sendEvent({
      type: "pellets-removed",
      removals
    });
  }

  function resolveCreepCollisions(actors) {
    const caughtUserIds = state.creeps.collidingUserIds(actors);

    caughtUserIds.forEach((userId) => {
      if (state.alive.get(userId) === false) return;

      const respawnAt = state.elapsed + RESPAWN_DELAY_SECONDS;
      state.alive.set(userId, false);
      state.respawnAt.set(userId, respawnAt);
      state.remotePlayers.setAlive(userId, false);

      if (userId === state.currentUserId) {
        applyLocalAliveState(false);
      }

      window.PacmanWorldSync.sendEvent({
        type: "player-caught",
        userId,
        respawnAt
      });
    });
  }

  function resolveRespawns() {
    Array.from(state.respawnAt.entries()).forEach(([userId, time]) => {
      if (state.elapsed < time) return;

      const start = startTileForUser(userId);
      state.respawnAt.delete(userId);
      state.alive.set(userId, true);
      state.remotePlayers.setAlive(userId, true);
      state.remotePlayers.setPosition(userId, start);

      if (userId === state.currentUserId) {
        applyLocalAliveState(true, start);
      }

      window.PacmanWorldSync.sendEvent({
        type: "player-respawned",
        userId,
        x: start.x,
        y: start.y
      });
    });
  }

  function updateHostWorld(dt) {
    const actors = allPlayerActors();

    resolvePelletsAndCreepEating(actors, dt);
    resolveCreepCollisions(actors);
    resolveRespawns();

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const exclusions = [
        ...actors,
        ...state.map.spawnTiles,
        ...state.creeps.creeps
      ];
      const pellets = state.pellets.spawn(5, exclusions);
      state.pellets.drainRemovals();
      state.creeps.spawnCornerWave();
      state.spawnTimer += 10;

      if (pellets.length) {
        window.PacmanWorldSync.sendEvent({
          type: "pellets-spawned",
          pellets
        });
      }
    }

    state.alertedUserIds = new Set(state.creeps.getAlertedUserIds());
    state.worldFrameAccumulator += dt;
    state.worldSnapshotAccumulator += dt;
    state.worldSaveAccumulator += dt;

    if (state.worldFrameAccumulator >= WORLD_FRAME_INTERVAL) {
      state.worldFrameAccumulator %= WORLD_FRAME_INTERVAL;
      window.PacmanWorldSync.sendFrame(buildWorldFrame());
    }

    if (state.worldSnapshotAccumulator >= WORLD_SNAPSHOT_INTERVAL) {
      state.worldSnapshotAccumulator %= WORLD_SNAPSHOT_INTERVAL;
      window.PacmanWorldSync.sendSnapshot(buildWorldSnapshot());
    }

    if (state.worldSaveAccumulator >= WORLD_SAVE_INTERVAL) {
      state.worldSaveAccumulator %= WORLD_SAVE_INTERVAL;
      void window.PacmanWorldSync.savePersisted(
        buildWorldSnapshot()
      ).catch(() => {});
    }
  }

  function update(dt) {
    if (!state.running) return;

    state.broadcastAccumulator += dt;
    state.remotePlayers?.update(dt);

    if (!state.worldReady) {
      if (state.broadcastAccumulator >= POSITION_BROADCAST_INTERVAL) {
        state.broadcastAccumulator %= POSITION_BROADCAST_INTERVAL;
        sendPlayerSnapshot();
      }
      return;
    }

    if (!state.sharedPaused && localAlive()) {
      state.pacman.update(dt, state.map);
    }

    if (isHost()) {
      if (!state.sharedPaused) {
        state.elapsed += dt;
        updateHostWorld(dt);
      } else if (state.worldFrameAccumulator >= WORLD_FRAME_INTERVAL) {
        state.worldFrameAccumulator = 0;
        window.PacmanWorldSync.sendFrame(buildWorldFrame());
      }
    } else {
      state.creeps.updateNetwork(dt);
    }

    if (state.broadcastAccumulator >= POSITION_BROADCAST_INTERVAL) {
      state.broadcastAccumulator %= POSITION_BROADCAST_INTERVAL;
      sendPlayerSnapshot();
    }

    window.PacmanAudio?.setDangerActive(
      localAlive() && state.alertedUserIds.has(state.currentUserId)
    );

    updateCamera();
    updateHud();
  }

  function updateHud() {
    roomValue.textContent = state.roomId;
    scoreValue.textContent = String(localScore());
    pelletValue.textContent = String(state.pellets ? state.pellets.count : 0);
    creepValue.textContent = String(state.creeps ? state.creeps.count : 0);
    alertValue.textContent = String(
      state.creeps ? state.creeps.alertedCount : 0
    );
    spawnValue.textContent = state.worldReady
      ? `${Math.max(0, state.spawnTimer).toFixed(1)}s`
      : "SYNC";
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
    const mobile = window.matchMedia("(max-width: 950px)").matches;
    const width = Math.max(280, Math.floor(rect.width || window.innerWidth));
    const height = Math.max(
      mobile ? 240 : 430,
      Math.floor(rect.height || window.innerHeight * 0.7)
    );

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

    state.viewport.offsetX =
      width * 0.5 - (state.pacman.x + 0.5) * tileSize;
    state.viewport.offsetY =
      height * 0.5 - (state.pacman.y + 0.5) * tileSize;
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
    state.remotePlayers?.draw(ctx, state.viewport);

    if (localAlive()) {
      state.pacman.draw(ctx, state.viewport);
    }

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
    if (
      !state.pacman ||
      !state.running ||
      !state.worldReady ||
      state.sharedPaused ||
      !localAlive()
    ) {
      return;
    }

    state.pacman.setDirection(direction);
  }

  function readSwipe(event) {
    if (!swipeState.active || event.pointerId !== swipeState.pointerId) {
      return false;
    }

    const dx = event.clientX - swipeState.x;
    const dy = event.clientY - swipeState.y;
    const threshold = Math.max(
      24,
      Math.min(state.viewport.width, state.viewport.height) * 0.035
    );

    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return false;

    const direction =
      Math.abs(dx) > Math.abs(dy)
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

  startButton.addEventListener("click", () => {
    if (state.overlayAction === "watch") {
      hideOverlay();
    } else if (state.overlayAction === "leave") {
      leaveRoomButton.click();
    }
  });

  newMapButton.addEventListener("click", () => {
    if (!isHost() || !state.running) return;

    createInitialSharedWorld(generateMapSeed());
    window.PacmanWorldSync.sendEvent({ type: "world-reset" });
    window.PacmanWorldSync.sendSnapshot(buildWorldSnapshot());
    void window.PacmanWorldSync.savePersisted(
      buildWorldSnapshot()
    ).catch(() => {});
  });

  pauseButton.addEventListener("click", togglePause);

  leaveRoomButton.addEventListener("click", () => {
    if (isHost() && state.worldReady) {
      void window.PacmanWorldSync.savePersisted(
        buildWorldSnapshot()
      ).catch(() => {});
    }

    window.PacmanAudio?.setDangerActive(false);
    window.PacmanAudio?.playLobby();
    state.running = false;
    state.worldReady = false;
    state.remotePlayers?.players.clear();
    hideOverlay();
    window.PacmanWorldSync?.stop();

    document.dispatchEvent(
      new CustomEvent("pacman:leave-room", {
        detail: { roomId: state.roomId }
      })
    );
  });

  viewButton.addEventListener("click", () => {
    state.depthMode = !state.depthMode;
    viewButton.textContent = state.depthMode ? "View: Depth" : "View: Flat";
    viewButton.setAttribute("aria-pressed", String(state.depthMode));
  });

  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", () => {
    state.lastTime = performance.now();
  });

  document.addEventListener("pacman:remote-player-state", (event) => {
    if (!state.running || !state.remotePlayers) return;
    state.remotePlayers.applyNetworkState(event.detail.payload);
  });

  document.addEventListener("pacman:room-updated", (event) => {
    if (!state.room || event.detail.room?.id !== state.room.id) return;

    state.room = event.detail.room;
    state.roster = event.detail.players || [];
    state.remotePlayers?.setRoster(state.roster);
    ensureRosterState();
    window.PacmanWorldSync?.updateRoom(state.room);
    updateAuthorityControls();
  });

  document.addEventListener("pacman:host-changed", async (event) => {
    if (!state.room || event.detail.room?.id !== state.room.id) return;

    state.room = event.detail.room;
    window.PacmanWorldSync?.updateRoom(state.room);
    updateAuthorityControls();

    if (!event.detail.isHost) return;

    try {
      const persisted = await window.PacmanWorldSync.loadPersisted();
      if (persisted?.snapshot) {
        window.PacmanWorldSync.adoptVersion(persisted.version);
        applyWorldSnapshot(persisted.snapshot);
      }
    } catch (_error) {
      // Continue from the latest locally rendered world if persistence is late.
    }

    if (!state.worldReady) createInitialSharedWorld(state.mapSeed);
    window.PacmanWorldSync.sendSnapshot(buildWorldSnapshot());
  });

  document.addEventListener("pacman:world-snapshot-requested", (event) => {
    if (!isHost() || !state.worldReady) return;

    window.PacmanWorldSync.sendSnapshot(
      buildWorldSnapshot(),
      event.detail.requestUserId
    );
  });

  document.addEventListener("pacman:shared-world-snapshot", (event) => {
    if (isHost()) return;
    applyWorldSnapshot(event.detail.snapshot);
  });

  document.addEventListener("pacman:shared-world-frame", (event) => {
    if (isHost()) return;
    applyWorldFrame(event.detail.frame);
  });

  document.addEventListener("pacman:shared-world-event", (event) => {
    if (isHost()) return;

    if (event.detail.event?.type === "world-reset") {
      showSyncOverlay();
      window.PacmanWorldSync.requestSnapshot();
      return;
    }

    applyWorldEvent(event.detail.event);
  });

  document.addEventListener("pacman:room-left", () => {
    window.PacmanAudio?.setDangerActive(false);
    window.PacmanAudio?.playLobby();
    state.running = false;
    state.worldReady = false;
    state.remotePlayers?.players.clear();
    window.PacmanWorldSync?.stop();
  });

  window.ElementalPacman = Object.freeze({
    launchRoom,
    getRoomId: () => state.roomId,
    getMapSeed: () => state.mapSeed,
    isRunning: () => state.running,
    isSharedWorldReady: () => state.worldReady,
    isHost
  });

  void buildGame(
    false,
    {
      code: "LOCAL1",
      map_seed: "LOCAL1",
      status: "playing",
      host_user_id: "local-player"
    },
    [],
    "local-player"
  );
  requestAnimationFrame(frame);
})();
