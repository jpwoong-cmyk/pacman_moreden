(function () {
  "use strict";

  let activeChannel = null;
  let subscribed = false;

  async function unsubscribe() {
    subscribed = false;
    if (!activeChannel || !window.pacmanSupabase) return;
    await window.pacmanSupabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  async function subscribe(roomId, handlers = {}) {
    await unsubscribe();

    const channel = window.pacmanSupabase
      .channel(`game:${roomId}`, {
        config: {
          broadcast: {
            self: false,
            ack: false
          }
        }
      })
      .on(
        "broadcast",
        { event: "player-state" },
        (message) => handlers.onPlayerState?.(message?.payload || message)
      )
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
        subscribed = status === "SUBSCRIBED";
        handlers.onStatus?.(status, error || null);
      });

    activeChannel = channel;
    return channel;
  }

  function sendPlayerState(payload) {
    if (!activeChannel || !subscribed) return false;

    void activeChannel.send({
      type: "broadcast",
      event: "player-state",
      payload
    });

    return true;
  }

  window.PacmanRoomRealtime = Object.freeze({
    subscribe,
    unsubscribe,
    sendPlayerState,
    isSubscribed: () => subscribed
  });
})();
