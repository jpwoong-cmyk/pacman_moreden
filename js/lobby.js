(function () {
  "use strict";

  const lobbyScreen = document.getElementById("lobbyScreen");
  const gameShell = document.getElementById("gameShell");
  const lobbyChoice = document.getElementById("lobbyChoice");
  const createGameButton = document.getElementById("createGameButton");
  const joinGameButton = document.getElementById("joinGameButton");
  const createRoomPanel = document.getElementById("createRoomPanel");
  const joinRoomPanel = document.getElementById("joinRoomPanel");
  const createdRoomId = document.getElementById("createdRoomId");
  const copyRoomButton = document.getElementById("copyRoomButton");
  const startCreatedGameButton = document.getElementById("startCreatedGameButton");
  const cancelCreateButton = document.getElementById("cancelCreateButton");
  const cancelJoinButton = document.getElementById("cancelJoinButton");
  const roomIdInput = document.getElementById("roomIdInput");
  const joinRoomMessage = document.getElementById("joinRoomMessage");

  const ID_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let activeRoomId = "";

  function sanitiseRoomId(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function createRoomId() {
    const values = new Uint32Array(6);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(values);
    } else {
      for (let i = 0; i < values.length; i += 1) {
        values[i] = Math.floor(Math.random() * 0xffffffff);
      }
    }

    return Array.from(values, (value) => ID_CHARACTERS[value % ID_CHARACTERS.length]).join("");
  }

  function setPanel(panel) {
    lobbyChoice.hidden = panel !== "choice";
    createRoomPanel.hidden = panel !== "create";
    joinRoomPanel.hidden = panel !== "join";
    lobbyScreen.classList.toggle("panel-open", panel !== "choice");
    lobbyScreen.scrollTop = 0;

    if (panel === "choice") createGameButton.focus();
    if (panel === "join") roomIdInput.focus();
    if (panel === "create") startCreatedGameButton.focus();
  }

  function updateRoomUrl(roomId) {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set("room", roomId);
    else url.searchParams.delete("room");
    url.searchParams.delete("autostart");
    try {
      window.history.replaceState({}, "", url);
    } catch (error) {
      // Some local preview environments block history changes. The lobby still works.
    }
  }

  function launch(roomId) {
    const cleanId = sanitiseRoomId(roomId);
    if (cleanId.length !== 6) return;

    activeRoomId = cleanId;
    try {
      localStorage.setItem("elementalPacman:lastRoom", cleanId);
    } catch (error) {
      // Storage can be unavailable in strict local-file previews.
    }
    updateRoomUrl(cleanId);

    lobbyScreen.classList.add("hidden");
    lobbyScreen.setAttribute("aria-hidden", "true");
    gameShell.inert = false;
    gameShell.removeAttribute("inert");
    gameShell.setAttribute("aria-hidden", "false");
    document.body.classList.remove("lobby-open");

    window.ElementalPacman.launchRoom(cleanId);
  }

  async function copyRoomId() {
    const text = activeRoomId || createdRoomId.textContent.trim();
    if (!text || text === "------") return;

    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }

    const original = copyRoomButton.textContent;
    copyRoomButton.textContent = "Copied";
    window.setTimeout(() => {
      copyRoomButton.textContent = original;
    }, 1200);
  }

  function showLobby() {
    activeRoomId = "";
    lobbyScreen.classList.remove("hidden");
    lobbyScreen.setAttribute("aria-hidden", "false");
    gameShell.inert = true;
    gameShell.setAttribute("inert", "");
    gameShell.setAttribute("aria-hidden", "true");
    document.body.classList.add("lobby-open");
    updateRoomUrl("");
    setPanel("choice");
  }

  createGameButton.addEventListener("click", () => {
    activeRoomId = createRoomId();
    createdRoomId.textContent = activeRoomId;
    setPanel("create");
  });

  joinGameButton.addEventListener("click", () => {
    joinRoomMessage.textContent = "Use the six-character ID shared by the room creator.";
    joinRoomMessage.classList.remove("error");
    roomIdInput.classList.remove("invalid");
    setPanel("join");
  });

  roomIdInput.addEventListener("input", () => {
    const cleanId = sanitiseRoomId(roomIdInput.value);
    if (roomIdInput.value !== cleanId) roomIdInput.value = cleanId;
    roomIdInput.classList.remove("invalid");
    joinRoomMessage.classList.remove("error");
    joinRoomMessage.textContent = "Use the six-character ID shared by the room creator.";
  });

  joinRoomPanel.addEventListener("submit", (event) => {
    event.preventDefault();
    const roomId = sanitiseRoomId(roomIdInput.value);

    if (roomId.length !== 6) {
      roomIdInput.classList.add("invalid");
      joinRoomMessage.classList.add("error");
      joinRoomMessage.textContent = "Enter a complete six-character game ID.";
      roomIdInput.focus();
      return;
    }

    launch(roomId);
  });

  copyRoomButton.addEventListener("click", copyRoomId);
  startCreatedGameButton.addEventListener("click", () => launch(activeRoomId));
  cancelCreateButton.addEventListener("click", () => setPanel("choice"));
  cancelJoinButton.addEventListener("click", () => setPanel("choice"));

  document.addEventListener("pacman:leave-room", showLobby);

  const roomFromUrl = sanitiseRoomId(new URLSearchParams(window.location.search).get("room"));
  document.body.classList.add("lobby-open");

  if (roomFromUrl.length === 6) {
    roomIdInput.value = roomFromUrl;
    setPanel("join");
  } else {
    setPanel("choice");
  }

  window.ElementalLobby = Object.freeze({
    show: showLobby,
    launch
  });
})();
