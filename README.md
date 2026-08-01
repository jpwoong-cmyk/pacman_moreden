# Elemental Pacman v5.0

A framework-free scrolling Pacman game built with HTML, CSS, JavaScript, and Canvas.

## Run

Extract the folder and open `index.html` in a modern browser. No package installation, build command, server, or internet connection is required.

## Controls

- Desktop: Arrow keys or WASD
- Mobile and tablet: swipe on the game canvas
  - Swipe up to move up
  - Swipe down to move down
  - Swipe left to move left
  - Swipe right to move right
- Space: pause or resume
- New City: generate another procedural city inside the current room
- View: switch between depth and flat rendering
- Leave Room: return to the pre-game lobby

## Pre-game Lobby

- `Create Game` generates a six-character room ID.
- `Join Game` accepts a six-character room ID.
- The room ID is shown in the game HUD and stored in the page URL while the room is active.
- Four elemental ghosts continuously patrol above the lobby actions.
- A CSS-drawn Pacman moves around the screen corners.

### Networking limitation

v5.0 remains a static browser build. The room ID currently works as a lobby and session key, but it does not synchronize players across different devices. True shared multiplayer would require a realtime backend such as WebSockets, Supabase Realtime, Firebase, or a small hosted room server.

## Files

- `index.html` - lobby, game shell, HUD, controls, overlays, and Canvas
- `css/styles.css` - lobby animation, responsive UI, mobile layout, and game styling
- `js/lobby.js` - room ID generation, join validation, lobby transitions, URL state, and leaving a room
- `js/main.js` - game loop, camera, desktop input, mobile swipe controls, room HUD, spawning, score, pause, and restart
- `js/map.js` - procedural city, collision map, roads, walkways, shops, malls, signs, lighting, and scenery
- `js/creeps.js` - elemental creeps, four-tile sensing, rare shadow creeps, pursuit, pellet eating, and collisions
- `js/pellets.js` - pellet spawning, collection, swirling animation, and shadow-creep consumption
- `js/pacman.js` - Pacman movement, buffered turns, face, and mouth animation

## v5.0 Changes

- Removed the mobile directional keypad.
- Added swipe gesture movement directly on the Canvas.
- Added a full-screen pre-game lobby.
- Added Create Game and Join Game flows using six-character IDs.
- Added gold, raised 3D lobby buttons.
- Added four continuously patrolling elemental ghost animations.
- Added an animated Pacman that travels between the screen corners.
- Added the active room ID to the in-game HUD.
- Added a Leave Room action to return to the lobby.

## Existing Rules

- The map is 65 by 49 tiles and scrolls while Pacman remains centered.
- Every walkable tile has at least two exits and the street network is connected.
- Five pellets spawn every 10 seconds, up to a performance cap of 110.
- Four elemental creeps spawn from the city corners every 10 seconds, up to a performance cap of 24.
- Each creep wave has a 5% chance to add one rare black shadow creep when capacity remains.
