(function () {
  "use strict";

  const HEARTBEAT_INTERVAL_MS = 8_000;

  const state = {
    session: null,
    user: null,
    profile: null,
    room: null,
    players: [],
    initialized: false,
    roomStartDispatched: false,
    heartbeatTimer: null,
    refreshPromise: null
  };

  function emit(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function reportConnection(message, status) {
    emit("pacman:connection-status", { message, status });
  }

  async function loadIdentity(session) {
    state.session = session;
    state.user = session?.user || null;
    state.profile = null;

    if (state.user) {
      state.profile = await window.PacmanAuth.getProfile(state.user.id);
    }

    emit("pacman:auth-changed", {
      session: state.session,
      user: state.user,
      profile: state.profile
    });
  }

  async function initialize() {
    if (state.initialized) return;
    state.initialized = true;

    try {
      if (window.PACMAN_SUPABASE_CONFIGURATION_ERROR) {
        throw new Error(window.PACMAN_SUPABASE_CONFIGURATION_ERROR);
      }

      reportConnection("Connecting to Supabase…", "loading");
      const session = await window.PacmanAuth.getSession();
      await loadIdentity(session);
      reportConnection("Supabase connected", "connected");

      window.PacmanAuth.onAuthStateChange(async (_event, nextSession) => {
        try {
          if (!nextSession && state.room) {
            await leaveCurrentRoom({ skipDatabase: true });
          }
          await loadIdentity(nextSession);
        } catch (error) {
          reportConnection(error.message, "error");
        }
      });
    } catch (error) {
      reportConnection(error.message, "error");
      emit("pacman:auth-changed", {
        session: null,
        user: null,
        profile: null
      });
    }
  }

  async function signUp(details) {
    const result = await window.PacmanAuth.signUp(details);
    await loadIdentity(result.session);
    return result;
  }

  async function signIn(details) {
    const result = await window.PacmanAuth.signIn(details);
    await loadIdentity(result.session);
    return result;
  }

  async function signOut() {
    if (state.room) await leaveCurrentRoom();
    await window.PacmanAuth.signOut();
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) {
      window.clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  async function sendHeartbeat() {
    if (!state.room?.id) return;

    try {
      const room = await window.PacmanRoomService.heartbeatRoom(state.room.id);

      if (!room || room.status === "ended") {
        const message = "The game ended because no active players remained.";
        await leaveCurrentRoom({ skipDatabase: true });
        emit("pacman:room-closed", { message });
        return;
      }

      const previousHost = state.room.host_user_id;
      state.room = room;

      if (previousHost !== room.host_user_id) {
        await refreshRoom();
      }
    } catch (error) {
      reportConnection(`Room heartbeat failed: ${error.message}`, "error");
    }
  }

  function startHeartbeat() {
    stopHeartbeat();
    void sendHeartbeat();
    state.heartbeatTimer = window.setInterval(
      () => void sendHeartbeat(),
      HEARTBEAT_INTERVAL_MS
    );
  }

  async function enterRoom(room) {
    state.room = room;
    state.roomStartDispatched = false;

    await window.PacmanRoomRealtime.subscribe(room.id, {
      onChange: () => void refreshRoom(),
      onPlayerState: (payload) => {
        if (!payload || payload.userId === state.user?.id) return;
        emit("pacman:remote-player-state", { payload });
      },
      onRoomUpdate: (payload) => {
        if (payload?.eventType === "DELETE") {
          void leaveCurrentRoom({ skipDatabase: true });
          emit("pacman:room-closed", {
            message: "This game room no longer exists."
          });
          return;
        }
        void refreshRoom();
      },
      onStatus: (status, error) => {
        if (status === "SUBSCRIBED") {
          emit("pacman:room-realtime-status", { status: "connected" });
        } else if (status === "CHANNEL_ERROR" || error) {
          emit("pacman:room-realtime-status", {
            status: "error",
            message: error?.message || "Room realtime connection failed."
          });
        }
      }
    });

    startHeartbeat();
    await refreshRoom();
    return state.room;
  }

  async function createRoom() {
    if (!state.user) throw new Error("Log in before creating a room.");
    return enterRoom(await window.PacmanRoomService.createRoom());
  }

  async function joinRoom(code) {
    if (!state.user) throw new Error("Log in before joining a room.");
    return enterRoom(await window.PacmanRoomService.joinRoom(code));
  }

  async function refreshRoom() {
    if (!state.room?.id) return;
    if (state.refreshPromise) return state.refreshPromise;

    const roomId = state.room.id;
    state.refreshPromise = (async () => {
      try {
        const [room, players] = await Promise.all([
          window.PacmanRoomService.getRoom(roomId),
          window.PacmanRoomService.getPlayers(roomId)
        ]);

        if (!state.room || state.room.id !== roomId) return;

        if (room.status === "ended") {
          await leaveCurrentRoom({ skipDatabase: true });
          emit("pacman:room-closed", {
            message: "The game ended because no players remained."
          });
          return;
        }

        const currentMembership = players.some(
          (player) => player.user_id === state.user?.id
        );

        if (!currentMembership) {
          await leaveCurrentRoom({ skipDatabase: true });
          emit("pacman:room-closed", {
            message: "Your room session expired. Join again using the game ID."
          });
          return;
        }

        state.room = room;
        state.players = players;

        emit("pacman:room-updated", {
          room,
          players,
          currentUserId: state.user?.id || null,
          isHost: room.host_user_id === state.user?.id
        });

        if (room.status === "playing" && !state.roomStartDispatched) {
          state.roomStartDispatched = true;
          emit("pacman:room-started", {
            room,
            players,
            currentUserId: state.user?.id || null,
            joinedInProgress: Boolean(room.started_at)
          });
        }
      } finally {
        state.refreshPromise = null;
      }
    })();

    return state.refreshPromise;
  }

  async function startCurrentRoom() {
    if (!state.room) throw new Error("No active room.");
    await window.PacmanRoomService.startRoom(state.room.id);
    await refreshRoom();
  }


  function broadcastPlayerState(playerState) {
    if (!state.room || state.room.status !== "playing" || !state.user) return false;

    const membership = state.players.find(
      (player) => player.user_id === state.user.id
    );

    return window.PacmanRoomRealtime.sendPlayerState({
      ...playerState,
      roomId: state.room.id,
      userId: state.user.id,
      playerSlot: membership?.player_slot || 1,
      accountName:
        state.profile?.account_name ||
        state.profile?.display_name ||
        `Player ${membership?.player_slot || 1}`
    });
  }

  async function leaveCurrentRoom(options = {}) {
    const room = state.room;
    state.room = null;
    state.players = [];
    state.roomStartDispatched = false;
    state.refreshPromise = null;

    stopHeartbeat();
    await window.PacmanRoomRealtime.unsubscribe();

    if (room && !options.skipDatabase) {
      await window.PacmanRoomService.leaveRoom(room.id);
    }

    emit("pacman:room-left", { room });
  }

  window.PacmanMultiplayer = Object.freeze({
    state,
    initialize,
    signUp,
    signIn,
    signOut,
    createRoom,
    joinRoom,
    refreshRoom,
    startCurrentRoom,
    broadcastPlayerState,
    leaveCurrentRoom
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
