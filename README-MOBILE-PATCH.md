# P.A.C v7.2 Mobile Patch

GitHub allowed read access but rejected the direct write, so this ZIP contains the exact patch.

## 1. Add these two files

- `css/mobile.css`
- `js/mobile-viewport.js`

## 2. Edit `index.html`

In `<head>`, find:

```html
<link rel="stylesheet" href="css/styles.css">
```

Replace it with:

```html
<link rel="stylesheet" href="css/styles.css">
<link rel="stylesheet" href="css/mobile.css">
```

Near the bottom, find:

```html
<script src="js/lobby.js"></script>
```

Replace it with:

```html
<script src="js/lobby.js"></script>
<script src="js/mobile-viewport.js"></script>
```

## Result

- Lobby scales to the actual mobile viewport.
- Oversized minimum canvas height is overridden.
- In-game view becomes a fixed three-row layout:
  1. compact HUD
  2. flexible centred game canvas
  3. compact control row
- No page scrolling is needed during gameplay.
- Portrait and landscape phone layouts are handled separately.
- Safe-area padding is included for phones with notches.
- Inputs remain at 16px to prevent iPhone focus zoom.
