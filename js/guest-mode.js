(function () {
  "use strict";

  const guestButton = document.getElementById("playAsGuestButton");
  const lobbyScreen = document.getElementById("lobbyScreen");
  const gameShell = document.getElementById("gameShell");
  const latencyValue = document.getElementById("latencyValue");
  const coopTeamHud = document.getElementById("coopTeamHud");

  if (!guestButton || !lobbyScreen || !gameShell) return;

  const originalWorldService = window.PacmanWorldService;
  const originalLeaderboard = window.PacmanLeaderboard;
  const accountRoundNote = "Continue 😁 or Exit? 🙁";
  const guestRoundNote =
    "Continue your guest run,\nor discover more in Account Mode.";

  let guestActive = false;

  function roundResultNote() {
    return document.querySelector(
      "#roundResultOverlay .round-result__note"
    );
  }

  function setRoundResultMessage(message) {
    const note = roundResultNote();
    if (!note) return;

    note.textContent = message;
    note.classList.toggle(
      "round-result__note--guest",
      guestActive
    );
  }

  function installLocalOnlyServices() {
    window.PacmanWorldService = Object.freeze({
      loadWorld: async () => null,
      saveWorld: async () => null
    });

    window.PacmanLeaderboard = Object.freeze({
      getHighScores:
        originalLeaderboard?.getHighScores?.bind(originalLeaderboard),
      refreshTicker:
        originalLeaderboard?.refreshTicker?.bind(originalLeaderboard),
      submitScore: async (score) =>
        Math.max(0, Math.floor(Number(score) || 0))
    });
  }

  function restoreAccountServices() {
    if (originalWorldService) {
      window.PacmanWorldService = originalWorldService;
    }

    if (originalLeaderboard) {
      window.PacmanLeaderboard = originalLeaderboard;
    }
  }

  function showGameShell() {
    lobbyScreen.classList.add("hidden");
    lobbyScreen.setAttribute("aria-hidden", "true");

    gameShell.inert = false;
    gameShell.removeAttribute("inert");
    gameShell.setAttribute("aria-hidden", "false");

    document.body.classList.remove("lobby-open");
    document.body.classList.add("guest-mode-active");

    if (latencyValue) latencyValue.hidden = true;

    if (coopTeamHud) {
      coopTeamHud.hidden = true;
      coopTeamHud.setAttribute("aria-hidden", "true");
    }
  }

  function restoreLobbyPresentation() {
    document.body.classList.remove("guest-mode-active");

    if (latencyValue) latencyValue.hidden = false;

    setRoundResultMessage(accountRoundNote);
  }

  function generateGuestSeed() {
    const values = new Uint32Array(1);
    window.crypto?.getRandomValues?.(values);
    return Number(values[0]) || Date.now();
  }

  async function startGuestGame() {
    if (guestActive || guestButton.disabled) return;

    guestButton.disabled = true;
    guestButton.textContent = "Opening Guest Mode…";

    try {
      guestActive = true;
      window.PACMAN_GUEST_MODE = true;

      await window.PacmanNetworkLatency?.stop?.();
      window.PacmanWorldSync?.stop?.();

      installLocalOnlyServices();
      showGameShell();
      setRoundResultMessage(guestRoundNote);
      window.PacmanAudio?.playGame();

      const guestUserId = "guest-player";
      const guestSeed = generateGuestSeed();

      const guestRoom = {
        id: "guest-local-room",
        code: "GUEST",
        map_seed: guestSeed,
        status: "playing",
        host_user_id: guestUserId,
        max_players: 1,
        game_mode: "versus"
      };

      const guestRoster = [
        {
          user_id: guestUserId,
          player_slot: 1,
          profile: {
            account_name: "Guest",
            display_name: "Guest"
          }
        }
      ];

      window.ElementalPacman.launchRoom(
        guestRoom,
        guestRoster,
        guestUserId
      );
    } catch (error) {
      guestActive = false;
      window.PACMAN_GUEST_MODE = false;

      restoreAccountServices();
      restoreLobbyPresentation();

      lobbyScreen.classList.remove("hidden");
      lobbyScreen.setAttribute("aria-hidden", "false");

      gameShell.inert = true;
      gameShell.setAttribute("inert", "");
      gameShell.setAttribute("aria-hidden", "true");

      document.body.classList.add("lobby-open");

      const status = document.getElementById("connectionStatus");
      if (status) {
        status.textContent =
          error?.message || "Unable to start Guest Mode.";
        status.dataset.state = "error";
      }
    } finally {
      guestButton.disabled = false;
      guestButton.textContent = "Play as Guest";
    }
  }

  guestButton.addEventListener(
    "click",
    () => void startGuestGame()
  );

  document.addEventListener("pacman:leave-room", () => {
    if (!guestActive) return;

    guestActive = false;
    window.PACMAN_GUEST_MODE = false;

    restoreAccountServices();
    restoreLobbyPresentation();
  });

  document.addEventListener("pacman:auth-changed", (event) => {
    if (!event.detail?.profile) return;

    guestActive = false;
    window.PACMAN_GUEST_MODE = false;

    restoreAccountServices();
    restoreLobbyPresentation();
  });
})();
