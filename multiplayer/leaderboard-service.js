(function () {
  "use strict";

  const DEFAULT_LIMIT = 10;

  function client() {
    if (!window.pacmanSupabase) {
      throw new Error(
        window.PACMAN_SUPABASE_CONFIGURATION_ERROR ||
        "Supabase client is unavailable."
      );
    }
    return window.pacmanSupabase;
  }

  function formatScores(scores) {
    if (!Array.isArray(scores) || scores.length === 0) {
      return "HIGH SCORES · NO CITY RECORDS YET";
    }

    return scores
      .map((entry, index) => {
        const name = String(entry.account_name || entry.display_name || "player")
          .trim()
          .toUpperCase();
        const score = Math.max(0, Number(entry.high_score) || 0);
        return `#${index + 1} ${name} · ${score.toLocaleString()}`;
      })
      .join("     ◆     ");
  }

  function renderTicker(scores) {
    const track = document.getElementById("lobbyScoreTrack");
    if (!track) return;

    const message = `HIGH SCORES     ◆     ${formatScores(scores)}     ◆`;
    const groups = track.querySelectorAll(".lobby-score-group");

    groups.forEach((group) => {
      group.textContent = message;
    });
  }

  async function getHighScores(limit = DEFAULT_LIMIT) {
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || DEFAULT_LIMIT));
    const { data, error } = await client().rpc("get_pacman_high_scores", {
      p_limit: safeLimit
    });

    if (error) {
      throw new Error(error.message || "Unable to load high scores.");
    }

    return Array.isArray(data) ? data : [];
  }

  async function refreshTicker() {
    try {
      renderTicker(await getHighScores());
    } catch (_error) {
      renderTicker([]);
    }
  }

  async function submitScore(score) {
    const safeScore = Math.max(0, Math.floor(Number(score) || 0));
    const { data, error } = await client().rpc("submit_pacman_score", {
      p_score: safeScore
    });

    if (error) {
      throw new Error(error.message || "Unable to save score.");
    }

    document.dispatchEvent(new CustomEvent("pacman:score-submitted", {
      detail: { score: safeScore, highScore: Number(data) || safeScore }
    }));

    return Number(data) || safeScore;
  }

  window.PacmanLeaderboard = Object.freeze({
    getHighScores,
    refreshTicker,
    submitScore
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void refreshTicker(), { once: true });
  } else {
    void refreshTicker();
  }

  document.addEventListener("pacman:auth-changed", () => void refreshTicker());
  document.addEventListener("pacman:score-submitted", () => void refreshTicker());
})();
