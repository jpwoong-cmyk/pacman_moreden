(function () {
  "use strict";

  const DEFAULT_LIMIT = 10;
  const MAX_LOOKUP_LIMIT = 100;

  const state = {
    accountName: null,
    highScore: 0
  };

  function client() {
    if (!window.pacmanSupabase) {
      throw new Error(
        window.PACMAN_SUPABASE_CONFIGURATION_ERROR ||
        "Supabase client is unavailable."
      );
    }
    return window.pacmanSupabase;
  }

  function normaliseAccountName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function cacheKey(accountName = state.accountName) {
    const clean = normaliseAccountName(accountName);
    return clean ? `pacman-high-score:${clean}` : null;
  }

  function getCachedHighScore(accountName = state.accountName) {
    const key = cacheKey(accountName);
    if (!key) return 0;

    try {
      return Math.max(
        0,
        Math.floor(Number(window.localStorage.getItem(key)) || 0)
      );
    } catch (_error) {
      return 0;
    }
  }

  function cacheHighScore(score, accountName = state.accountName) {
    const safeScore = Math.max(0, Math.floor(Number(score) || 0));
    const key = cacheKey(accountName);
    if (!key) return safeScore;

    try {
      window.localStorage.setItem(key, String(safeScore));
    } catch (_error) {
      // Browser storage is optional. Supabase remains authoritative.
    }

    return safeScore;
  }

  function setIdentity(profile) {
    state.accountName = normaliseAccountName(
      profile?.account_name || profile?.display_name
    ) || null;
    state.highScore = getCachedHighScore();
  }

  function formatScores(scores) {
    if (!Array.isArray(scores) || scores.length === 0) {
      return "NO CITY RECORDS YET";
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

    const message = `IND HIGH SCORE     ◆     ${formatScores(scores)}     ◆`;
    const groups = track.querySelectorAll(".lobby-score-group");

    groups.forEach((group) => {
      group.textContent = message;
    });
  }

  async function getHighScores(limit = DEFAULT_LIMIT) {
    const safeLimit = Math.max(
      1,
      Math.min(MAX_LOOKUP_LIMIT, Number(limit) || DEFAULT_LIMIT)
    );
    const { data, error } = await client().rpc("get_pacman_high_scores", {
      p_limit: safeLimit
    });

    if (error) {
      throw new Error(error.message || "Unable to load high scores.");
    }

    const scores = Array.isArray(data) ? data : [];

    if (state.accountName) {
      const ownEntry = scores.find((entry) =>
        normaliseAccountName(entry.account_name || entry.display_name) ===
        state.accountName
      );

      if (ownEntry) {
        state.highScore = Math.max(
          state.highScore,
          Math.max(0, Math.floor(Number(ownEntry.high_score) || 0))
        );
        cacheHighScore(state.highScore);
      }
    }

    return scores;
  }

  async function refreshTicker() {
    try {
      renderTicker(await getHighScores(DEFAULT_LIMIT));
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

    const highScore = Math.max(
      safeScore,
      Math.max(0, Math.floor(Number(data) || 0))
    );
    state.highScore = Math.max(state.highScore, highScore);
    cacheHighScore(state.highScore);

    document.dispatchEvent(new CustomEvent("pacman:score-submitted", {
      detail: { score: safeScore, highScore: state.highScore }
    }));

    return state.highScore;
  }

  window.PacmanLeaderboard = Object.freeze({
    getHighScores,
    refreshTicker,
    submitScore,
    getKnownHighScore: () => state.highScore,
    getCachedHighScore
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void refreshTicker(), { once: true });
  } else {
    void refreshTicker();
  }

  document.addEventListener("pacman:auth-changed", (event) => {
    setIdentity(event.detail?.profile || null);
    void refreshTicker();
  });

  document.addEventListener("pacman:score-submitted", () => void refreshTicker());
})();
