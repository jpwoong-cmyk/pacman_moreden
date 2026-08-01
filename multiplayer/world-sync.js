(function () {
  "use strict";

  const state = {
    roomId: null,
    currentUserId: null,
    hostUserId: null,
    version: 0,
    active: false
  };

  function emit(name, detail = {}) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function start(room, currentUserId) {
    state.roomId = room?.id || null;
    state.currentUserId = currentUserId || null;
    state.hostUserId = room?.host_user_id || null;
    state.version = 0;
    state.active = Boolean(state.roomId && state.currentUserId);
  }

  function stop() {
    state.roomId = null;
    state.currentUserId = null;
    state.hostUserId = null;
    state.version = 0;
    state.active = false;
  }

  function updateRoom(room) {
    if (!room || room.id !== state.roomId) return;

    const previousHostUserId = state.hostUserId;
    state.hostUserId = room.host_user_id || null;

    if (previousHostUserId !== state.hostUserId) {
      emit("pacman:world-authority-changed", {
        previousHostUserId,
        hostUserId: state.hostUserId,
        isHost: isHost()
      });
    }
  }

  function isHost() {
    return Boolean(
      state.active &&
      state.currentUserId &&
      state.hostUserId === state.currentUserId
    );
  }

  function nextVersion() {
    state.version += 1;
    return state.version;
  }

  function adoptVersion(version) {
    const parsed = Math.max(0, Math.floor(Number(version) || 0));
    state.version = Math.max(state.version, parsed);
    return state.version;
  }

  function baseEnvelope(kind, version) {
    return {
      kind,
      roomId: state.roomId,
      hostUserId: state.hostUserId,
      senderUserId: state.currentUserId,
      version,
      sentAt: Date.now()
    };
  }

  function requestSnapshot() {
    if (!state.active || isHost()) return false;

    return window.PacmanMultiplayer?.broadcastWorldRequest({
      roomId: state.roomId,
      requestUserId: state.currentUserId,
      knownVersion: state.version,
      sentAt: Date.now()
    }) || false;
  }

  function sendSnapshot(snapshot, targetUserId = null) {
    if (!isHost()) return null;

    const envelope = {
      ...baseEnvelope("snapshot", nextVersion()),
      targetUserId,
      snapshot
    };

    window.PacmanMultiplayer?.broadcastWorldSnapshot(envelope);
    return envelope;
  }

  function sendFrame(frame) {
    if (!isHost()) return null;

    const envelope = {
      ...baseEnvelope("frame", nextVersion()),
      frame
    };

    window.PacmanMultiplayer?.broadcastWorldFrame(envelope);
    return envelope;
  }

  function sendEvent(event) {
    if (!isHost()) return null;

    const envelope = {
      ...baseEnvelope("event", nextVersion()),
      event
    };

    window.PacmanMultiplayer?.broadcastWorldEvent(envelope);
    return envelope;
  }

  function validHostEnvelope(payload) {
    if (!state.active || !payload) return false;
    if (payload.roomId !== state.roomId) return false;
    if (!state.hostUserId || payload.hostUserId !== state.hostUserId) return false;
    if (payload.senderUserId !== state.hostUserId) return false;

    if (
      payload.targetUserId &&
      payload.targetUserId !== state.currentUserId
    ) {
      return false;
    }

    return true;
  }

  document.addEventListener("pacman:host-changed", (event) => {
    updateRoom(event.detail.room);
  });

  document.addEventListener("pacman:world-request", (event) => {
    const payload = event.detail.payload;

    if (
      !isHost() ||
      !payload ||
      payload.roomId !== state.roomId ||
      !payload.requestUserId ||
      payload.requestUserId === state.currentUserId
    ) {
      return;
    }

    emit("pacman:world-snapshot-requested", {
      requestUserId: payload.requestUserId,
      knownVersion: Math.max(0, Number(payload.knownVersion) || 0)
    });
  });

  document.addEventListener("pacman:world-snapshot", (event) => {
    const payload = event.detail.payload;
    if (!validHostEnvelope(payload)) return;

    const incomingVersion = Math.max(0, Number(payload.version) || 0);
    if (incomingVersion < state.version) return;

    adoptVersion(incomingVersion);
    emit("pacman:shared-world-snapshot", {
      snapshot: payload.snapshot,
      version: incomingVersion,
      hostUserId: payload.hostUserId
    });
  });

  document.addEventListener("pacman:world-frame", (event) => {
    const payload = event.detail.payload;
    if (!validHostEnvelope(payload)) return;

    const incomingVersion = Math.max(0, Number(payload.version) || 0);
    if (incomingVersion <= state.version) return;

    adoptVersion(incomingVersion);
    emit("pacman:shared-world-frame", {
      frame: payload.frame,
      version: incomingVersion,
      hostUserId: payload.hostUserId
    });
  });

  document.addEventListener("pacman:world-event", (event) => {
    const payload = event.detail.payload;
    if (!validHostEnvelope(payload)) return;

    const incomingVersion = Math.max(0, Number(payload.version) || 0);
    if (incomingVersion <= state.version) return;

    adoptVersion(incomingVersion);
    emit("pacman:shared-world-event", {
      event: payload.event,
      version: incomingVersion,
      hostUserId: payload.hostUserId
    });
  });

  async function loadPersisted() {
    if (!state.active || !window.PacmanWorldService) return null;
    return window.PacmanWorldService.loadWorld(state.roomId);
  }

  async function savePersisted(snapshot) {
    if (!isHost() || !window.PacmanWorldService) return null;

    return window.PacmanWorldService.saveWorld(
      state.roomId,
      state.version,
      snapshot
    );
  }

  window.PacmanWorldSync = Object.freeze({
    state,
    start,
    stop,
    updateRoom,
    isHost,
    requestSnapshot,
    sendSnapshot,
    sendFrame,
    sendEvent,
    adoptVersion,
    loadPersisted,
    savePersisted,
    getVersion: () => state.version,
    getHostUserId: () => state.hostUserId
  });
})();
