(function () {
  "use strict";

  const MOBILE_QUERY = "(max-width: 950px) and (pointer: coarse)";
  const JOYSTICK_SIDE_KEY = "pacJoystickSide";
  const DIRECTION_BY_CODE = Object.freeze({
    ArrowUp: { x: 0, y: -1 },
    ArrowRight: { x: 1, y: 0 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }
  });

  const gameShell = document.getElementById("gameShell");
  const leaveRoomButton = document.getElementById("leaveRoomButton");

  if (!gameShell || !leaveRoomButton) return;

  const joystick = document.createElement("div");
  joystick.id = "mobileJoystick";
  joystick.className = "mobile-joystick";
  joystick.setAttribute("aria-hidden", "false");

  joystick.innerHTML = `
    <button
      class="mobile-joystick__side-switch"
      type="button"
      aria-label="Move joystick to left side"
      title="Move joystick to left side"
    >
      ⇆
    </button>

    <div
      class="mobile-joystick__base"
      role="application"
      tabindex="0"
      aria-label="Movement joystick. Drag up, down, left, or right."
    >
      <span class="mobile-joystick__ring" aria-hidden="true"></span>
      <span class="mobile-joystick__arrow mobile-joystick__arrow--up" aria-hidden="true">▲</span>
      <span class="mobile-joystick__arrow mobile-joystick__arrow--right" aria-hidden="true">▲</span>
      <span class="mobile-joystick__arrow mobile-joystick__arrow--down" aria-hidden="true">▲</span>
      <span class="mobile-joystick__arrow mobile-joystick__arrow--left" aria-hidden="true">▲</span>
      <span class="mobile-joystick__stick" aria-hidden="true"></span>
    </div>
  `;

  gameShell.appendChild(joystick);

  const base = joystick.querySelector(".mobile-joystick__base");
  const sideSwitch = joystick.querySelector(
    ".mobile-joystick__side-switch"
  );
  const mobileMedia = window.matchMedia(MOBILE_QUERY);

  function readJoystickSide() {
    try {
      return localStorage.getItem(JOYSTICK_SIDE_KEY) === "left"
        ? "left"
        : "right";
    } catch (_error) {
      return "right";
    }
  }

  let joystickSide = readJoystickSide();

  const pointer = {
    active: false,
    id: null,
    lastCode: ""
  };

  let positionFrame = 0;

  function applyJoystickSide(side, persist = true) {
    joystickSide = side === "left" ? "left" : "right";
    joystick.dataset.side = joystickSide;

    const nextSide = joystickSide === "right" ? "left" : "right";
    const label = `Move joystick to ${nextSide} side`;

    sideSwitch.setAttribute("aria-label", label);
    sideSwitch.title = label;

    if (persist) {
      try {
        localStorage.setItem(JOYSTICK_SIDE_KEY, joystickSide);
      } catch (_error) {
        // Continue without saving when storage is unavailable.
      }
    }

    positionJoystick();
  }

  function isMobileJoystickActive() {
    return mobileMedia.matches &&
      gameShell.getAttribute("aria-hidden") === "false";
  }

  function dispatchDirection(code) {
    if (!DIRECTION_BY_CODE[code] || code === pointer.lastCode) return;

    pointer.lastCode = code;

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: code,
        code,
        bubbles: true,
        cancelable: true
      })
    );

    if (navigator.vibrate) navigator.vibrate(7);
  }

  function resolveDirection(dx, dy, radius) {
    const deadZone = radius * 0.2;
    if (Math.hypot(dx, dy) < deadZone) return "";

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "ArrowRight" : "ArrowLeft";
    }

    return dy > 0 ? "ArrowDown" : "ArrowUp";
  }

  function setStickPosition(dx, dy) {
    const rect = base.getBoundingClientRect();
    const maxTravel = rect.width * 0.255;
    const length = Math.hypot(dx, dy);
    const scale = length > maxTravel ? maxTravel / length : 1;

    joystick.style.setProperty("--stick-x", `${dx * scale}px`);
    joystick.style.setProperty("--stick-y", `${dy * scale}px`);
  }

  function updateFromPointer(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;

    const rect = base.getBoundingClientRect();
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const dx = event.clientX - centreX;
    const dy = event.clientY - centreY;

    setStickPosition(dx, dy);

    const code = resolveDirection(dx, dy, rect.width / 2);
    if (code) dispatchDirection(code);
  }

  function resetJoystick() {
    pointer.active = false;
    pointer.id = null;
    pointer.lastCode = "";
    joystick.classList.remove("is-active");
    joystick.style.setProperty("--stick-x", "0px");
    joystick.style.setProperty("--stick-y", "0px");
  }

  function positionJoystick() {
    window.cancelAnimationFrame(positionFrame);

    positionFrame = window.requestAnimationFrame(() => {
      const buttonRect = leaveRoomButton.getBoundingClientRect();

      const viewportWidth =
        window.visualViewport?.width ||
        document.documentElement.clientWidth ||
        window.innerWidth;

      const viewportHeight =
        window.visualViewport?.height ||
        document.documentElement.clientHeight ||
        window.innerHeight;

      if (buttonRect.width <= 0 || buttonRect.height <= 0) return;

      const distanceBelowButton = Math.max(
        0,
        viewportHeight - buttonRect.bottom
      );

      const bottom =
        distanceBelowButton +
        buttonRect.height +
        13;

      const joystickRadius = joystick.offsetWidth / 2;
      const edgeSpacing = 18;

      const horizontalCentre = viewportWidth * 0.5;

      joystick.style.left = `${horizontalCentre}px`;
      joystick.style.bottom = `${bottom}px`;
    });
  }

  sideSwitch.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  sideSwitch.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    resetJoystick();

    applyJoystickSide(
      joystickSide === "right" ? "left" : "right"
    );

    if (navigator.vibrate) {
      navigator.vibrate(12);
    }
  });

  base.addEventListener("pointerdown", (event) => {
    if (!isMobileJoystickActive()) return;

    event.preventDefault();
    pointer.active = true;
    pointer.id = event.pointerId;
    pointer.lastCode = "";
    joystick.classList.add("is-active");
    base.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  });

  base.addEventListener("pointermove", (event) => {
    if (!pointer.active) return;
    event.preventDefault();
    updateFromPointer(event);
  });

  function finishPointer(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    event.preventDefault();
    base.releasePointerCapture?.(event.pointerId);
    resetJoystick();
  }

  base.addEventListener("pointerup", finishPointer);
  base.addEventListener("pointercancel", finishPointer);
  base.addEventListener("lostpointercapture", resetJoystick);

  base.addEventListener("keydown", (event) => {
    if (!DIRECTION_BY_CODE[event.code]) return;
    event.preventDefault();
    dispatchDirection(event.code);
  });

  window.addEventListener("resize", positionJoystick, { passive: true });
  window.addEventListener("orientationchange", () => {
    resetJoystick();
    window.setTimeout(positionJoystick, 80);
  }, { passive: true });

  window.visualViewport?.addEventListener("resize", positionJoystick, {
    passive: true
  });

  mobileMedia.addEventListener?.("change", () => {
    resetJoystick();
    positionJoystick();
  });

  const gameVisibilityObserver = new MutationObserver(() => {
    resetJoystick();
    positionJoystick();
  });

  gameVisibilityObserver.observe(gameShell, {
    attributes: true,
    attributeFilter: ["aria-hidden"]
  });

  document.addEventListener("pacman:room-started", () => {
    window.setTimeout(positionJoystick, 80);
  });

  document.addEventListener("pacman:room-left", resetJoystick);
  document.addEventListener("pacman:room-closed", resetJoystick);

  applyJoystickSide(joystickSide, false);
})();
