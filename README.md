# P.A.C v7.0 Multiplayer

A framework-free Canvas game with Supabase accounts, game rooms, shared seeded maps, and visible remote players.

## v7.0 changes

- Starting pellet count increased from 48 to 180.
- Pellet performance cap increased from 110 to 260.
- The lobby parade now renders the exact same elemental creep artwork used inside the game.
- The old lobby eyebrow is now a continuously moving high-score ticker with account names.
- Lobby branding changed from Elemental Pacman to **P.A.C**.
- The lobby title now includes a black shadow-creep emblem with red eyes and a gold/silver outline.
- High scores are stored in Supabase and refreshed after a game ends.
- `multiplayer/remote-players.js` is explicitly loaded before `main.js`, preventing the black-canvas startup error.

## Existing multiplayer features

- Account name + password sign-up and login
- Six-character game rooms
- Join-in-progress rooms
- Automatic host transfer
- Same deterministic city for every player in a room
- Gold local Pacman and silver-grey remote Pacmen
- Mobile swipe controls

## Supabase update

For an existing project, run:

`supabase/v7-leaderboard.sql`

For a fresh project, run the complete:

`supabase/setup.sql`

Then configure your Project URL and Publishable key inside:

`multiplayer/config.js`

## Run

Serve the folder through Vercel, GitHub Pages, or a local HTTP server. Avoid opening `index.html` directly through `file://`.
