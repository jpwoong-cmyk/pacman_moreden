(function () {
  "use strict";

  const config = window.PACMAN_SUPABASE_CONFIG;

  function isPlaceholder(value) {
    return !value || String(value).includes("PASTE_YOUR_");
  }

  if (!config) {
    throw new Error("PACMAN_SUPABASE_CONFIG is missing. Load config.js first.");
  }

  if (isPlaceholder(config.url) || isPlaceholder(config.publishableKey)) {
    window.PACMAN_SUPABASE_CONFIGURATION_ERROR =
      "Open multiplayer/config.js and paste your Supabase Project URL and Publishable key.";
    return;
  }

  if (!window.supabase?.createClient) {
    window.PACMAN_SUPABASE_CONFIGURATION_ERROR =
      "The Supabase JavaScript library did not load. Check the CDN script in index.html.";
    return;
  }

  window.pacmanSupabase = window.supabase.createClient(
    config.url,
    config.publishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    }
  );
})();
