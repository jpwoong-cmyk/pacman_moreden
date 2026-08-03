(function () {
  "use strict";

  const ROOM_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function client() {
    if (!window.pacmanSupabase) {
      throw new Error("Supabase client is unavailable.");
    }
    return window.pacmanSupabase;
  }

  function sanitiseRoomCode(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
  }

  function normaliseGameMode(value) {
    return String(value || "").toLowerCase() === "coop"
      ? "coop"
      : "versus";
  }

  function generateRoomCode() {
    const values = new Uint32Array(6);
    window.crypto.getRandomValues(values);
    return Array.from(
      values,
      (value) => ROOM_CHARACTERS[value % ROOM_CHARACTERS.length]
    ).join("");
  }

  function generateMapSeed() {
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    return Number(value[0]);
  }

  function firstRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  async function createRoom() {
    let lastError = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const roomCode = generateRoomCode();
      const { data, error } = await client().rpc("create_game_room", {
        p_code: roomCode,
        p_map_seed: generateMapSeed()
      });

      if (!error) return firstRow(data);
      lastError = error;

      if (error.code !== "23505") break;
    }

    throw new Error(lastError?.message || "Unable to create a game room.");
  }

  async function joinRoom(code) {
    const roomCode = sanitiseRoomCode(code);
    if (roomCode.length !== 6) {
      throw new Error("Enter a complete six-character room ID.");
    }

    const { data, error } = await client().rpc("join_game_room", {
      p_code: roomCode
    });

    if (error) throw new Error(error.message);
    return firstRow(data);
  }

  async function leaveRoom(roomId) {
    if (!roomId) return null;
    const { data, error } = await client().rpc("leave_game_room", {
      p_room_id: roomId
    });
    if (error) throw new Error(error.message);
    return firstRow(data);
  }

  async function heartbeatRoom(roomId) {
    if (!roomId) return null;
    const { data, error } = await client().rpc("heartbeat_game_room", {
      p_room_id: roomId
    });
    if (error) throw new Error(error.message);
    return firstRow(data);
  }

  async function startRoom(roomId) {
    const { data, error } = await client().rpc("start_game_room", {
      p_room_id: roomId
    });
    if (error) throw new Error(error.message);
    return firstRow(data);
  }

  async function setRoomGameMode(roomId, mode) {
    const { data, error } = await client().rpc("set_game_room_mode", {
      p_room_id: roomId,
      p_game_mode: normaliseGameMode(mode)
    });

    if (error) throw new Error(error.message);
    return firstRow(data);
  }

  async function getRoom(roomId) {
    let { data, error } = await client()
      .from("game_rooms")
      .select(
        "id, code, host_user_id, status, game_mode, map_seed, max_players, created_at, started_at, ended_at"
      )
      .eq("id", roomId)
      .single();

    const missingModeColumn = Boolean(
      error &&
      (error.code === "42703" ||
        error.code === "PGRST204" ||
        /game_mode|column/i.test(String(error.message || "")))
    );

    /*
     * Keep existing Versus rooms usable while the optional v10 SQL migration
     * is still waiting to be installed. Coop selection will explain the
     * missing upgrade when the host tries to enable it.
     */
    if (missingModeColumn) {
      const fallback = await client()
        .from("game_rooms")
        .select(
          "id, code, host_user_id, status, map_seed, max_players, created_at, started_at, ended_at"
        )
        .eq("id", roomId)
        .single();

      data = fallback.data
        ? { ...fallback.data, game_mode: "versus" }
        : null;
      error = fallback.error;
    }

    if (error) throw new Error(`Unable to load room: ${error.message}`);
    return data;
  }

  async function getPlayers(roomId) {
    const { data: members, error: memberError } = await client()
      .from("room_players")
      .select("room_id, user_id, player_slot, joined_at, last_seen_at")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true })
      .order("player_slot", { ascending: true });

    if (memberError) {
      throw new Error(`Unable to load room players: ${memberError.message}`);
    }

    if (!members?.length) return [];

    const userIds = members.map((member) => member.user_id);
    const { data: profiles, error: profileError } = await client()
      .from("profiles")
      .select("id, account_name, display_name, avatar_key")
      .in("id", userIds);

    if (profileError) {
      throw new Error(`Unable to load player names: ${profileError.message}`);
    }

    const profileById = new Map(
      (profiles || []).map((profile) => [profile.id, profile])
    );

    return members.map((member) => ({
      ...member,
      profile: profileById.get(member.user_id) || {
        account_name: `player_${member.player_slot}`,
        display_name: `player_${member.player_slot}`,
        avatar_key: "gold"
      }
    }));
  }

  window.PacmanRoomService = Object.freeze({
    sanitiseRoomCode,
    normaliseGameMode,
    createRoom,
    joinRoom,
    leaveRoom,
    heartbeatRoom,
    startRoom,
    setRoomGameMode,
    getRoom,
    getPlayers
  });
})();
