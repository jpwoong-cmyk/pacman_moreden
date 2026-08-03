(function () {
  "use strict";

  const LOBBY_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  const IDLE_CLEANUP_GRACE_MS = 2500;
  const IDLE_PAGE_MARKER = "pac-idle-timeout-page-loaded";

  const lobbyScreen = document.getElementById("lobbyScreen");
  const gameShell = document.getElementById("gameShell");
  const connectionStatus = document.getElementById("connectionStatus");

  const authView = document.getElementById("authView");
  const authChoice = document.getElementById("authChoice");
  const showCreateAccountButton = document.getElementById("showCreateAccountButton");
  const showLoginButton = document.getElementById("showLoginButton");
  const createAccountForm = document.getElementById("createAccountForm");
  const loginForm = document.getElementById("loginForm");
  const createAccountMessage = document.getElementById("createAccountMessage");
  const loginMessage = document.getElementById("loginMessage");

  const roomView = document.getElementById("roomView");
  const accountDisplayName = document.getElementById("accountDisplayName");
  const signOutButton = document.getElementById("signOutButton");
  const roomChoice = document.getElementById("roomChoice");
  const createGameButton = document.getElementById("createGameButton");
  const joinGameButton = document.getElementById("joinGameButton");
  const joinRoomPanel = document.getElementById("joinRoomPanel");
  const roomIdInput = document.getElementById("roomIdInput");
  const joinRoomMessage = document.getElementById("joinRoomMessage");
  const cancelJoinButton = document.getElementById("cancelJoinButton");

  const waitingRoomPanel = document.getElementById("waitingRoomPanel");
  const activeRoomCode = document.getElementById("activeRoomCode");
  const copyRoomButton = document.getElementById("copyRoomButton");
  const roomStatusBadge = document.getElementById("roomStatusBadge");
  const roomPlayerCount = document.getElementById("roomPlayerCount");
  const roomPlayerList = document.getElementById("roomPlayerList");
  const waitingRoomMessage = document.getElementById("waitingRoomMessage");
  const startRoomButton = document.getElementById("startRoomButton");
  const leaveWaitingRoomButton = document.getElementById("leaveWaitingRoomButton");

  let currentProfile = null;
  let currentRoom = null;
  let lobbyIdleTimer = null;
  let lastLobbyActivityAt = Date.now();
  let idleTimedOut = false;

  function setMessage(element, message, type = "") {
    element.textContent = message || "";
    element.classList.toggle("error", type === "error");
    element.classList.toggle("success", type === "success");
  }

  function setBusy(button, busy, busyText = "Working…") {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      delete button.dataset.originalText;
    }
  }

  function resetRoomActionButtons() {
    setBusy(createGameButton, false);
    setBusy(startRoomButton, false);
    setBusy(leaveWaitingRoomButton, false);

    startRoomButton.textContent = "Start Game";
    leaveWaitingRoomButton.textContent = "Leave Room";
  }

  function isLobbyVisible() {
    return (
      !lobbyScreen.classList.contains("hidden") &&
      lobbyScreen.getAttribute("aria-hidden") !== "true"
    );
  }

  function clearLobbyIdleTimer() {
    if (!lobbyIdleTimer) return;
    window.clearTimeout(lobbyIdleTimer);
    lobbyIdleTimer = null;
  }

  function scheduleLobbyIdleTimer(resetActivity = false) {
    if (idleTimedOut || !isLobbyVisible()) {
      clearLobbyIdleTimer();
      return;
    }

    if (resetActivity) {
      lastLobbyActivityAt = Date.now();
    }

    clearLobbyIdleTimer();

    const elapsed = Date.now() - lastLobbyActivityAt;
    const remaining = Math.max(0, LOBBY_IDLE_TIMEOUT_MS - elapsed);

    lobbyIdleTimer = window.setTimeout(
      () => void handleLobbyIdleTimeout(),
      remaining
    );
  }

  function recordLobbyActivity() {
    if (idleTimedOut || !isLobbyVisible()) return;
    scheduleLobbyIdleTimer(true);
  }

  async function disconnectIdleLobby() {
    /*
     * Best-effort cleanup. Each operation is isolated so one failed network
     * request cannot prevent the remaining local connections from closing.
     */
    try {
      await window.PacmanNetworkLatency?.stop?.();
    } catch (_error) {
      // Continue closing the remaining connections.
    }

    try {
      window.PacmanWorldSync?.stop?.();
    } catch (_error) {
      // Continue closing the remaining connections.
    }

    try {
      await window.PacmanMultiplayer?.leaveCurrentRoom?.();
    } catch (_error) {
      /*
       * The room may already have ended or the device may be offline.
       * removeAllChannels below still closes local Realtime channels.
       */
    }

    try {
      await window.pacmanSupabase?.removeAllChannels?.();
    } catch (_error) {
      // The room unsubscribe may already have removed every channel.
    }

    try {
      window.pacmanSupabase?.auth?.stopAutoRefresh?.();
    } catch (_error) {
      // A missing session has no refresh timer to stop.
    }
  }

  async function handleLobbyIdleTimeout() {
    if (idleTimedOut || !isLobbyVisible()) return;

    idleTimedOut = true;
    clearLobbyIdleTimer();
    resetRoomActionButtons();

    connectionStatus.textContent = "Idle timeout. Closing connection…";
    connectionStatus.dataset.state = "loading";

    const cleanup = disconnectIdleLobby();
    const cleanupLimit = new Promise((resolve) => {
      window.setTimeout(resolve, IDLE_CLEANUP_GRACE_MS);
    });

    await Promise.race([cleanup, cleanupLimit]);

    /*
     * idle.html sets this marker on its first load. Removing any older marker
     * ensures the first timeout page remains visible; refreshing it then
     * returns the player to the main P.A.C page.
     */
    try {
      window.sessionStorage.removeItem(IDLE_PAGE_MARKER);
    } catch (_error) {
      // Private browsing restrictions should not block the timeout page.
    }

    window.location.replace("idle.html");
  }

  function showAuthPanel(panel = "choice") {
    authChoice.hidden = panel !== "choice";
    createAccountForm.hidden = panel !== "create";
    loginForm.hidden = panel !== "login";

    if (panel === "choice") showCreateAccountButton.focus();
    if (panel === "create") document.getElementById("createAccountName").focus();
    if (panel === "login") document.getElementById("loginAccountName").focus();
  }

  function showRoomPanel(panel = "choice") {
    roomChoice.hidden = panel !== "choice";
    joinRoomPanel.hidden = panel !== "join";
    waitingRoomPanel.hidden = panel !== "waiting";

    if (panel === "choice") createGameButton.focus();
    if (panel === "join") roomIdInput.focus();
  }

  function showLobby() {
    lobbyScreen.classList.remove("hidden");
    lobbyScreen.setAttribute("aria-hidden", "false");
    gameShell.inert = true;
    gameShell.setAttribute("inert", "");
    gameShell.setAttribute("aria-hidden", "true");
    document.body.classList.add("lobby-open");
    window.PacmanAudio?.playLobby();
    scheduleLobbyIdleTimer(true);
  }

  function launchGame(room, players = [], currentUserId = null) {
    if (!room?.code) return;

    /*
     * The Start Game button is reused when another room is created later.
     * Restore it before hiding the lobby so it cannot remain disabled after
     * the first successful match start.
     */
    resetRoomActionButtons();
    clearLobbyIdleTimer();

    lobbyScreen.classList.add("hidden");
    lobbyScreen.setAttribute("aria-hidden", "true");
    gameShell.inert = false;
    gameShell.removeAttribute("inert");
    gameShell.setAttribute("aria-hidden", "false");
    document.body.classList.remove("lobby-open");
    window.PacmanAudio?.playGame();

    window.ElementalPacman.launchRoom(room, players, currentUserId);
  }

  function setSignedIn(profile) {
    currentProfile = profile;
    authView.hidden = true;
    roomView.hidden = false;
    accountDisplayName.textContent = profile?.account_name || profile?.display_name || "Player";
    resetRoomActionButtons();
    showRoomPanel("choice");
  }

  function setSignedOut() {
    currentProfile = null;
    currentRoom = null;
    resetRoomActionButtons();
    authView.hidden = false;
    roomView.hidden = true;
    showAuthPanel("choice");
    showLobby();
  }

  function renderPlayers(players, room, currentUserId) {
    roomPlayerList.replaceChildren();

    for (let slot = 1; slot <= room.max_players; slot += 1) {
      const player = players.find((item) => item.player_slot === slot);
      const item = document.createElement("li");
      item.className = player ? "room-player occupied" : "room-player empty";

      const slotLabel = document.createElement("span");
      slotLabel.className = "player-slot";
      slotLabel.textContent = `P${slot}`;

      const playerName = document.createElement("strong");
      playerName.textContent = player?.profile?.account_name || player?.profile?.display_name || "Waiting…";

      const playerTag = document.createElement("span");
      playerTag.className = "player-tag";

      if (player?.user_id === room.host_user_id) {
        playerTag.textContent = "HOST";
      } else if (player?.user_id === currentUserId) {
        playerTag.textContent = "YOU";
      } else {
        playerTag.textContent = player ? "READY" : "OPEN";
      }

      item.append(slotLabel, playerName, playerTag);
      roomPlayerList.appendChild(item);
    }
  }

  function renderWaitingRoom({ room, players, currentUserId, isHost }) {
    currentRoom = room;
    activeRoomCode.textContent = room.code;
    roomStatusBadge.textContent = room.status.toUpperCase();
    roomStatusBadge.dataset.status = room.status;
    roomPlayerCount.textContent = `${players.length} / ${room.max_players} players`;
    startRoomButton.hidden = !isHost || room.status !== "waiting";

    renderPlayers(players, room, currentUserId);

    if (isHost) {
      setMessage(waitingRoomMessage, "You are the host. Start now or share the ID so players can join later.");
    } else {
      setMessage(waitingRoomMessage, "Connected. The first active player is host; host control transfers automatically if they leave.");
    }

    showRoomPanel("waiting");
  }

  async function copyRoomCode() {
    const code = currentRoom?.code || activeRoomCode.textContent.trim();
    if (!code || code === "------") return;

    try {
      await navigator.clipboard.writeText(code);
    } catch (_error) {
      const temporary = document.createElement("textarea");
      temporary.value = code;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.appendChild(temporary);
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
    }

    const original = copyRoomButton.textContent;
    copyRoomButton.textContent = "Copied";
    window.setTimeout(() => {
      copyRoomButton.textContent = original;
    }, 1200);
  }

  showCreateAccountButton.addEventListener("click", () => {
    setMessage(createAccountMessage, "");
    showAuthPanel("create");
  });

  showLoginButton.addEventListener("click", () => {
    setMessage(loginMessage, "");
    showAuthPanel("login");
  });

  document.querySelectorAll(".auth-back-button").forEach((button) => {
    button.addEventListener("click", () => showAuthPanel("choice"));
  });

  createAccountForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = createAccountForm.querySelector('[type="submit"]');
    const password = document.getElementById("createPassword").value;
    const confirmPassword = document.getElementById("createPasswordConfirm").value;

    if (password !== confirmPassword) {
      setMessage(createAccountMessage, "The two passwords do not match.", "error");
      return;
    }

    setBusy(submitButton, true, "Creating…");
    setMessage(createAccountMessage, "Creating your account…");

    try {
      await window.PacmanMultiplayer.signUp({
        accountName: document.getElementById("createAccountName").value,
        password
      });

      setMessage(createAccountMessage, "Account created. Welcome to the city.", "success");
    } catch (error) {
      setMessage(createAccountMessage, error.message, "error");
    } finally {
      setBusy(submitButton, false);
    }
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = loginForm.querySelector('[type="submit"]');
    setBusy(submitButton, true, "Logging in…");
    setMessage(loginMessage, "Checking account…");

    try {
      await window.PacmanMultiplayer.signIn({
        accountName: document.getElementById("loginAccountName").value,
        password: document.getElementById("loginPassword").value
      });
      setMessage(loginMessage, "Logged in.", "success");
    } catch (error) {
      setMessage(loginMessage, error.message, "error");
    } finally {
      setBusy(submitButton, false);
    }
  });

  signOutButton.addEventListener("click", async () => {
    setBusy(signOutButton, true, "Signing out…");
    try {
      await window.PacmanMultiplayer.signOut();
    } catch (error) {
      connectionStatus.textContent = error.message;
      connectionStatus.dataset.state = "error";
    } finally {
      setBusy(signOutButton, false);
    }
  });

  createGameButton.addEventListener("click", async () => {
    setBusy(createGameButton, true, "Creating…");
    try {
      const room = await window.PacmanMultiplayer.createRoom();
      currentRoom = room;
      showRoomPanel("waiting");
    } catch (error) {
      connectionStatus.textContent = error.message;
      connectionStatus.dataset.state = "error";
    } finally {
      setBusy(createGameButton, false);
    }
  });

  joinGameButton.addEventListener("click", () => {
    setMessage(joinRoomMessage, "Use the six-character ID. You can join before or after the match starts.");
    roomIdInput.value = "";
    showRoomPanel("join");
  });

  roomIdInput.addEventListener("input", () => {
    const cleanCode = window.PacmanRoomService.sanitiseRoomCode(roomIdInput.value);
    roomIdInput.value = cleanCode;
    roomIdInput.classList.remove("invalid");
    setMessage(joinRoomMessage, "Use the six-character ID. You can join before or after the match starts.");
  });

  joinRoomPanel.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = joinRoomPanel.querySelector('[type="submit"]');
    setBusy(submitButton, true, "Joining…");

    try {
      await window.PacmanMultiplayer.joinRoom(roomIdInput.value);
    } catch (error) {
      roomIdInput.classList.add("invalid");
      setMessage(joinRoomMessage, error.message, "error");
    } finally {
      setBusy(submitButton, false);
    }
  });

  cancelJoinButton.addEventListener("click", () => showRoomPanel("choice"));
  copyRoomButton.addEventListener("click", copyRoomCode);

  startRoomButton.addEventListener("click", async () => {
    if (startRoomButton.disabled) return;

    setBusy(startRoomButton, true, "Starting…");

    try {
      await window.PacmanMultiplayer.startCurrentRoom();
    } catch (error) {
      setMessage(waitingRoomMessage, error.message, "error");
    } finally {
      /*
       * The original code only reset this button when an error occurred.
       * A successful start therefore left it permanently disabled for the
       * next room created during the same browser session.
       */
      setBusy(startRoomButton, false);
    }
  });

  leaveWaitingRoomButton.addEventListener("click", async () => {
    setBusy(leaveWaitingRoomButton, true, "Leaving…");
    try {
      await window.PacmanMultiplayer.leaveCurrentRoom();
      currentRoom = null;
      resetRoomActionButtons();
      showRoomPanel("choice");
    } catch (error) {
      setMessage(waitingRoomMessage, error.message, "error");
    } finally {
      setBusy(leaveWaitingRoomButton, false);
    }
  });

  document.addEventListener("pacman:connection-status", (event) => {
    connectionStatus.textContent = event.detail.message;
    connectionStatus.dataset.state = event.detail.status;
  });

  document.addEventListener("pacman:auth-changed", (event) => {
    const { profile } = event.detail;
    if (profile) setSignedIn(profile);
    else setSignedOut();
  });

  document.addEventListener("pacman:room-updated", (event) => {
    renderWaitingRoom(event.detail);
  });

  document.addEventListener("pacman:room-started", (event) => {
    launchGame(
      event.detail.room,
      event.detail.players || [],
      event.detail.currentUserId || null
    );
  });

  document.addEventListener("pacman:room-left", () => {
    currentRoom = null;
    resetRoomActionButtons();
    showLobby();
    if (currentProfile) showRoomPanel("choice");
  });

  document.addEventListener("pacman:room-closed", (event) => {
    currentRoom = null;
    resetRoomActionButtons();
    showLobby();
    showRoomPanel("choice");
    connectionStatus.textContent = event.detail.message || "The room was closed.";
    connectionStatus.dataset.state = "error";
  });

  document.addEventListener("pacman:leave-room", async () => {
    resetRoomActionButtons();
    showLobby();

    try {
      await window.PacmanMultiplayer.leaveCurrentRoom();
    } catch (error) {
      connectionStatus.textContent = error.message;
      connectionStatus.dataset.state = "error";
    }
  });

  window.addEventListener(
    "pointerdown",
    recordLobbyActivity,
    { capture: true, passive: true }
  );

  window.addEventListener(
    "touchstart",
    recordLobbyActivity,
    { capture: true, passive: true }
  );

  window.addEventListener(
    "wheel",
    recordLobbyActivity,
    { capture: true, passive: true }
  );

  window.addEventListener(
    "keydown",
    recordLobbyActivity,
    { capture: true }
  );

  document.addEventListener("visibilitychange", () => {
    if (idleTimedOut || !isLobbyVisible()) return;

    if (Date.now() - lastLobbyActivityAt >= LOBBY_IDLE_TIMEOUT_MS) {
      void handleLobbyIdleTimeout();
      return;
    }

    scheduleLobbyIdleTimer(false);
  });

  document.body.classList.add("lobby-open");
  showLobby();
  showAuthPanel("choice");
})();
