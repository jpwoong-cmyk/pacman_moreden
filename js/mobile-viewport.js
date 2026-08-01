(function () {
  "use strict";

  let resizeFrame = 0;

  function updateMobileViewport() {
    window.cancelAnimationFrame(resizeFrame);

    resizeFrame = window.requestAnimationFrame(() => {
      const height = Math.max(
        320,
        Math.round(window.visualViewport?.height || window.innerHeight || 720)
      );

      document.documentElement.style.setProperty(
        "--pac-app-height",
        `${height}px`
      );
    });
  }

  function centreGameViewport() {
    window.scrollTo(0, 0);
    updateMobileViewport();

    window.setTimeout(() => {
      window.scrollTo(0, 0);
      updateMobileViewport();
      document.getElementById("gameCanvas")?.focus({
        preventScroll: true
      });
    }, 80);
  }

  window.addEventListener("resize", updateMobileViewport, { passive: true });
  window.addEventListener("orientationchange", updateMobileViewport, {
    passive: true
  });

  window.visualViewport?.addEventListener("resize", updateMobileViewport, {
    passive: true
  });

  document.addEventListener("pacman:room-started", centreGameViewport);
  document.addEventListener("pacman:room-left", updateMobileViewport);
  document.addEventListener("pacman:room-closed", updateMobileViewport);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateMobileViewport, {
      once: true
    });
  } else {
    updateMobileViewport();
  }
})();
