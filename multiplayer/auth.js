(function () {
  "use strict";

  const ACCOUNT_PATTERN = /^[a-z0-9_]{3,20}$/;
  const INTERNAL_AUTH_DOMAIN = "pacman.invalid";

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
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  function validateAccountName(value) {
    const accountName = normaliseAccountName(value);

    if (!ACCOUNT_PATTERN.test(accountName)) {
      throw new Error(
        "Account name must contain 3 to 20 lowercase letters, numbers, or underscores."
      );
    }

    return accountName;
  }

  function accountNameToInternalEmail(accountName) {
    return `${validateAccountName(accountName)}@${INTERNAL_AUTH_DOMAIN}`;
  }

  async function signUp({ accountName, password }) {
    const cleanAccountName = validateAccountName(accountName);
    const cleanPassword = String(password || "");

    if (cleanPassword.length < 8) {
      throw new Error("Password must contain at least 8 characters.");
    }

    const { data, error } = await client().auth.signUp({
      email: accountNameToInternalEmail(cleanAccountName),
      password: cleanPassword,
      options: {
        data: {
          account_name: cleanAccountName,
          display_name: cleanAccountName,
          game: "elemental-pacman"
        }
      }
    });

    if (error) {
      const message = String(error.message || "");
      if (/already|registered|exists/i.test(message)) {
        throw new Error("That account name is already taken.");
      }
      throw new Error(message || "Unable to create the account.");
    }

    if (!data.user) {
      throw new Error("Supabase did not return the new account.");
    }

    if (!data.session) {
      throw new Error(
        "Account created without a login session. Disable Confirm Email in Supabase Authentication settings, then create the account again."
      );
    }

    return {
      user: data.user,
      session: data.session
    };
  }

  async function signIn({ accountName, password }) {
    const cleanAccountName = validateAccountName(accountName);

    const { data, error } = await client().auth.signInWithPassword({
      email: accountNameToInternalEmail(cleanAccountName),
      password: String(password || "")
    });

    if (error) {
      throw new Error("Unable to log in. Check the account name and password.");
    }

    return data;
  }

  async function signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw new Error(error.message);
  }

  async function getSession() {
    const { data, error } = await client().auth.getSession();
    if (error) throw new Error(error.message);
    return data.session || null;
  }

  async function getProfile(userId) {
    const { data, error } = await client()
      .from("profiles")
      .select(
        "id, account_name, display_name, avatar_key, total_score, games_played, games_won, pellets_collected"
      )
      .eq("id", userId)
      .single();

    if (error) {
      throw new Error(`Unable to load player profile: ${error.message}`);
    }

    return data;
  }

  function onAuthStateChange(callback) {
    return client().auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => callback(event, session), 0);
    });
  }

  window.PacmanAuth = Object.freeze({
    normaliseAccountName,
    signUp,
    signIn,
    signOut,
    getSession,
    getProfile,
    onAuthStateChange
  });
})();
