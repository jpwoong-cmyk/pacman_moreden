(function () {
  "use strict";

  const ELEMENT_UNLOCK_TARGET = 10;
  const VALID_ELEMENTS = ["fire", "water", "lightning", "earth"];

  const SCORE_TIERS = Object.freeze([
    { min: 0, name: "Dirt Yellow", light: "#e4ca68", mid: "#c3a33d", dark: "#745416", glow: "rgba(195, 163, 61, 0.46)" },
    { min: 100, name: "Soft Puffy Yellow", light: "#fff2ad", mid: "#f0d766", dark: "#b98f24", glow: "rgba(240, 215, 102, 0.52)" },
    { min: 200, name: "Polished Yellow", light: "#fff3a0", mid: "#e8c94b", dark: "#a97814", glow: "rgba(232, 201, 75, 0.56)" },
    { min: 300, name: "Yellow-Gold", light: "#fff080", mid: "#dfbd35", dark: "#956708", glow: "rgba(223, 189, 53, 0.58)" },
    { min: 400, name: "Soft Gold", light: "#ffeaa0", mid: "#dcb94c", dark: "#885c0a", glow: "rgba(220, 185, 76, 0.61)" },
    { min: 500, name: "Warm Gold", light: "#ffe481", mid: "#d7ab33", dark: "#805407", glow: "rgba(215, 171, 51, 0.64)" },
    { min: 600, name: "Bright Gold", light: "#fff08a", mid: "#eac52f", dark: "#956000", glow: "rgba(234, 197, 47, 0.67)" },
    { min: 700, name: "Glowing Gold", light: "#fff4a7", mid: "#f2ca28", dark: "#9c6300", glow: "rgba(242, 202, 40, 0.71)", sparkle: true },
    { min: 800, name: "Shining Gold", light: "#fff7bf", mid: "#f5d13e", dark: "#a46900", glow: "rgba(245, 209, 62, 0.74)", sparkle: true },
    { min: 900, name: "Brilliant Gold", light: "#fffbd7", mid: "#ffd946", dark: "#aa6d00", glow: "rgba(255, 217, 70, 0.77)", sparkle: true },
    { min: 1000, name: "Vibrant Gold", light: "#fff7a8", mid: "#ffd000", dark: "#aa6400", glow: "rgba(255, 208, 0, 0.82)", sparkle: true },
    { min: 1100, name: "Refined Gold", light: "#fff8b9", mid: "#ffd51c", dark: "#ac6500", glow: "rgba(255, 213, 28, 0.84)", sparkle: true },
    { min: 1200, name: "Rich Gold", light: "#fff9c8", mid: "#ffda28", dark: "#ae6600", glow: "rgba(255, 218, 40, 0.86)", sparkle: true },
    { min: 1300, name: "Sovereign Gold", light: "#fffbd7", mid: "#ffde31", dark: "#af6500", glow: "rgba(255, 222, 49, 0.88)", sparkle: true },
    { min: 1400, name: "Radiant Royal Gold", light: "#fffce2", mid: "#ffe33c", dark: "#b16700", glow: "rgba(255, 227, 60, 0.9)", sparkle: true },
    { min: 1500, name: "Imperial Gold", light: "#fffde8", mid: "#ffe64b", dark: "#b36a00", glow: "rgba(255, 230, 75, 0.92)", sparkle: true },
    { min: 1600, name: "Luminous Royal Gold", light: "#ffffef", mid: "#ffea5a", dark: "#b66d00", glow: "rgba(255, 234, 90, 0.94)", sparkle: true },
    { min: 1700, name: "Crown Gold", light: "#fffdf0", mid: "#ffde25", dark: "#9d5500", glow: "rgba(255, 222, 37, 0.96)", sparkle: true },
    { min: 1800, name: "Prestige Gold", light: "#ffffff", mid: "#ffe23a", dark: "#9b5100", glow: "rgba(255, 226, 58, 0.98)", sparkle: true },
    { min: 1900, name: "Majestic Gold", light: "#ffffff", mid: "#ffe74f", dark: "#934800", glow: "rgba(255, 231, 79, 1)", sparkle: true },
    { min: 2000, name: "Royal Metallic Vibrant Gold", light: "#ffffff", mid: "#ffd21a", dark: "#7d3900", glow: "rgba(255, 215, 43, 1)", sparkle: true, metallic: true }
  ]);

  const ELEMENT_ACCENTS = Object.freeze({
    fire: {
      name: "Fire Gold",
      accent: "#ff5b3a",
      accentLight: "#ffbd67",
      glow: "rgba(255, 74, 45, 0.88)",
      particle: "#ff9b45"
    },
    water: {
      name: "Water Gold",
      accent: "#42b8ff",
      accentLight: "#bcecff",
      glow: "rgba(66, 184, 255, 0.86)",
      particle: "#75d2ff"
    },
    lightning: {
      name: "Lightning Gold",
      accent: "#fff15a",
      accentLight: "#ffffff",
      glow: "rgba(255, 241, 90, 0.92)",
      particle: "#fff782"
    },
    earth: {
      name: "Earth Gold",
      accent: "#b77d45",
      accentLight: "#e2b57f",
      glow: "rgba(183, 125, 69, 0.84)",
      particle: "#c99662"
    }
  });

  const state = {
    userId: null,
    accountName: null,
    highScore: 0,
    leaderboardHighScore: 0,
    selectedElement: null,
    unlocked: {
      fire: false,
      water: false,
      lightning: false,
      earth: false
    },
    roundCounts: {
      fire: 0,
      water: 0,
      lightning: 0,
      earth: 0
    },
    leaderboardByAccount: new Map(),
    loadingToken: 0,
    unlockRequests: new Set(),
    lastPersistedTier: 0
  };

  function normaliseAccountName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function clampTierIndex(value) {
    return Math.max(0, Math.min(SCORE_TIERS.length - 1, Math.floor(Number(value) || 0)));
  }

  function tierIndexForScore(score) {
    const safeScore = Math.max(0, Math.floor(Number(score) || 0));
    let index = 0;

    for (let next = 1; next < SCORE_TIERS.length; next += 1) {
      if (safeScore < SCORE_TIERS[next].min) break;
      index = next;
    }

    return index;
  }

  function compactSkinToParts(value) {
    if (!value || typeof value !== "object") return null;

    const tierIndex = clampTierIndex(
      value.t ?? value.tier ?? value.scoreTier ?? value.tierIndex
    );
    const element = VALID_ELEMENTS.includes(value.e ?? value.element)
      ? value.e ?? value.element
      : null;

    return { tierIndex, element };
  }

  function buildSkin(tierIndex, element = null) {
    const safeTierIndex = clampTierIndex(tierIndex);
    const tier = SCORE_TIERS[safeTierIndex];
    const accent = VALID_ELEMENTS.includes(element)
      ? ELEMENT_ACCENTS[element]
      : null;

    return {
      tierIndex: safeTierIndex,
      scoreMinimum: tier.min,
      name: accent ? `${tier.name} · ${accent.name}` : tier.name,
      light: tier.light,
      mid: tier.mid,
      dark: tier.dark,
      glow: accent?.glow || tier.glow,
      sparkle: Boolean(tier.sparkle),
      metallic: Boolean(tier.metallic),
      element: accent ? element : null,
      accent: accent?.accent || null,
      accentLight: accent?.accentLight || null,
      particle: accent?.particle || null,
      labelColor: accent?.accentLight || tier.light
    };
  }

  function localStorageKey(accountName = state.accountName) {
    const clean = normaliseAccountName(accountName);
    return clean ? `pacman-high-score:${clean}` : null;
  }

  function readCachedHighScore(accountName = state.accountName) {
    const key = localStorageKey(accountName);
    if (!key) return 0;

    try {
      return Math.max(0, Math.floor(Number(window.localStorage.getItem(key)) || 0));
    } catch (_error) {
      return 0;
    }
  }

  function writeCachedHighScore(score, accountName = state.accountName) {
    const key = localStorageKey(accountName);
    if (!key) return;

    try {
      window.localStorage.setItem(
        key,
        String(Math.max(0, Math.floor(Number(score) || 0)))
      );
    } catch (_error) {
      // Storage is a convenience only. The leaderboard remains authoritative.
    }
  }

  function announceSkinChange(reason) {
    document.dispatchEvent(
      new CustomEvent("pacman:skin-changed", {
        detail: {
          reason,
          highScore: state.highScore,
          selectedElement: state.selectedElement,
          skin: getLocalSkin()
        }
      })
    );
  }

  function updateHighScore(score, reason = "score") {
    const next = Math.max(state.highScore, Math.floor(Number(score) || 0));
    if (next === state.highScore) return false;

    state.highScore = next;
    if (state.accountName) {
      state.leaderboardByAccount.set(state.accountName, next);
      writeCachedHighScore(next);
    }
    announceSkinChange(reason);
    return true;
  }

  async function loadLeaderboardScores() {
    if (!window.PacmanLeaderboard?.getHighScores) return;

    try {
      const entries = await window.PacmanLeaderboard.getHighScores(100);
      state.leaderboardByAccount.clear();

      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const accountName = normaliseAccountName(
          entry.account_name || entry.display_name
        );
        if (!accountName) return;

        state.leaderboardByAccount.set(
          accountName,
          Math.max(0, Math.floor(Number(entry.high_score) || 0))
        );
      });

      const leaderboardScore = state.accountName
        ? state.leaderboardByAccount.get(state.accountName) || 0
        : 0;
      state.leaderboardHighScore = Math.max(
        leaderboardScore,
        readCachedHighScore()
      );
      updateHighScore(state.leaderboardHighScore, "leaderboard-seed");
    } catch (_error) {
      state.leaderboardHighScore = readCachedHighScore();
      updateHighScore(state.leaderboardHighScore, "cache-seed");
    }
  }

  function firstRow(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  function applyMonthlyProfile(profile) {
    const row = firstRow(profile);
    if (!row) return;

    state.highScore = Math.max(0, Math.floor(Number(row.best_score) || 0));
    state.lastPersistedTier = tierIndexForScore(state.highScore);

    VALID_ELEMENTS.forEach((element) => {
      state.unlocked[element] = Boolean(row[`${element}_unlocked`]);
    });

    state.selectedElement = VALID_ELEMENTS.includes(row.selected_element)
      ? row.selected_element
      : null;

    announceSkinChange("monthly-profile");
  }

  async function loadMonthlyProfile(seedScore = state.leaderboardHighScore) {
    if (!state.userId || state.userId === "guest-player" || !window.pacmanSupabase) {
      return;
    }

    try {
      const { data, error } = await window.pacmanSupabase.rpc(
        "get_my_pacman_monthly_skin",
        { p_seed_score: Math.max(0, Math.floor(Number(seedScore) || 0)) }
      );
      if (error) throw error;
      applyMonthlyProfile(data);
    } catch (error) {
      console.warn(
        "P.A.C monthly skin profile is unavailable. Run PAC_MONTHLY_SKINS.sql in Supabase.",
        error
      );
    }
  }

  async function handleAuthChanged(detail = {}) {
    const token = ++state.loadingToken;
    const profile = detail.profile || null;

    state.userId = detail.user?.id || null;
    state.accountName = normaliseAccountName(
      profile?.account_name || profile?.display_name
    ) || null;
    state.highScore = 0;
    state.leaderboardHighScore = readCachedHighScore();
    state.selectedElement = null;
    state.unlocked = {
      fire: false,
      water: false,
      lightning: false,
      earth: false
    };
    startRound();

    await loadLeaderboardScores();
    await loadMonthlyProfile(state.leaderboardHighScore);

    if (token !== state.loadingToken) return;
    announceSkinChange("identity-loaded");
  }

  function getLocalSkin() {
    return buildSkin(tierIndexForScore(state.highScore), state.selectedElement);
  }

  function getLocalNetworkSkin() {
    return {
      v: 1,
      t: tierIndexForScore(state.highScore),
      e: state.selectedElement
    };
  }

  function getSkinForAccount(accountName) {
    const clean = normaliseAccountName(accountName);
    const score = clean ? state.leaderboardByAccount.get(clean) || 0 : 0;
    return buildSkin(tierIndexForScore(score));
  }

  function resolveDrawSkin(options = {}) {
    const compact = compactSkinToParts(options.skin);
    if (compact) return buildSkin(compact.tierIndex, compact.element);

    if (options.variant === "remote") {
      return getSkinForAccount(options.accountName || options.label);
    }

    return getLocalSkin();
  }

  function startRound() {
    VALID_ELEMENTS.forEach((element) => {
      state.roundCounts[element] = 0;
    });
  }

  function endRound() {
    startRound();
  }

  function previewRoundScore(score) {
    const previousTier = tierIndexForScore(state.highScore);
    const changed = updateHighScore(score, "round-score");
    if (!changed) return false;

    const nextTier = tierIndexForScore(state.highScore);
    if (nextTier > previousTier && nextTier > state.lastPersistedTier) {
      state.lastPersistedTier = nextTier;
      void persistMonthlyScore(state.highScore);
    }

    return true;
  }

  async function persistMonthlyScore(score) {
    if (
      !state.userId ||
      state.userId === "guest-player" ||
      !window.pacmanSupabase
    ) {
      return;
    }

    try {
      const { data, error } = await window.pacmanSupabase.rpc(
        "record_my_pacman_monthly_score",
        { p_score: Math.max(0, Math.floor(Number(score) || 0)) }
      );
      if (error) throw error;
      applyMonthlyProfile(data);
    } catch (error) {
      console.warn("Unable to save the monthly P.A.C skin score.", error);
    }
  }

  async function persistElementUnlock(element) {
    if (
      !state.userId ||
      state.userId === "guest-player" ||
      !window.pacmanSupabase ||
      state.unlockRequests.has(element)
    ) {
      return;
    }

    state.unlockRequests.add(element);

    try {
      const { data, error } = await window.pacmanSupabase.rpc(
        "unlock_my_pacman_element",
        { p_element: element }
      );
      if (error) throw error;
      applyMonthlyProfile(data);
    } catch (error) {
      console.warn("Unable to save the monthly elemental skin unlock.", error);
    } finally {
      state.unlockRequests.delete(element);
    }
  }

  function unlockElement(element) {
    if (!VALID_ELEMENTS.includes(element) || state.unlocked[element]) return;

    state.unlocked[element] = true;
    state.selectedElement = element;
    announceSkinChange("element-unlocked");

    document.dispatchEvent(
      new CustomEvent("pacman:element-skin-unlocked", {
        detail: {
          element,
          target: ELEMENT_UNLOCK_TARGET,
          skin: getLocalSkin()
        }
      })
    );

    void persistElementUnlock(element);
  }

  function recordElementGhost(userId, element) {
    if (!VALID_ELEMENTS.includes(element)) return false;
    if (!state.userId || userId !== state.userId) return false;

    state.roundCounts[element] = Math.min(
      ELEMENT_UNLOCK_TARGET,
      state.roundCounts[element] + 1
    );

    document.dispatchEvent(
      new CustomEvent("pacman:element-skin-progress", {
        detail: {
          element,
          count: state.roundCounts[element],
          target: ELEMENT_UNLOCK_TARGET
        }
      })
    );

    if (state.roundCounts[element] >= ELEMENT_UNLOCK_TARGET) {
      unlockElement(element);
    }

    return true;
  }

  document.addEventListener("pacman:auth-changed", (event) => {
    void handleAuthChanged(event.detail || {});
  });

  document.addEventListener("pacman:score-submitted", (event) => {
    const roundScore = Math.max(
      0,
      Math.floor(Number(event.detail?.score) || 0)
    );
    updateHighScore(roundScore, "monthly-score");
    void persistMonthlyScore(roundScore);
  });

  document.addEventListener("pacman:shared-world-event", (event) => {
    const worldEvent = event.detail?.event;
    if (worldEvent?.type !== "ghost-eaten") return;
    recordElementGhost(worldEvent.userId, worldEvent.element);
  });

  window.PacmanSkins = Object.freeze({
    SCORE_TIERS,
    ELEMENT_ACCENTS,
    ELEMENT_UNLOCK_TARGET,
    tierIndexForScore,
    buildSkin,
    resolveDrawSkin,
    getLocalSkin,
    getLocalNetworkSkin,
    getSkinForAccount,
    getRoundCounts: () => ({ ...state.roundCounts }),
    getUnlockedElements: () => ({ ...state.unlocked }),
    getSelectedElement: () => state.selectedElement,
    previewRoundScore,
    recordElementGhost,
    startRound,
    endRound,
    refresh: async () => {
      await loadLeaderboardScores();
      await loadMonthlyProfile(state.leaderboardHighScore);
      return getLocalSkin();
    }
  });
})();
