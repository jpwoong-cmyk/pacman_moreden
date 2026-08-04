(function () {
  "use strict";

  const NEAR_GAP_TILES = 0.4;
  const EXIT_GAP_TILES = 0.58;
  const REARM_GAP_TILES = 0.9;
  const SAFE_CONFIRM_SECONDS = 0.18;
  const PAIR_EXPIRY_SECONDS = 3;
  const NETWORK_VERSION = 1;

  const state = {
    userId: null,
    accountName: null,
    localCount: 0,
    countsByUser: new Map(),
    lastAwardAtByUser: new Map(),
    lastSideByUser: new Map(),
    pairStates: new Map(),
    seenAwardIds: new Set(),
    loadingToken: 0,
    persistQueue: Promise.resolve(),
    sqlWarningShown: false,
    toastTimer: null,
    ui: null
  };

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  function safeCount(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
  }

  function currentLocalUserId() {
    if (state.userId) return state.userId;
    if (window.PACMAN_GUEST_MODE) return "guest-player";
    return null;
  }

  function isLocalUser(userId) {
    return Boolean(userId && userId === currentLocalUserId());
  }

  function stageForCount(count) {
    const safe = safeCount(count);
    if (safe < 5) return 0;
    if (safe < 10) return 1;
    if (safe < 20) return 2;

    return Math.min(
      12,
      3 + Math.floor(Math.log2(Math.max(1, safe / 20)))
    );
  }

  function thresholdForStage(stage) {
    const safeStage = Math.max(0, Math.floor(Number(stage) || 0));
    if (safeStage <= 0) return 5;
    if (safeStage === 1) return 5;
    if (safeStage === 2) return 10;
    return 20 * (2 ** (safeStage - 3));
  }

  function nextThresholdForCount(count) {
    const stage = stageForCount(count);
    const currentThreshold = thresholdForStage(stage);
    if (safeCount(count) < currentThreshold) return currentThreshold;
    return thresholdForStage(stage + 1);
  }

  function milestoneName(stage) {
    if (stage === 1) return "PHANTOM WAKE I";
    if (stage === 2) return "PHANTOM WAKE II";
    if (stage === 3) return "PHANTOM WAKE III";
    if (stage === 4) return "LUMINOUS WAKE";
    if (stage === 5) return "DANGER FLASH";
    if (stage === 6) return "PHANTOM AFTERIMAGE";
    if (stage === 7) return "PHANTOM MASTERY";
    return `PHANTOM MASTERY ${stage - 6}`;
  }

  function parseNetworkState(value) {
    if (!value || typeof value !== "object") return null;

    const count = safeCount(
      value.c ?? value.count ?? value.nearMissCount
    );

    return {
      version: Math.max(1, Math.floor(Number(value.v) || NETWORK_VERSION)),
      count
    };
  }

  function getKnownCount(userId) {
    if (!userId) return 0;
    if (isLocalUser(userId)) return state.localCount;
    return safeCount(state.countsByUser.get(userId));
  }

  function setKnownCount(userId, count) {
    if (!userId) return 0;

    const safe = safeCount(count);
    const previous = getKnownCount(userId);
    const next = Math.max(previous, safe);

    state.countsByUser.set(userId, next);
    if (isLocalUser(userId)) {
      state.localCount = next;
      updateHud();
    }

    return next;
  }

  function observeNetworkState(userId, value) {
    const compact = parseNetworkState(value);
    if (!userId || !compact) return null;

    setKnownCount(userId, compact.count);
    return compact;
  }

  function getLocalNetworkState() {
    return {
      v: NETWORK_VERSION,
      c: safeCount(state.localCount)
    };
  }

  function getNetworkStateForUser(userId, fallbackValue = null) {
    const compact = parseNetworkState(fallbackValue);
    if (userId && compact) observeNetworkState(userId, compact);

    return {
      v: NETWORK_VERSION,
      c: getKnownCount(userId)
    };
  }

  function buildDrawState(userId, fallbackValue = null) {
    const compact = parseNetworkState(fallbackValue);
    if (userId && compact) observeNetworkState(userId, compact);

    const count = userId
      ? getKnownCount(userId)
      : state.localCount;
    const stage = stageForCount(count);
    const awardedAt = userId
      ? Number(state.lastAwardAtByUser.get(userId)) || 0
      : 0;
    const ageMs = Math.max(0, performance.now() - awardedAt);
    const flash = ageMs < 720 ? 1 - ageMs / 720 : 0;

    return {
      count,
      stage,
      wakeCount: Math.min(3, stage),
      luminous: stage >= 4,
      impact: stage >= 5,
      afterimage: stage >= 6,
      mastery: stage >= 7,
      masteryLevel: Math.max(0, stage - 6),
      side: userId ? Number(state.lastSideByUser.get(userId)) || 1 : 1,
      flash,
      reducedMotion: reducedMotionQuery.matches
    };
  }

  function resolveDrawState(options = {}) {
    const remoteUserId = options.userId || null;
    if (remoteUserId) {
      return buildDrawState(remoteUserId, options.nearMiss);
    }

    const localUserId = currentLocalUserId();
    return buildDrawState(localUserId, options.nearMiss);
  }

  function ensureUI() {
    if (state.ui) return state.ui;

    const hud = document.querySelector("#gameShell .hud");
    const board = document.querySelector("#gameShell .board-wrap");
    if (!hud || !board) return null;

    let hudItem = document.getElementById("nearMissHud");
    if (!hudItem) {
      hudItem = document.createElement("div");
      hudItem.id = "nearMissHud";
      hudItem.className = "hud-item near-miss-hud";
      hudItem.innerHTML =
        '<span>Near Miss</span><strong id="nearMissValue">0</strong>';
      hud.appendChild(hudItem);
    }

    let toast = document.getElementById("nearMissToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "nearMissToast";
      toast.className = "near-miss-toast";
      toast.setAttribute("aria-live", "polite");
      toast.setAttribute("aria-atomic", "true");
      toast.innerHTML =
        '<span class="near-miss-toast__title">NEAR MISS</span>' +
        '<strong class="near-miss-toast__value">+1</strong>' +
        '<small class="near-miss-toast__detail"></small>';
      board.appendChild(toast);
    }

    state.ui = {
      hudItem,
      value: hudItem.querySelector("#nearMissValue"),
      toast,
      toastTitle: toast.querySelector(".near-miss-toast__title"),
      toastValue: toast.querySelector(".near-miss-toast__value"),
      toastDetail: toast.querySelector(".near-miss-toast__detail")
    };

    updateHud();
    return state.ui;
  }

  function updateHud() {
    const ui = state.ui || ensureUI();
    if (!ui?.value) return;
    ui.value.textContent = String(safeCount(state.localCount));
    ui.hudItem.title =
      `Monthly near misses. Next Phantom milestone: ${nextThresholdForCount(state.localCount)}.`;
  }

  function showLocalAward(count, previousStage) {
    const ui = state.ui || ensureUI();
    if (!ui) return;

    const stage = stageForCount(count);
    const milestone = stage > previousStage;

    ui.toast.dataset.milestone = String(milestone);
    ui.toastTitle.textContent = milestone
      ? milestoneName(stage)
      : "NEAR MISS";
    ui.toastValue.textContent = milestone ? "UNLOCKED" : "+1";
    ui.toastDetail.textContent =
      `${count} MONTHLY · NEXT ${nextThresholdForCount(count)}`;

    ui.toast.classList.remove("is-visible");
    void ui.toast.offsetWidth;
    ui.toast.classList.add("is-visible");

    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      ui.toast.classList.remove("is-visible");
    }, milestone ? 1500 : 900);
  }

  function firstScalar(data) {
    if (Array.isArray(data)) {
      const first = data[0];
      if (typeof first === "number") return first;
      if (first && typeof first === "object") {
        return first.near_miss_count ?? first.count ?? 0;
      }
      return 0;
    }

    if (data && typeof data === "object") {
      return data.near_miss_count ?? data.count ?? 0;
    }

    return data;
  }

  async function loadLocalCount() {
    const token = ++state.loadingToken;
    const userId = state.userId;

    if (!userId || userId === "guest-player" || !window.pacmanSupabase) {
      state.localCount = 0;
      if (userId) state.countsByUser.set(userId, 0);
      updateHud();
      return;
    }

    try {
      const { data, error } = await window.pacmanSupabase.rpc(
        "get_my_pacman_near_miss"
      );
      if (error) throw error;
      if (token !== state.loadingToken || userId !== state.userId) return;

      state.localCount = safeCount(firstScalar(data));
      state.countsByUser.set(userId, state.localCount);
      updateHud();
    } catch (error) {
      if (!state.sqlWarningShown) {
        state.sqlWarningShown = true;
        console.warn(
          "P.A.C Near Miss persistence is unavailable. Run PAC_NEAR_MISS.sql in Supabase.",
          error
        );
      }
      updateHud();
    }
  }

  function persistOneLocalAward() {
    if (
      !state.userId ||
      state.userId === "guest-player" ||
      !window.pacmanSupabase
    ) {
      return;
    }

    state.persistQueue = state.persistQueue
      .catch(() => {})
      .then(async () => {
        const userId = state.userId;
        const { data, error } = await window.pacmanSupabase.rpc(
          "increment_my_pacman_near_miss"
        );
        if (error) throw error;
        if (userId !== state.userId) return;

        const serverCount = safeCount(firstScalar(data));
        setKnownCount(userId, serverCount);
      })
      .catch((error) => {
        console.warn("Unable to save the P.A.C Near Miss point.", error);
      });
  }

  function rememberAwardId(awardId) {
    if (!awardId) return true;
    if (state.seenAwardIds.has(awardId)) return false;

    state.seenAwardIds.add(awardId);
    if (state.seenAwardIds.size > 300) {
      const oldest = state.seenAwardIds.values().next().value;
      state.seenAwardIds.delete(oldest);
    }
    return true;
  }

  function applyAward(payload = {}, source = "network") {
    const userId = payload.userId;
    if (!userId || !rememberAwardId(payload.awardId)) return false;

    const previousCount = getKnownCount(userId);
    const previousStage = stageForCount(previousCount);
    const eventCount = safeCount(payload.count);
    const nextCount = isLocalUser(userId)
      ? Math.max(previousCount + 1, eventCount)
      : Math.max(previousCount, eventCount);

    setKnownCount(userId, nextCount);
    state.lastAwardAtByUser.set(userId, performance.now());
    state.lastSideByUser.set(userId, Number(payload.side) < 0 ? -1 : 1);

    if (isLocalUser(userId)) {
      showLocalAward(nextCount, previousStage);
      persistOneLocalAward();
    }

    document.dispatchEvent(
      new CustomEvent("pacman:near-miss-awarded", {
        detail: {
          ...payload,
          source,
          count: nextCount,
          stage: stageForCount(nextCount)
        }
      })
    );

    return true;
  }

  function playerSideOfGhost(player, creep) {
    const angle = Number.isFinite(Number(player.angle))
      ? Number(player.angle)
      : Math.atan2(Number(player.dir?.y) || 0, Number(player.dir?.x) || 1);
    const rightX = -Math.sin(angle);
    const rightY = Math.cos(angle);
    const dx = creep.x - player.x;
    const dy = creep.y - player.y;
    return dx * rightX + dy * rightY < 0 ? -1 : 1;
  }

  function pairKey(userId, creepId) {
    return `${userId}:${creepId}`;
  }

  function awardNearMiss(player, creep, tracker) {
    const userId = player.userId;
    const previous = getKnownCount(userId);
    const count = previous + 1;
    const awardId =
      `${userId}:${creep.id}:${Date.now()}:` +
      Math.random().toString(36).slice(2, 8);

    const payload = {
      type: "near-miss-awarded",
      awardId,
      userId,
      creepId: creep.id,
      element: creep.element || "shadow",
      count,
      side: tracker.side,
      gap: Number((tracker.closestGap ?? NEAR_GAP_TILES).toFixed(3)),
      sentAt: Date.now()
    };

    applyAward(payload, "host");
    window.PacmanWorldSync?.sendEvent?.(payload);
  }

  function processPair(player, creep, elapsed, seenKeys) {
    if (!player?.userId || player.alive === false) return;

    if (player.nearMiss) {
      observeNetworkState(player.userId, player.nearMiss);
    }

    const key = pairKey(player.userId, creep.id);
    seenKeys.add(key);

    const dx = creep.x - player.x;
    const dy = creep.y - player.y;
    const distance = Math.hypot(dx, dy);
    const combinedRadius =
      Math.max(0.1, Number(creep.radius) || 0.34) +
      Math.max(0.1, Number(player.radius) || 0.34);
    const collisionDistance = combinedRadius - 0.08;
    const gap = distance - combinedRadius;
    const colliding = distance < collisionDistance;
    const activeChase = Boolean(
      creep.alerted && creep.targetUserId === player.userId
    );
    const moving = Boolean(
      Number(player.dir?.x) || Number(player.dir?.y)
    );

    let tracker = state.pairStates.get(key);
    if (!tracker) {
      tracker = {
        phase: gap > REARM_GAP_TILES ? "ready" : "blocked",
        enteredAt: 0,
        pendingAt: 0,
        closestGap: Number.POSITIVE_INFINITY,
        side: 1,
        lastSeen: elapsed
      };
      state.pairStates.set(key, tracker);
    }

    tracker.lastSeen = elapsed;

    if (colliding) {
      tracker.phase = "blocked";
      tracker.closestGap = Number.POSITIVE_INFINITY;
      return;
    }

    if (tracker.phase === "blocked") {
      if (gap > REARM_GAP_TILES) tracker.phase = "ready";
      return;
    }

    if (tracker.phase === "ready") {
      if (
        activeChase &&
        moving &&
        gap <= NEAR_GAP_TILES
      ) {
        tracker.phase = "near";
        tracker.enteredAt = elapsed;
        tracker.closestGap = gap;
        tracker.side = playerSideOfGhost(player, creep);
      }
      return;
    }

    if (tracker.phase === "near") {
      tracker.closestGap = Math.min(tracker.closestGap, gap);
      if (gap >= EXIT_GAP_TILES) {
        tracker.phase = "pending";
        tracker.pendingAt = elapsed;
      }
      return;
    }

    if (tracker.phase === "pending") {
      if (gap <= NEAR_GAP_TILES) {
        tracker.phase = "near";
        tracker.closestGap = Math.min(tracker.closestGap, gap);
        return;
      }

      if (elapsed - tracker.pendingAt >= SAFE_CONFIRM_SECONDS) {
        awardNearMiss(player, creep, tracker);
        tracker.phase = "cooldown";
      }
      return;
    }

    if (tracker.phase === "cooldown" && gap > REARM_GAP_TILES) {
      tracker.phase = "ready";
      tracker.closestGap = Number.POSITIVE_INFINITY;
    }
  }

  function detectNearMisses(manager, players, elapsed) {
    const safePlayers = Array.isArray(players)
      ? players.filter((player) => player?.userId)
      : [];
    const creeps = Array.isArray(manager?.creeps) ? manager.creeps : [];
    const seenKeys = new Set();

    safePlayers.forEach((player) => {
      if (player.alive === false) {
        return;
      }

      if (player.nearMiss) {
        observeNetworkState(player.userId, player.nearMiss);
      } else if (isLocalUser(player.userId)) {
        state.countsByUser.set(player.userId, state.localCount);
      }

      creeps.forEach((creep) => {
        processPair(player, creep, elapsed, seenKeys);
      });
    });

    state.pairStates.forEach((tracker, key) => {
      if (
        !seenKeys.has(key) ||
        elapsed - tracker.lastSeen > PAIR_EXPIRY_SECONDS
      ) {
        state.pairStates.delete(key);
      }
    });
  }

  function installCreepHook() {
    const prototype = window.CreepManager?.prototype;
    if (!prototype || prototype.__pacNearMissInstalled) return;

    const originalUpdate = prototype.update;
    if (typeof originalUpdate !== "function") return;

    prototype.update = function updateWithNearMiss(
      dt,
      players,
      elapsed,
      pellets
    ) {
      originalUpdate.call(this, dt, players, elapsed, pellets);
      detectNearMisses(this, players, Number(elapsed) || 0);
    };

    prototype.__pacNearMissInstalled = true;
  }

  function clearRoomTracking() {
    state.pairStates.clear();
    state.lastAwardAtByUser.clear();
    state.lastSideByUser.clear();
  }

  document.addEventListener("pacman:auth-changed", (event) => {
    const detail = event.detail || {};
    state.userId = detail.user?.id || null;
    state.accountName =
      detail.profile?.account_name ||
      detail.profile?.display_name ||
      null;
    state.localCount = 0;
    state.countsByUser.clear();
    clearRoomTracking();
    updateHud();
    void loadLocalCount();
  });

  document.addEventListener("pacman:shared-world-event", (event) => {
    const worldEvent = event.detail?.event;
    if (worldEvent?.type !== "near-miss-awarded") return;
    applyAward(worldEvent, "network");
  });

  document.addEventListener("pacman:shared-world-snapshot", (event) => {
    const players = event.detail?.snapshot?.players;
    (Array.isArray(players) ? players : []).forEach((player) => {
      if (!player?.userId || !player.nearMiss) return;

      const before = getKnownCount(player.userId);
      const compact = observeNetworkState(player.userId, player.nearMiss);
      const after = getKnownCount(player.userId);

      if (
        compact &&
        isLocalUser(player.userId) &&
        after > before
      ) {
        for (let index = before; index < after; index += 1) {
          persistOneLocalAward();
        }
      }
    });
  });

  document.addEventListener("pacman:room-started", clearRoomTracking);
  document.addEventListener("pacman:room-left", clearRoomTracking);
  document.addEventListener("pacman:leave-room", clearRoomTracking);

  window.PacmanNearMiss = Object.freeze({
    NEAR_GAP_TILES,
    EXIT_GAP_TILES,
    REARM_GAP_TILES,
    stageForCount,
    nextThresholdForCount,
    milestoneName,
    getLocalCount: () => state.localCount,
    getLocalNetworkState,
    getNetworkStateForUser,
    observeNetworkState,
    resolveDrawState,
    refresh: loadLocalCount
  });

  installCreepHook();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureUI, { once: true });
  } else {
    ensureUI();
  }
})();
