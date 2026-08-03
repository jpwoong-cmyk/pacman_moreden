(function () {
  "use strict";

  const VERSUS = "versus";
  const COOP = "coop";
  const MIN_PLAYERS = 2;

  const state = {
    room: null,
    players: [],
    currentUserId: null,
    mode: VERSUS,
    isHost: false,
    run: 1,
    runKey: null,
    teamScore: 0,
    aliveCount: 0,
    wiped: false,
    restarting: false,
    submitted: new Set(),
    submission: null,
    savingMode: false
  };

  const el = {
    modeSwitch: document.getElementById("gameModeSwitch"),
    versus: document.querySelector('[data-game-mode="versus"]'),
    coop: document.querySelector('[data-game-mode="coop"]'),
    waitingMessage: document.getElementById("waitingRoomMessage"),
    start: document.getElementById("startRoomButton"),
    newMap: document.getElementById("newMapButton"),
    indTrack: document.getElementById("lobbyScoreTrack"),
    coopTrack: document.getElementById("coopScoreTrack"),
    teamHud: document.getElementById("coopTeamHud"),
    teamScore: document.getElementById("coopTeamScore"),
    teamAlive: document.getElementById("coopTeamAlive"),
    teamNames: document.getElementById("coopTeamNames")
  };

  const safeScore = (value) => Math.max(0, Math.floor(Number(value) || 0));
  const normaliseMode = (value) =>
    String(value || "").toLowerCase() === COOP ? COOP : VERSUS;
  const isCoop = () => state.mode === COOP;
  const isPlaying = () => state.room?.status === "playing";
  const playerIds = () => state.players.map((p) => p?.user_id).filter(Boolean);
  const playerNames = () => state.players.map((p) =>
    String(
      p?.profile?.account_name ||
      p?.profile?.display_name ||
      `Player ${p?.player_slot || ""}`
    ).trim()
  );

  function client() {
    if (!window.pacmanSupabase) throw new Error("Supabase client is unavailable.");
    return window.pacmanSupabase;
  }

  function makeRunKey() {
    return `${state.room?.id || "local"}:${state.room?.started_at || "waiting"}:${Math.max(1, state.run)}`;
  }

  function ensureRunKey() {
    if (!state.runKey) state.runKey = makeRunKey();
    return state.runKey;
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setMessage(message, type = "") {
    if (!el.waitingMessage) return;
    setText(el.waitingMessage, message || "");
    el.waitingMessage.classList.toggle("error", type === "error");
    el.waitingMessage.classList.toggle("success", type === "success");
  }

  function setTicker(track, message) {
    track?.querySelectorAll(".lobby-score-group").forEach((group) => {
      if (group.textContent !== message) group.textContent = message;
    });
  }

  function formatIndividual(rows) {
    if (!rows?.length) return "NO CITY RECORDS YET";
    return rows.map((row, i) => {
      const name = String(row.account_name || row.display_name || "player")
        .trim().toUpperCase();
      return `#${i + 1} ${name} · ${safeScore(row.high_score).toLocaleString()}`;
    }).join("     ◆     ");
  }

  function formatCoop(rows) {
    if (!rows?.length) return "NO TEAM RECORDS YET";
    return rows.slice(0, 3).map((row, i) => {
      const names = (Array.isArray(row.player_names) ? row.player_names : [])
        .map((name) => String(name || "player").trim().toUpperCase())
        .filter(Boolean)
        .join(" / ") || "TEAM P.A.C";
      return `#${i + 1} ${names} · ${safeScore(row.score).toLocaleString()}`;
    }).join("     ◆     ");
  }

  async function getCoopScores(limit = 3) {
    const { data, error } = await client().rpc("get_pacman_coop_high_scores", {
      p_limit: Math.max(1, Math.min(10, Number(limit) || 3))
    });
    if (error) throw new Error(error.message || "Unable to load cooperative scores.");
    return Array.isArray(data) ? data : [];
  }

  async function refreshLeaderboards() {
    try {
      const rows = await window.PacmanLeaderboard?.getHighScores?.();
      setTicker(
        el.indTrack,
        `IND HIGH SCORE     ◆     ${formatIndividual(rows || [])}     ◆`
      );
    } catch (_error) {
      setTicker(el.indTrack, "IND HIGH SCORE     ◆     RECORDS TEMPORARILY UNAVAILABLE     ◆");
    }

    try {
      const rows = await getCoopScores();
      setTicker(
        el.coopTrack,
        `COOP HIGH SCORE     ◆     ${formatCoop(rows)}     ◆`
      );
    } catch (error) {
      const needsSql = /function|schema|column|does not exist/i.test(
        String(error?.message || "")
      );
      setTicker(
        el.coopTrack,
        needsSql
          ? "COOP HIGH SCORE     ◆     RUN supabase/v10-coop-mode.sql     ◆"
          : "COOP HIGH SCORE     ◆     RECORDS TEMPORARILY UNAVAILABLE     ◆"
      );
    }
  }

  function patchLeaderboard() {
    const base = window.PacmanLeaderboard;
    if (!base || base.__coopPatched) return;

    window.PacmanLeaderboard = Object.freeze({
      ...base,
      __coopPatched: true,
      getCoopHighScores: getCoopScores,
      refreshAll: refreshLeaderboards,
      async submitScore(score) {
        if (isCoop() && isPlaying()) return safeScore(score);
        return base.submitScore(score);
      }
    });
  }

  function patchRoomService() {
    const base = window.PacmanRoomService;
    if (!base || base.__coopPatched) return;

    async function getRoom(roomId) {
      let result = await client()
        .from("game_rooms")
        .select("id, code, host_user_id, status, game_mode, map_seed, max_players, created_at, started_at, ended_at")
        .eq("id", roomId)
        .single();

      const missingColumn = Boolean(
        result.error &&
        (result.error.code === "42703" ||
          result.error.code === "PGRST204" ||
          /game_mode|column/i.test(String(result.error.message || "")))
      );

      if (missingColumn) {
        result = await client()
          .from("game_rooms")
          .select("id, code, host_user_id, status, map_seed, max_players, created_at, started_at, ended_at")
          .eq("id", roomId)
          .single();
        if (result.data) result.data.game_mode = VERSUS;
      }

      if (result.error) {
        throw new Error(`Unable to load room: ${result.error.message}`);
      }
      return result.data;
    }

    async function setRoomGameMode(roomId, mode) {
      const { data, error } = await client().rpc("set_game_room_mode", {
        p_room_id: roomId,
        p_game_mode: normaliseMode(mode)
      });
      if (error) throw new Error(error.message || "Unable to update game mode.");
      return Array.isArray(data) ? data[0] || null : data || null;
    }

    window.PacmanRoomService = Object.freeze({
      ...base,
      __coopPatched: true,
      getRoom,
      setRoomGameMode
    });
  }

  function coopPayload() {
    return {
      mode: state.mode,
      run: Math.max(1, state.run),
      runKey: ensureRunKey(),
      teamScore: safeScore(state.teamScore),
      aliveCount: safeScore(state.aliveCount),
      wiped: Boolean(state.wiped),
      playerIds: playerIds(),
      playerNames: playerNames()
    };
  }

  function augment(world) {
    if (!world || typeof world !== "object" || !isCoop()) return world;
    return { ...world, coop: coopPayload() };
  }

  function adopt(payload) {
    if (!payload || normaliseMode(payload.mode) !== COOP) return;
    state.mode = COOP;
    state.run = Math.max(state.run, safeScore(payload.run) || 1);
    state.runKey = String(payload.runKey || state.runKey || makeRunKey());
  }

  function patchWorldSync() {
    const base = window.PacmanWorldSync;
    if (!base || base.__coopPatched) return;

    window.PacmanWorldSync = Object.freeze({
      ...base,
      __coopPatched: true,
      sendFrame(frame) {
        inspectWorld(frame);
        return base.sendFrame(augment(frame));
      },
      sendSnapshot(snapshot, targetUserId = null) {
        inspectWorld(snapshot);
        return base.sendSnapshot(augment(snapshot), targetUserId);
      },
      async loadPersisted() {
        const saved = await base.loadPersisted();
        adopt(saved?.snapshot?.coop);
        return saved;
      },
      savePersisted(snapshot) {
        return base.savePersisted(augment(snapshot));
      }
    });
  }

  function updateSwitch() {
    const editable = Boolean(
      state.isHost && state.room?.status === "waiting" && !state.savingMode
    );

    [el.versus, el.coop].forEach((button) => {
      if (!button) return;
      const active = button.dataset.gameMode === state.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = !editable;
    });

    if (el.modeSwitch) {
      el.modeSwitch.dataset.mode = state.mode;
      el.modeSwitch.dataset.editable = String(editable);
      el.modeSwitch.setAttribute(
        "aria-label",
        editable
          ? "Choose Versus or Cooperative game mode"
          : `Game mode: ${isCoop() ? "Cooperative" : "Versus"}`
      );
    }

    if (el.start && state.room?.status === "waiting") {
      const blocked = isCoop() && state.players.length < MIN_PLAYERS;
      el.start.disabled = state.savingMode || blocked;
      el.start.title = blocked
        ? "Cooperative mode needs at least two players"
        : "";
    }
  }

  function updateTeamHud() {
    if (!el.teamHud) return;
    const visible = isCoop() && isPlaying();
    el.teamHud.hidden = !visible;
    el.teamHud.setAttribute("aria-hidden", String(!visible));
    if (!visible) return;

    setText(el.teamScore, safeScore(state.teamScore).toLocaleString());
    setText(
      el.teamAlive,
      `${safeScore(state.aliveCount)} / ${state.players.length} ACTIVE`
    );
    setText(el.teamNames, playerNames().join(" + ") || "TEAM P.A.C");
    el.teamHud.classList.toggle("is-wiped", state.wiped);
  }

  function roundUi() {
    return {
      overlay: document.getElementById("roundResultOverlay"),
      title: document.getElementById("roundResultTitle"),
      note: document.querySelector("#roundResultOverlay .round-result__note"),
      button: document.getElementById("restartRoundButton")
    };
  }

  function setRestartButton(button, disabled, text) {
    if (!button) return;
    if (button.disabled !== disabled) button.disabled = disabled;
    if (button.textContent !== text) button.textContent = text;
    if (disabled) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }

  function updateRoundUi() {
    if (!isCoop() || !isPlaying()) return;
    const ui = roundUi();
    if (!ui.overlay || ui.overlay.classList.contains("hidden") || !ui.button) return;

    if (!state.wiped) {
      setText(ui.title, "You’re Out");
      setText(
        ui.note,
        `${state.aliveCount} teammate${state.aliveCount === 1 ? "" : "s"} still running. Your team score continues.`
      );
      setRestartButton(ui.button, true, "Team Still Running");
      return;
    }

    setText(ui.title, "Coop Run Over");
    setText(
      ui.note,
      state.isHost
        ? `Team score ${state.teamScore.toLocaleString()}. Restart the whole team when ready.`
        : `Team score ${state.teamScore.toLocaleString()}. Waiting for the host.`
    );

    if (state.isHost && !state.restarting && !ui.button.classList.contains("is-cooling")) {
      setRestartButton(ui.button, false, "Restart Team");
    } else {
      setRestartButton(
        ui.button,
        true,
        state.restarting ? "Restarting Team…" : "Waiting for Host"
      );
    }
  }

  function calculate(world) {
    const scores = world?.scores || {};
    const alive = world?.alive || {};
    const ids = playerIds();

    state.teamScore = ids.reduce(
      (total, id) => total + safeScore(scores[id]),
      0
    );
    state.aliveCount = ids.filter((id) => alive[id] !== false).length;

    return ids.length >= MIN_PLAYERS &&
      ids.every((id) => Object.prototype.hasOwnProperty.call(alive, id)) &&
      state.aliveCount === 0;
  }

  function inspectWorld(world) {
    if (!world || typeof world !== "object") return;
    adopt(world.coop);
    if (!isCoop()) return;

    const wasWiped = state.wiped;
    state.wiped = calculate(world);
    updateTeamHud();
    updateRoundUi();

    if (!wasWiped && state.wiped) void submitTeamRun();
  }

  async function submitTeamRun() {
    ensureRunKey();
    if (!state.isHost || !state.room?.id) return;
    if (state.players.length < MIN_PLAYERS) return;
    if (state.submitted.has(state.runKey)) return;

    state.submitted.add(state.runKey);
    state.submission = (async () => {
      const { error } = await client().rpc("submit_pacman_coop_score", {
        p_room_id: state.room.id,
        p_run_key: state.runKey.slice(0, 160),
        p_score: safeScore(state.teamScore)
      });
      if (error) throw new Error(error.message || "Unable to save team score.");
      await refreshLeaderboards();
    })()
      .catch((error) => {
        state.submitted.delete(state.runKey);
        console.error("Coop score submission failed:", error);
      })
      .finally(() => {
        state.submission = null;
      });

    await state.submission;
  }

  async function restartTeam() {
    if (!state.isHost || !state.wiped || state.restarting) return;
    state.restarting = true;
    updateRoundUi();

    try {
      if (state.submission) await state.submission;

      state.players
        .filter((p) => p?.user_id && p.user_id !== state.currentUserId)
        .forEach((p) => {
          document.dispatchEvent(new CustomEvent("pacman:remote-player-state", {
            detail: {
              payload: {
                userId: p.user_id,
                playerSlot: p.player_slot,
                roundAction: "restart-round",
                sequence: Date.now(),
                sentAt: Date.now()
              }
            }
          }));
        });

      window.ElementalPacman?.requestRoundRestart?.();
      state.run += 1;
      state.runKey = makeRunKey();
      state.teamScore = 0;
      state.aliveCount = state.players.length;
      state.wiped = false;
    } finally {
      state.restarting = false;
      updateTeamHud();
      updateRoundUi();
    }
  }

  async function chooseMode(mode) {
    const next = normaliseMode(mode);
    if (
      state.savingMode || !state.isHost || !state.room?.id ||
      state.room.status !== "waiting" || next === state.mode
    ) return;

    state.savingMode = true;
    updateSwitch();
    setMessage(`Switching room to ${next === COOP ? "Cooperative" : "Versus"} mode…`);

    try {
      await window.PacmanRoomService.setRoomGameMode(state.room.id, next);
      state.mode = next;
      await window.PacmanMultiplayer?.refreshRoom?.();
      setMessage(
        next === COOP
          ? "Cooperative mode selected. Everyone contributes to one team score."
          : "Versus mode selected. Every player keeps an individual score.",
        "success"
      );
    } catch (error) {
      setMessage(
        `${error.message} Run supabase/v10-coop-mode.sql if the upgrade is not installed.`,
        "error"
      );
    } finally {
      state.savingMode = false;
      updateSwitch();
    }
  }

  function applyRoom(detail = {}) {
    if (detail.room) state.room = detail.room;
    if (Array.isArray(detail.players)) state.players = detail.players;
    if (detail.currentUserId) state.currentUserId = detail.currentUserId;

    state.mode = normaliseMode(state.room?.game_mode);
    state.isHost = Boolean(
      state.currentUserId && state.room?.host_user_id === state.currentUserId
    );

    if (!isCoop()) {
      state.teamScore = 0;
      state.aliveCount = 0;
      state.wiped = false;
    }

    if (state.room?.status === "waiting" && !state.savingMode) {
      setMessage(
        isCoop()
          ? state.isHost
            ? "Cooperative mode selected. Start when at least two players are ready."
            : "Cooperative mode selected. Everyone contributes to one team score."
          : state.isHost
            ? "Versus mode selected. Start now or share the room ID."
            : "Versus mode selected. Every player keeps an individual score."
      );
    }

    updateSwitch();
    updateTeamHud();
  }

  function startRun(detail = {}) {
    const savedKey = state.runKey;
    const savedRun = state.run;
    applyRoom(detail);
    const sameRoom = savedKey && state.room?.id && savedKey.startsWith(`${state.room.id}:`);
    state.run = sameRoom ? Math.max(1, savedRun) : 1;
    state.runKey = sameRoom ? savedKey : makeRunKey();
    state.teamScore = 0;
    state.aliveCount = state.players.length;
    state.wiped = false;
    state.restarting = false;
    updateTeamHud();
  }

  function reset() {
    state.room = null;
    state.players = [];
    state.currentUserId = null;
    state.mode = VERSUS;
    state.isHost = false;
    state.run = 1;
    state.runKey = null;
    state.teamScore = 0;
    state.aliveCount = 0;
    state.wiped = false;
    state.restarting = false;
    state.submission = null;
    state.savingMode = false;
    state.submitted.clear();
    updateSwitch();
    updateTeamHud();
  }

  el.versus?.addEventListener("click", () => void chooseMode(VERSUS));
  el.coop?.addEventListener("click", () => void chooseMode(COOP));

  el.start?.addEventListener("click", (event) => {
    if (!isCoop() || state.players.length >= MIN_PLAYERS) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setMessage("Cooperative mode needs at least two players before starting.", "error");
  }, true);

  el.newMap?.addEventListener("click", () => {
    if (!isCoop() || !state.isHost || !isPlaying()) return;
    state.run += 1;
    state.runKey = makeRunKey();
    state.teamScore = 0;
    state.aliveCount = state.players.length;
    state.wiped = false;
  }, true);

  document.addEventListener("pacman:room-updated", (event) => applyRoom(event.detail));
  document.addEventListener("pacman:room-started", (event) => startRun(event.detail));
  document.addEventListener("pacman:host-changed", (event) => applyRoom({
    room: event.detail.room,
    players: window.PacmanMultiplayer?.state?.players || state.players,
    currentUserId: window.PacmanMultiplayer?.state?.user?.id || state.currentUserId
  }));
  document.addEventListener("pacman:shared-world-frame", (event) => inspectWorld(event.detail.frame));
  document.addEventListener("pacman:shared-world-snapshot", (event) => inspectWorld(event.detail.snapshot));
  document.addEventListener("pacman:room-left", reset);
  document.addEventListener("pacman:room-closed", reset);
  document.addEventListener("pacman:auth-changed", () => setTimeout(refreshLeaderboards, 0));
  document.addEventListener("pacman:score-submitted", () => setTimeout(refreshLeaderboards, 0));

  document.addEventListener("pacman:restart-round-requested", (event) => {
    if (!isCoop() || !isPlaying()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.wiped && state.isHost) void restartTeam();
    else updateRoundUi();
  }, true);

  patchRoomService();
  patchLeaderboard();
  patchWorldSync();

  const board = document.querySelector("#gameShell .board-wrap");
  new MutationObserver(() => updateRoundUi()).observe(board || document.body, {
    childList: true,
    characterData: true,
    subtree: true
  });

  new MutationObserver(() => {
    const first = el.indTrack?.querySelector(".lobby-score-group");
    if (first && !String(first.textContent).startsWith("IND HIGH SCORE")) {
      queueMicrotask(refreshLeaderboards);
    }
  }).observe(el.indTrack || document.body, {
    childList: true,
    characterData: true,
    subtree: true
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshLeaderboards, { once: true });
  } else {
    void refreshLeaderboards();
  }

  window.PacmanCoopMode = Object.freeze({
    isCoop,
    getTeamScore: () => state.teamScore,
    getAliveCount: () => state.aliveCount,
    refreshLeaderboards
  });
})();
