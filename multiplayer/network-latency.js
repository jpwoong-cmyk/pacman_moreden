(function () {
  "use strict";

  const PING_INTERVAL_MS = 3_000;
  const FIRST_PING_DELAY_MS = 400;

  const meter = document.getElementById("latencyValue");

  let activeChannel = null;
  let activeRoomId = null;
  let activeUserId = null;
  let pingTimer = null;
  let firstPingTimer = null;
  let measuring = false;

  function setMeter(value = null, quality = "idle") {
    if (!meter) return;

    if (Number.isFinite(value)) {
      const rounded = Math.max(0, Math.round(value));
      meter.textContent = `${rounded} ms`;
      meter.title = `Realtime connection latency: ${rounded} milliseconds`;
    } else {
      meter.textContent = "-- ms";
      meter.title = "Realtime connection latency unavailable";
    }

    meter.dataset.quality = quality;
  }

  function qualityFor(latency) {
    if (latency <= 100) return "good";
    if (latency <= 200) return "fair";
    return "poor";
  }

  function clearTimers() {
    if (pingTimer) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }

    if (firstPingTimer) {
      window.clearTimeout(firstPingTimer);
      firstPingTimer = null;
    }
  }

  async function measureLatency() {
    const channel = activeChannel;

    if (!channel || measuring || document.hidden) return;

    measuring = true;
    const startedAt = performance.now();

    try {
      const result = await channel.send({
        type: "broadcast",
        event: "latency-probe",
        payload: { sentAt: Date.now() }
      });

      if (channel !== activeChannel) return;

      if (result === "ok") {
        const latency = performance.now() - startedAt;
        setMeter(latency, qualityFor(latency));
      } else {
        setMeter(null, "poor");
      }
    } catch (_error) {
      if (channel === activeChannel) {
        setMeter(null, "poor");
      }
    } finally {
      measuring = false;
    }
  }

  async function stop() {
    clearTimers();
    measuring = false;
    activeRoomId = null;
    activeUserId = null;
    setMeter(null, "idle");

    if (!activeChannel || !window.pacmanSupabase) {
      activeChannel = null;
      return;
    }

    const channel = activeChannel;
    activeChannel = null;

    try {
      await window.pacmanSupabase.removeChannel(channel);
    } catch (_error) {
      // The main room channel handles the visible connection status.
    }
  }

  async function start(roomId, userId) {
    if (!meter || !window.pacmanSupabase || !roomId || !userId) return;

    if (
      activeChannel &&
      activeRoomId === roomId &&
      activeUserId === userId
    ) {
      return;
    }

    await stop();

    activeRoomId = roomId;
    activeUserId = userId;
    setMeter(null, "measuring");

    const probeId =
      window.crypto?.randomUUID?.() ||
      Math.random().toString(36).slice(2);

    const channel = window.pacmanSupabase.channel(
      `latency:${roomId}:${probeId}`,
      {
        config: {
          broadcast: {
            self: false,
            ack: true
          }
        }
      }
    );

    activeChannel = channel;

    channel.subscribe((status) => {
      if (channel !== activeChannel) return;

      if (status === "SUBSCRIBED") {
        clearTimers();
        firstPingTimer = window.setTimeout(
          () => void measureLatency(),
          FIRST_PING_DELAY_MS
        );
        pingTimer = window.setInterval(
          () => void measureLatency(),
          PING_INTERVAL_MS
        );
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        setMeter(null, "poor");
      }
    });
  }

  function startFromRoomDetail(detail = {}) {
    const room = detail.room;
    const userId = detail.currentUserId;

    if (room?.status === "playing" && room.id && userId) {
      void start(room.id, userId);
    }
  }

  document.addEventListener("pacman:room-started", (event) => {
    startFromRoomDetail(event.detail);
  });

  document.addEventListener("pacman:room-updated", (event) => {
    startFromRoomDetail(event.detail);
  });

  document.addEventListener("pacman:room-left", () => {
    void stop();
  });

  document.addEventListener("pacman:room-closed", () => {
    void stop();
  });

  document.addEventListener("pacman:auth-changed", (event) => {
    if (!event.detail?.user) void stop();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void measureLatency();
  });

  window.PacmanNetworkLatency = Object.freeze({
    measure: measureLatency,
    stop,
    getRoomId: () => activeRoomId
  });
})();
