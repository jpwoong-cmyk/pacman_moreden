(function () {
  "use strict";

  let activeChannel = null;
  let subscribed = false;

  async function unsubscribe() {
    subscribed = false;

    if (!activeChannel || !window.pacmanSupabase) {
      activeChannel = null;
      return;
    }

    await window.pacmanSupabase.removeChannel(activeChannel);
    activeChannel = null;
  }

  function unwrap(message) {
    return message?.payload || message || null;
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
        (message) => handlers.onPlayerState?.(unwrap(message))
      )
      .on(
        "broadcast",
        { event: "world-request" },
        (message) => handlers.onWorldRequest?.(unwrap(message))
      )
      .on(
        "broadcast",
        { event: "world-snapshot" },
        (message) => handlers.onWorldSnapshot?.(unwrap(message))
      )
      .on(
        "broadcast",
        { event: "world-frame" },
        (message) => handlers.onWorldFrame?.(unwrap(message))
      )
      .on(
        "broadcast",
        { event: "world-event" },
        (message) => handlers.onWorldEvent?.(unwrap(message))
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

  function send(event, payload) {
    if (!activeChannel || !subscribed) return false;

    void activeChannel.send({
      type: "broadcast",
      event,
      payload
    });

    return true;
  }

  function sendPlayerState(payload) {
    return send("player-state", payload);
  }

  function sendWorldRequest(payload) {
    return send("world-request", payload);
  }

  function sendWorldSnapshot(payload) {
    return send("world-snapshot", payload);
  }

  function sendWorldFrame(payload) {
    return send("world-frame", payload);
  }

  function sendWorldEvent(payload) {
    return send("world-event", payload);
  }

  window.PacmanRoomRealtime = Object.freeze({
    subscribe,
    unsubscribe,
    sendPlayerState,
    sendWorldRequest,
    sendWorldSnapshot,
    sendWorldFrame,
    sendWorldEvent,
    isSubscribed: () => subscribed
  });
})();
