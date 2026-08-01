(function () {
  "use strict";

  let activeChannel = null;

  async function unsubscribe() {
    if (!activeChannel || !window.pacmanSupabase) return;
    await window.pacmanSupabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  async function subscribe(roomId, handlers = {}) {
    await unsubscribe();

    const channel = window.pacmanSupabase
      .channel(`room-database:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`
        },
        () => handlers.onChange?.()
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`
        },
        () => handlers.onChange?.()
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_rooms",
          filter: `id=eq.${roomId}`
        },
        (payload) => handlers.onRoomUpdate?.(payload)
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "game_rooms",
          filter: `id=eq.${roomId}`
        },
        (payload) => handlers.onRoomUpdate?.(payload)
      )
      .subscribe((status, error) => {
        handlers.onStatus?.(status, error || null);
      });

    activeChannel = channel;
    return channel;
  }

  window.PacmanRoomRealtime = Object.freeze({
    subscribe,
    unsubscribe
  });
})();
