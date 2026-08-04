(function () {
  "use strict";

  class RemotePlayerAvatar {
    constructor(member, startTile) {
      this.userId = member.user_id;
      this.playerSlot = Number(member.player_slot) || 1;
      this.accountName =
        member.profile?.account_name ||
        member.profile?.display_name ||
        `Player ${this.playerSlot}`;
      this.pacman = new window.Pacman(startTile);
      this.targetX = startTile.x;
      this.targetY = startTile.y;
      this.targetAngle = 0;
      this.lastSequence = -1;
      this.hasNetworkState = false;
      this.alive = true;
      this.score = 0;
      this.skinState = null;
      this.nearMissState = null;
    }

    updateMember(member) {
      this.playerSlot = Number(member.player_slot) || this.playerSlot;
      this.accountName =
        member.profile?.account_name ||
        member.profile?.display_name ||
        this.accountName;
    }

    applyNetworkState(payload) {
      const sequence = Number(payload.sequence);
      if (Number.isFinite(sequence) && sequence <= this.lastSequence) return;
      if (Number.isFinite(sequence)) this.lastSequence = sequence;

      const x = Number(payload.x);
      const y = Number(payload.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;

      this.targetX = x;
      this.targetY = y;
      this.targetAngle = Number.isFinite(Number(payload.angle))
        ? Number(payload.angle)
        : this.targetAngle;

      this.pacman.dir = {
        x: Number(payload.dirX) || 0,
        y: Number(payload.dirY) || 0
      };

      if (payload.skin && typeof payload.skin === "object") {
        this.skinState = payload.skin;
      }

      if (payload.nearMiss && typeof payload.nearMiss === "object") {
        this.nearMissState = payload.nearMiss;
        window.PacmanNearMiss?.observeNetworkState?.(
          this.userId,
          this.nearMissState
        );
      }

      if (
        !this.hasNetworkState ||
        Math.hypot(this.pacman.x - x, this.pacman.y - y) > 3
      ) {
        this.pacman.x = x;
        this.pacman.y = y;
      }

      this.hasNetworkState = true;
    }

    applyWorldState(playerState) {
      if (!playerState) return;

      this.alive = playerState.alive !== false;
      this.score = Math.max(0, Number(playerState.score) || 0);

      if (playerState.skin && typeof playerState.skin === "object") {
        this.skinState = playerState.skin;
      }

      if (playerState.nearMiss && typeof playerState.nearMiss === "object") {
        this.nearMissState = playerState.nearMiss;
        window.PacmanNearMiss?.observeNetworkState?.(
          this.userId,
          this.nearMissState
        );
      }

      /*
       * World snapshots provide a starting position for newly discovered
       * players. Once direct player-state updates are arriving, do not let an
       * older world snapshot overwrite the live movement target.
       */
      if (this.hasNetworkState) return;

      const x = Number(playerState.x);
      const y = Number(playerState.y);

      if (Number.isFinite(x) && Number.isFinite(y)) {
        this.targetX = x;
        this.targetY = y;
        this.pacman.x = x;
        this.pacman.y = y;
      }

      this.targetAngle = Number.isFinite(Number(playerState.angle))
        ? Number(playerState.angle)
        : this.targetAngle;

      this.pacman.dir = {
        x: Number(playerState.dirX) || 0,
        y: Number(playerState.dirY) || 0
      };

      this.hasNetworkState = true;
    }

    setPosition(tile) {
      if (!tile) return;
      this.pacman.x = Number(tile.x) || 0;
      this.pacman.y = Number(tile.y) || 0;
      this.targetX = this.pacman.x;
      this.targetY = this.pacman.y;
      this.hasNetworkState = true;
    }

    update(dt) {
      const distance = Math.hypot(
        this.targetX - this.pacman.x,
        this.targetY - this.pacman.y
      );
      const smoothing = 1 - Math.exp(-15 * dt);

      if (distance > 2.5) {
        this.pacman.x = this.targetX;
        this.pacman.y = this.targetY;
      } else {
        this.pacman.x += (this.targetX - this.pacman.x) * smoothing;
        this.pacman.y += (this.targetY - this.pacman.y) * smoothing;
      }

      let angleDelta = this.targetAngle - this.pacman.angle;
      while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
      while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
      this.pacman.angle += angleDelta * smoothing;

      if (
        this.pacman.dir.x !== 0 ||
        this.pacman.dir.y !== 0 ||
        distance > 0.01
      ) {
        this.pacman.movingTime += dt;
      }
    }

    toActor() {
      return {
        userId: this.userId,
        playerSlot: this.playerSlot,
        x: this.pacman.x,
        y: this.pacman.y,
        dir: { ...this.pacman.dir },
        angle: this.pacman.angle,
        radius: this.pacman.radius,
        alive: this.alive,
        score: this.score,
        skin: this.skinState,
        nearMiss:
          window.PacmanNearMiss?.getNetworkStateForUser?.(
            this.userId,
            this.nearMissState
          ) || this.nearMissState
      };
    }

    draw(ctx, viewport) {
      if (!this.alive) return;

      this.pacman.draw(ctx, viewport, {
        variant: "remote",
        label: this.accountName,
        accountName: this.accountName,
        userId: this.userId,
        skin: this.skinState,
        nearMiss: this.nearMissState
      });
    }
  }

  class RemotePlayerManager {
    constructor(map, currentUserId = null) {
      this.map = map;
      this.currentUserId = currentUserId;
      this.players = new Map();
    }

    reset(map, currentUserId) {
      this.map = map;
      this.currentUserId = currentUserId;
      this.players.clear();
    }

    setRoster(members = []) {
      const activeIds = new Set();

      members.forEach((member) => {
        if (!member?.user_id || member.user_id === this.currentUserId) return;
        activeIds.add(member.user_id);

        const existing = this.players.get(member.user_id);
        if (existing) {
          existing.updateMember(member);
          return;
        }

        const startTile = this.map.getPlayerStartTile(member.player_slot);
        this.players.set(
          member.user_id,
          new RemotePlayerAvatar(member, startTile)
        );
      });

      this.players.forEach((_player, userId) => {
        if (!activeIds.has(userId)) this.players.delete(userId);
      });
    }

    applyNetworkState(payload) {
      if (!payload?.userId || payload.userId === this.currentUserId) return;

      let remote = this.players.get(payload.userId);
      if (!remote) {
        const member = {
          user_id: payload.userId,
          player_slot: payload.playerSlot || 1,
          profile: {
            account_name:
              payload.accountName || `Player ${payload.playerSlot || ""}`
          }
        };
        remote = new RemotePlayerAvatar(
          member,
          this.map.getPlayerStartTile(member.player_slot)
        );
        this.players.set(payload.userId, remote);
      }

      remote.applyNetworkState(payload);
    }

    applyWorldPlayers(playerStates = []) {
      (Array.isArray(playerStates) ? playerStates : []).forEach((playerState) => {
        if (!playerState?.userId || playerState.userId === this.currentUserId) {
          return;
        }

        let remote = this.players.get(playerState.userId);
        if (!remote) {
          const member = {
            user_id: playerState.userId,
            player_slot: playerState.playerSlot || 1,
            profile: {
              account_name:
                playerState.accountName ||
                `Player ${playerState.playerSlot || ""}`
            }
          };
          remote = new RemotePlayerAvatar(
            member,
            this.map.getPlayerStartTile(member.player_slot)
          );
          this.players.set(playerState.userId, remote);
        }

        remote.applyWorldState(playerState);
      });
    }

    setAlive(userId, alive) {
      const remote = this.players.get(userId);
      if (remote) remote.alive = Boolean(alive);
    }

    setPosition(userId, tile) {
      this.players.get(userId)?.setPosition(tile);
    }

    getPlayerByUserId(userId) {
      return this.players.get(userId) || null;
    }

    getPlayerActors() {
      return Array.from(this.players.values(), (player) => player.toActor());
    }

    update(dt) {
      this.players.forEach((player) => player.update(dt));
    }

    draw(ctx, viewport) {
      this.players.forEach((player) => player.draw(ctx, viewport));
    }

    get count() {
      return this.players.size;
    }
  }

  window.RemotePlayerManager = RemotePlayerManager;
})();
