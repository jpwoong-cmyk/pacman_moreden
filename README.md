# P.A.C v7.2.2 Lobby Creep Alignment Fix

Replace these two files in GitHub:

- `css/mobile.css`
- `js/lobby-creeps.js`

No `index.html` change is needed.

## Why it was out of place

The base stylesheet still set the mobile creep canvas to 108px high, while the
mobile card had already been reduced. The JavaScript also clamped its drawing
height to at least 92px.

The replacement:

- gives the creep track an explicit responsive width and height;
- makes the canvas exactly fill that track;
- observes the real rendered stage size;
- calculates creep size from both available width and height;
- keeps the whole creep group vertically centred;
- preserves the left-to-right patrol movement.
