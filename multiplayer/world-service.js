(function () {
  "use strict";

  function client() {
    if (!window.pacmanSupabase) {
      throw new Error("Supabase client is unavailable.");
    }

    return window.pacmanSupabase;
  }

  function firstRow(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }

  async function loadWorld(roomId) {
    if (!roomId) return null;

    const { data, error } = await client().rpc("get_room_world_state", {
      p_room_id: roomId
    });

    if (error) {
      throw new Error(`Unable to load the shared world: ${error.message}`);
    }

    return firstRow(data);
  }

  async function saveWorld(roomId, version, snapshot) {
    if (!roomId) return null;

    const { data, error } = await client().rpc("save_room_world_state", {
      p_room_id: roomId,
      p_version: Math.max(0, Math.floor(Number(version) || 0)),
      p_snapshot: snapshot || {}
    });

    if (error) {
      throw new Error(`Unable to save the shared world: ${error.message}`);
    }

    return firstRow(data);
  }

  window.PacmanWorldService = Object.freeze({
    loadWorld,
    saveWorld
  });
})();
