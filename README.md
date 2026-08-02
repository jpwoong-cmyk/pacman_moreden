# P.A.C v9.1 Shared Power-Ups and Personal Game Over

Built against the current `main` branch containing:

- the v8 host-authoritative shared world;
- shared creeps, pellets and scores;
- the Living City module;
- the mobile joystick.

## Add

- `css/powerups.css`
- `js/powerups.js`

## Replace

- `js/main.js`

## Edit

Follow `INDEX-CHANGES.txt`.

## Supabase

No new SQL is required. See `NO-SQL-CHANGE.txt`.

## Power-ups

### Red and white Shield pill

- one automatic ghost-collision shield per pill;
- charges stack without a hard cap;
- one charge is consumed on contact;
- grants 1.25 seconds of contact grace so overlapping ghosts do not remove
  several charges in one instant.

### Blue and white Rush pill

- increases Pacman speed by 25%;
- each pill adds 8 seconds;
- duration stacks instead of speed multiplying repeatedly.

### Black and white Hunter pill

- grants one ghost-eating charge;
- charges stack without a hard cap;
- touching any ghost consumes one charge;
- the ghost disappears for every player;
- the player receives 100 score;
- grants 0.85 seconds of contact grace after eating the ghost.

Collision order is:

1. Hunter charge;
2. Shield charge;
3. personal round ends.

## Shared spawning

- one red, one blue and one black pill spawn when a new city starts;
- one random pill attempts to spawn every 25 seconds;
- maximum six pills may exist on the map;
- pills do not spawn in the central start zone;
- pills avoid players, creeps, pellets, existing pills and corner spawn tiles.

## Pill rendering

The capsule is rendered in Canvas as a half-colour, half-white 3D pill with:

- moving light and dark gradients;
- a centre seam;
- a white specular highlight;
- slow rotation and hover;
- a glow matching its type.

Its capsule thickness is exactly one rendered pixel larger than the current
pellet diameter. The pill remains naturally longer than a round pellet: the
rendered radius is `tileSize * 0.085 + 0.5`.

## Personal game over

There is no automatic revival.

When a player is touched without a usable pill:

- only that player's round ends;
- other players and the shared city continue;
- the player's score appears inside a clockwise rotating 3D score box;
- `OK` requests a restart in the same active room;
- `Exit` leaves the room and returns to the lobby.

Restarting:

- places the player back at the centre start area;
- resets that player's round score to zero;
- clears that player's pill inventory and Rush timer;
- does not reset the map, pellets, ghosts, citizens, day/night cycle or other
  players.

A dead non-host player sends the restart request to the host through the existing
`player-state` Realtime channel, so no additional Realtime event type or SQL
function is needed.

## Testing checklist

1. Open one normal window and one Incognito window.
2. Join the same room with two accounts.
3. Confirm both players see the same three starting pills.
4. Collect a pill in one window and confirm it disappears in both.
5. Test Rush speed and stacked duration.
6. Test Shield with one and multiple charges.
7. Test Hunter and confirm the same ghost disappears for both players.
8. Die without protection and confirm the other player continues.
9. Press `OK` and confirm only the dead player restarts with score zero.
10. Die again and press `Exit` to confirm the room remains active for others.
11. Test the same flow when the host is the player who dies.
