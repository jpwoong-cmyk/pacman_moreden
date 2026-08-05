(function () {
  "use strict";

  const MOBILE_QUERY = "(max-width: 950px) and (pointer: coarse)";
  const CONTROL_MODE_KEY = "pacControlMode";
  const DEFAULT_MODE = "joystick";
  const VALID_MODES = new Set(["joystick", "arrows", "swipe"]);

  const DIRECTION_BY_CODE = Object.freeze({
    ArrowUp: { x: 0, y: -1 },
    ArrowRight: { x: 1, y: 0 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 }
  });

  const MODE_LABELS = Object.freeze({
    joystick: "Joystick",
    arrows: "Arrow Pad",
    swipe: "Swipe"
  });

  const gameShell = document.getElementById("gameShell");
  const board = document.querySelector("#gameShell .board-wrap");
  const canvas = document.getElementById("gameCanvas");

  if (!gameShell || !board || !canvas) return;

  const mobileMedia = window.matchMedia(MOBILE_QUERY);

  function readControlMode() {
    try {
      const saved = window.localStorage.getItem(CONTROL_MODE_KEY);
      return VALID_MODES.has(saved) ? saved : DEFAULT_MODE;
    } catch (_error) {
      return DEFAULT_MODE;
    }
  }

  function saveControlMode(mode) {
    try {
      window.localStorage.setItem(CONTROL_MODE_KEY, mode);
    } catch (_error) {
      // The selected mode remains active for this session.
    }
  }

  const controls = document.createElement("div");
  controls.id = "mobileControls";
  controls.className = "mobile-controls";
  controls.innerHTML = `
    <div class="mobile-control-picker">
      <button
        class="mobile-control-picker__trigger"
        type="button"
        aria-expanded="false"
        aria-controls="mobileControlMenu"
      >
        <span class="mobile-control-picker__caption">CONTROL</span>
        <strong class="mobile-control-picker__current">Joystick</strong>
        <span class="mobile-control-picker__chevron" aria-hidden="true">▾</span>
      </button>

      <div id="mobileControlMenu" class="mobile-control-picker__menu" hidden>
        <button type="button" data-control-choice="joystick" aria-pressed="true">
          <span aria-hidden="true">◉</span>
          <span>Joystick</span>
        </button>
        <button type="button" data-control-choice="arrows" aria-pressed="false">
          <span aria-hidden="true">✥</span>
          <span>Arrow Pad</span>
        </button>
        <button type="button" data-control-choice="swipe" aria-pressed="false">
          <span aria-hidden="true">↔</span>
          <span>Swipe</span>
        </button>
      </div>
    </div>

    <div
      id="mobileJoystick"
      class="mobile-joystick mobile-joystick--dynamic"
      aria-hidden="true"
    >
      <div class="mobile-joystick__base" aria-hidden="true">
        <span class="mobile-joystick__ring"></span>
        <span class="mobile-joystick__arrow mobile-joystick__arrow--up">▲</span>
        <span class="mobile-joystick__arrow mobile-joystick__arrow--right">▲</span>
        <span class="mobile-joystick__arrow mobile-joystick__arrow--down">▲</span>
        <span class="mobile-joystick__arrow mobile-joystick__arrow--left">▲</span>
        <span class="mobile-joystick__stick"></span>
      </div>
    </div>

    <div class="mobile-arrow-pad" aria-label="Movement arrow pad">
      <button type="button" data-direction-code="ArrowUp" aria-label="Move up">▲</button>
      <button type="button" data-direction-code="ArrowLeft" aria-label="Move left">◀</button>
      <span class="mobile-arrow-pad__centre" aria-hidden="true"></span>
      <button type="button" data-direction-code="ArrowRight" aria-label="Move right">▶</button>
      <button type="button" data-direction-code="ArrowDown" aria-label="Move down">▼</button>
    </div>

    <p class="mobile-control-hint mobile-control-hint--joystick" aria-hidden="true">
      Press and drag anywhere on the city
    </p>
    <p class="mobile-control-hint mobile-control-hint--swipe" aria-hidden="true">
      Swipe anywhere on the city to turn
    </p>
  `;

  gameShell.appendChild(controls);

  const picker = controls.querySelector(".mobile-control-picker");
  const pickerTrigger = controls.querySelector(".mobile-control-picker__trigger");
  const pickerCurrent = controls.querySelector(".mobile-control-picker__current");
  const pickerMenu = controls.querySelector(".mobile-control-picker__menu");
  const choiceButtons = Array.from(
    controls.querySelectorAll("[data-control-choice]")
  );
  const joystick = controls.querySelector(".mobile-joystick");
  const joystickBase = controls.querySelector(".mobile-joystick__base");
  const arrowButtons = Array.from(
    controls.querySelectorAll("[data-direction-code]")
  );

  let controlMode = readControlMode();
  let hintTimer = 0;

  const pointer = {
    active: false,
    id: null,
    baseX: 0,
    baseY: 0,
    lastCode: ""
  };

  function isGameVisible() {
    return gameShell.getAttribute("aria-hidden") === "false";
  }

  function isMobileControlsActive() {
    return mobileMedia.matches && isGameVisible();
  }

  function dispatchDirection(code) {
    if (!DIRECTION_BY_CODE[code]) return false;

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: code,
        code,
        bubbles: true,
        cancelable: true
      })
    );

    if (navigator.vibrate) navigator.vibrate(7);
    return true;
  }

  function resolveDirection(dx, dy, radius) {
    const deadZone = radius * 0.18;
    if (Math.hypot(dx, dy) < deadZone) return "";

    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "ArrowRight" : "ArrowLeft";
    }

    return dy > 0 ? "ArrowDown" : "ArrowUp";
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function boardBounds() {
    const rect = board.getBoundingClientRect();
    const half = Math.max(46, joystick.offsetWidth * 0.5 || 56);

    return {
      left: rect.left + half,
      right: rect.right - half,
      top: rect.top + half,
      bottom: rect.bottom - half
    };
  }

  function setJoystickCentre(x, y) {
    const bounds = boardBounds();
    pointer.baseX = clamp(x, bounds.left, Math.max(bounds.left, bounds.right));
    pointer.baseY = clamp(y, bounds.top, Math.max(bounds.top, bounds.bottom));

    joystick.style.setProperty("--joystick-x", `${pointer.baseX}px`);
    joystick.style.setProperty("--joystick-y", `${pointer.baseY}px`);
  }

  function setStickPosition(dx, dy) {
    const rect = joystickBase.getBoundingClientRect();
    const maxTravel = Math.max(24, rect.width * 0.27);
    const length = Math.hypot(dx, dy);
    const scale = length > maxTravel ? maxTravel / length : 1;

    joystick.style.setProperty("--stick-x", `${dx * scale}px`);
    joystick.style.setProperty("--stick-y", `${dy * scale}px`);
  }

  function updateDynamicJoystick(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;

    let dx = event.clientX - pointer.baseX;
    let dy = event.clientY - pointer.baseY;
    const length = Math.hypot(dx, dy);
    const followRadius = Math.max(52, joystickBase.offsetWidth * 0.58);

    /*
     * A floating joystick should not leave the thumb stranded at the edge.
     * Once the drag exceeds the follow radius, the base glides after the
     * finger while preserving the movement direction.
     */
    if (length > followRadius) {
      const excess = length - followRadius;
      setJoystickCentre(
        pointer.baseX + (dx / length) * excess,
        pointer.baseY + (dy / length) * excess
      );
      dx = event.clientX - pointer.baseX;
      dy = event.clientY - pointer.baseY;
    }

    setStickPosition(dx, dy);

    const code = resolveDirection(
      dx,
      dy,
      Math.max(50, joystickBase.offsetWidth * 0.5)
    );

    if (code && code !== pointer.lastCode) {
      pointer.lastCode = code;
      dispatchDirection(code);
    }
  }

  function resetDynamicJoystick() {
    pointer.active = false;
    pointer.id = null;
    pointer.lastCode = "";
    joystick.classList.remove("is-visible", "is-active");
    joystick.setAttribute("aria-hidden", "true");
    joystick.style.setProperty("--stick-x", "0px");
    joystick.style.setProperty("--stick-y", "0px");
  }

  function isProtectedTouchTarget(target) {
    if (!(target instanceof Element)) return false;

    return Boolean(
      target.closest(
        [
          "button",
          "a",
          "input",
          "select",
          "textarea",
          "[contenteditable='true']",
          ".game-overlay",
          ".powerup-hud",
          ".coop-team-hud",
          ".network-latency",
          ".season-status",
          ".mobile-control-picker"
        ].join(",")
      )
    );
  }

  function beginDynamicJoystick(event) {
    if (
      controlMode !== "joystick" ||
      !isMobileControlsActive() ||
      pointer.active ||
      isProtectedTouchTarget(event.target)
    ) {
      return;
    }

    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;

    event.preventDefault();
    event.stopPropagation();

    pointer.active = true;
    pointer.id = event.pointerId;
    pointer.lastCode = "";

    setJoystickCentre(event.clientX, event.clientY);
    joystick.style.setProperty("--stick-x", "0px");
    joystick.style.setProperty("--stick-y", "0px");
    joystick.classList.add("is-visible", "is-active");
    joystick.setAttribute("aria-hidden", "false");

    board.setPointerCapture?.(event.pointerId);
  }

  function moveDynamicJoystick(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    event.preventDefault();
    event.stopPropagation();
    updateDynamicJoystick(event);
  }

  function finishDynamicJoystick(event) {
    if (!pointer.active || event.pointerId !== pointer.id) return;
    event.preventDefault();
    event.stopPropagation();
    board.releasePointerCapture?.(event.pointerId);
    resetDynamicJoystick();
  }

  function setPickerOpen(open) {
    const next = Boolean(open);
    picker.classList.toggle("is-open", next);
    pickerTrigger.setAttribute("aria-expanded", String(next));
    pickerMenu.hidden = !next;
  }

  function showModeHint() {
    window.clearTimeout(hintTimer);
    controls.classList.add("show-control-hint");
    hintTimer = window.setTimeout(() => {
      controls.classList.remove("show-control-hint");
    }, 1900);
  }

  function applyControlMode(mode, options = {}) {
    const nextMode = VALID_MODES.has(mode) ? mode : DEFAULT_MODE;
    controlMode = nextMode;

    resetDynamicJoystick();
    gameShell.dataset.controlMode = nextMode;
    controls.dataset.mode = nextMode;
    pickerCurrent.textContent = MODE_LABELS[nextMode];

    choiceButtons.forEach((button) => {
      const selected = button.dataset.controlChoice === nextMode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });

    setPickerOpen(false);

    if (options.persist !== false) saveControlMode(nextMode);
    if (options.announce !== false && isMobileControlsActive()) showModeHint();

    document.dispatchEvent(
      new CustomEvent("pacman:mobile-control-mode-changed", {
        detail: { mode: nextMode }
      })
    );
  }

  pickerTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPickerOpen(pickerMenu.hidden);
  });

  choiceButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      applyControlMode(button.dataset.controlChoice);
      if (navigator.vibrate) navigator.vibrate(12);
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) setPickerOpen(false);
  });

  /* Capture phase prevents the original canvas swipe listener firing in joystick mode. */
  board.addEventListener("pointerdown", beginDynamicJoystick, {
    capture: true,
    passive: false
  });
  board.addEventListener("pointermove", moveDynamicJoystick, {
    capture: true,
    passive: false
  });
  board.addEventListener("pointerup", finishDynamicJoystick, {
    capture: true,
    passive: false
  });
  board.addEventListener("pointercancel", finishDynamicJoystick, {
    capture: true,
    passive: false
  });
  board.addEventListener("lostpointercapture", resetDynamicJoystick);

  arrowButtons.forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (controlMode !== "arrows" || !isMobileControlsActive()) return;
      event.preventDefault();
      event.stopPropagation();
      button.classList.add("is-pressed");
      dispatchDirection(button.dataset.directionCode);
    });

    const release = () => button.classList.remove("is-pressed");
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });

  function refreshVisibility() {
    if (!isMobileControlsActive()) {
      resetDynamicJoystick();
      setPickerOpen(false);
    }
  }

  window.addEventListener("resize", refreshVisibility, { passive: true });
  window.addEventListener("orientationchange", () => {
    resetDynamicJoystick();
    setPickerOpen(false);
  }, { passive: true });

  mobileMedia.addEventListener?.("change", refreshVisibility);

  const visibilityObserver = new MutationObserver(refreshVisibility);
  visibilityObserver.observe(gameShell, {
    attributes: true,
    attributeFilter: ["aria-hidden"]
  });

  document.addEventListener("pacman:room-started", () => {
    refreshVisibility();
    showModeHint();
  });
  document.addEventListener("pacman:room-left", resetDynamicJoystick);
  document.addEventListener("pacman:room-closed", resetDynamicJoystick);

  applyControlMode(controlMode, {
    persist: false,
    announce: false
  });
})();
