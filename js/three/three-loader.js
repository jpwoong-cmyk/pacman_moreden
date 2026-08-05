import("./three-engine.js").catch((error) => {
  console.error("P.A.C Three.js module could not be loaded.", error);

  const button = document.getElementById("graphicsModeButton");
  if (button) {
    button.textContent = "Graphics: 2D";
    button.setAttribute("aria-pressed", "false");
    button.disabled = true;
    button.title = "Three.js could not load. The original Canvas renderer is still active.";
  }

  document
    .querySelector("#gameShell .board-wrap")
    ?.classList.remove("is-three-ready");
});
