# Elemental Pacman v4.0

A framework-free scrolling Pacman game built with HTML, CSS, JavaScript, and Canvas.

## Run

Extract the folder and open `index.html` in a modern browser. No package installation, build command, server, or internet connection is required.

## Controls

- Arrow keys or WASD: move
- Space: pause or resume
- Touch D-pad: mobile and tablet movement
- New City: generate a new procedural city
- View: switch between depth and flat rendering

## Files

- `index.html` - main shell, HUD, controls, and canvas
- `css/styles.css` - full-width responsive interface
- `js/main.js` - game loop, camera, input, timed spawning, score, pause, and restart
- `js/map.js` - procedural city, collision map, surface generation, realistic storefront rendering, lot props, and scenery rendering
- `js/creeps.js` - elemental creep roaming, four-tile sensing, rare shadow creep spawning, pursuit, pellet-eating elites, collision, and rendering
- `js/pellets.js` - pellet spawning, visibility culling, swirling animation, collection, and creep pellet removal support
- `js/pacman.js` - Pacman movement, buffered turning, face, and mouth animation

## v4.0 Changes

- Removed all zebra crossings from the city surface generation.
- Added a 5% chance per creep wave to spawn one black shadow creep.
- Shadow creeps randomly gain one special trait:
  - Faster movement speed
  - Larger detection radius
  - Ability to eat pellets
- Shops, stalls, buildings, and malls now look more lively with stronger signboards, lit fronts, decorative billboards, and lamppost props.
- Added a new mall-style obstacle type so the city reads less like repeating boxes and more like a real commercial district.

## Existing Rules

- The map is 65 by 49 tiles and scrolls while Pacman remains centered.
- Every walkable tile has at least two exits and the full street network is connected.
- Five pellets spawn every 10 seconds, up to a performance cap of 110.
- Four elemental creeps spawn from the city corners every 10 seconds, up to a performance cap of 24.
