# P.A.C v7.2.1 Mobile Width Fix

Your current repository contains `css/mobile.css` and `js/mobile-viewport.js`,
but `index.html` does not load them.

## Replace these files

- Replace `css/mobile.css`
- Replace `js/mobile-viewport.js`

## Edit index.html

Inside `<head>`, find:

```html
<link rel="stylesheet" href="css/styles.css">
```

Replace it with:

```html
<link rel="stylesheet" href="css/styles.css">
<link rel="stylesheet" href="css/mobile.css">
```

At the bottom, find:

```html
<script src="js/lobby.js"></script>
```

Replace it with:

```html
<script src="js/lobby.js"></script>
<script src="js/mobile-viewport.js"></script>
```

## Main correction

The previous mobile file used:

```css
width: min(100%, 680px);
```

The corrected phone rule uses:

```css
width: min(390px, calc(100vw - 28px));
```

This keeps the account lobby visibly centred with side margins.

The viewport script also no longer dispatches another `resize` event from within
its own resize handler.
