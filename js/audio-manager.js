(function () {
  "use strict";

  const TRACKS = Object.freeze({
    lobby: {
      src: "audio/lobby-theme.mp3",
      volume: 0.58
    },
    game: {
      src: "audio/game-theme.mp3",
      volume: 0.55
    },
    danger: {
      src: "audio/danger-layer.mp3",
      volume: 0.64
    }
  });

  const audio = {
    lobby: new Audio(TRACKS.lobby.src),
    game: new Audio(TRACKS.game.src),
    danger: new Audio(TRACKS.danger.src)
  };

  Object.values(audio).forEach((track) => {
    track.loop = true;
    track.preload = "auto";
  });

  audio.lobby.volume = TRACKS.lobby.volume;
  audio.game.volume = TRACKS.game.volume;
  audio.danger.volume = 0;

  const state = {
    unlocked: false,
    desiredMode: "lobby",
    dangerActive: false,
    muted: localStorage.getItem("pacman-audio-muted") === "true",
    fadeTokens: new WeakMap()
  };

  Object.values(audio).forEach((track) => {
    track.muted = state.muted;
  });

  function safePlay(track) {
    if (!state.unlocked) return Promise.resolve(false);
    return track.play()
      .then(() => true)
      .catch(() => false);
  }

  function stopTrack(track, reset = true) {
    track.pause();
    if (reset) {
      try {
        track.currentTime = 0;
      } catch (_error) {
        // Some browsers reject currentTime changes before metadata loads.
      }
    }
  }

  function fade(track, target, duration = 500, onComplete = null) {
    const token = Symbol("audio-fade");
    state.fadeTokens.set(track, token);

    const startVolume = track.volume;
    const startedAt = performance.now();
    const safeTarget = Math.max(0, Math.min(1, target));

    function frame(now) {
      if (state.fadeTokens.get(track) !== token) return;
      const progress = Math.min(1, (now - startedAt) / Math.max(1, duration));
      const eased = progress * (2 - progress);
      track.volume = startVolume + (safeTarget - startVolume) * eased;

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else if (typeof onComplete === "function") {
        onComplete();
      }
    }

    requestAnimationFrame(frame);
  }

  async function applyDesiredMode() {
    if (!state.unlocked) return;

    if (state.desiredMode === "lobby") {
      state.dangerActive = false;
      stopTrack(audio.game);
      stopTrack(audio.danger);
      audio.danger.volume = 0;
      audio.lobby.volume = TRACKS.lobby.volume;
      await safePlay(audio.lobby);
      return;
    }

    if (state.desiredMode === "game") {
      stopTrack(audio.lobby);
      audio.game.volume = TRACKS.game.volume;
      await safePlay(audio.game);

      if (state.dangerActive) {
        audio.danger.volume = TRACKS.danger.volume;
        await safePlay(audio.danger);
      } else {
        stopTrack(audio.danger);
        audio.danger.volume = 0;
      }
      return;
    }

    stopTrack(audio.lobby);
    stopTrack(audio.game);
    stopTrack(audio.danger);
    audio.danger.volume = 0;
  }

  async function unlock() {
    if (state.unlocked) return;
    state.unlocked = true;
    await applyDesiredMode();
  }

  function playLobby() {
    state.desiredMode = "lobby";
    state.dangerActive = false;
    void applyDesiredMode();
  }

  function playGame() {
    state.desiredMode = "game";
    state.dangerActive = false;
    void applyDesiredMode();
  }

  async function setDangerActive(active) {
    const next = Boolean(active);
    if (next === state.dangerActive) return;

    state.dangerActive = next;
    if (!state.unlocked || state.desiredMode !== "game") return;

    if (next) {
      audio.danger.volume = 0;
      await safePlay(audio.danger);
      fade(audio.game, 0.32, 420);
      fade(audio.danger, TRACKS.danger.volume, 420);
    } else {
      fade(audio.game, TRACKS.game.volume, 650);
      fade(audio.danger, 0, 650, () => {
        if (!state.dangerActive) stopTrack(audio.danger);
      });
    }
  }

  function stopAll() {
    state.desiredMode = "silent";
    state.dangerActive = false;
    void applyDesiredMode();
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    localStorage.setItem("pacman-audio-muted", String(state.muted));
    Object.values(audio).forEach((track) => {
      track.muted = state.muted;
    });
    return state.muted;
  }

  function toggleMute() {
    return setMuted(!state.muted);
  }

  function unlockFromInteraction() {
    void unlock();
  }

  window.addEventListener("pointerdown", unlockFromInteraction, { once: true, passive: true });
  window.addEventListener("keydown", unlockFromInteraction, { once: true });

  window.PacmanAudio = Object.freeze({
    unlock,
    playLobby,
    playGame,
    setDangerActive,
    stopAll,
    setMuted,
    toggleMute,
    get muted() {
      return state.muted;
    }
  });
})();
