# Simple Supabase Setup

This revision uses **account name + password only** in the game interface.

Supabase password authentication natively expects an email or phone identity. To keep the player interface username-only, the game converts an account such as `golden_j` into a hidden internal identifier such as `golden_j@pacman.invalid`. Players never enter or receive email.

Because that address is intentionally not a real inbox, **Confirm Email must remain disabled** for this version. Password-reset email is also unavailable until a recovery method is added later.

The starter now supports:

- permanent account-name/password accounts
- room creation and six-character game IDs
- joining before or after a match starts
- the room creator as the first host
- immediate host transfer when the host presses Leave Room or signs out
- heartbeat cleanup and host transfer after an unexpected browser close
- ending the room when no active players remain

It still does **not synchronize Pacman movement, pellets, creeps, or scores during gameplay**. That remains the next multiplayer checkpoint.

## 1. Create a Supabase project

1. Create a new Supabase project, for example `elemental-pacman`.
2. Choose a nearby region.
3. Save the database password privately.

The browser game never uses the database password.

## 2. Configure password accounts

Open:

`Authentication → Sign In / Providers → Email`

Set:

- **Email provider:** Enabled
- **Confirm Email:** Disabled

Although the provider is called Email, players only see account name and password. The JavaScript creates the internal email-shaped identifier automatically.

Do not enable Confirm Email for this build because `@pacman.invalid` has no inbox.

## 3. Build or upgrade the database

### New Supabase project

1. Open **SQL Editor**.
2. Create a new query.
3. Open `supabase/setup.sql`.
4. Paste the entire file.
5. Press **Run**.

### Already ran the previous email starter SQL

Run this instead:

`supabase/upgrade-from-previous.sql`

Old email-based test users cannot automatically know a chosen account name. For the cleanest test:

1. Delete the old test users under **Authentication → Users**.
2. Run the upgrade SQL.
3. Create fresh username accounts through the game.

The SQL creates or updates:

- `profiles`
- `game_rooms`
- `room_players`
- unique account names
- automatic profile creation
- Row Level Security policies
- create, join, leave, heartbeat, and start-room functions
- host migration logic
- Realtime publication entries

## 4. Add the browser-safe project settings

Open the Supabase project **Connect** dialog or **Project Settings → API Keys**.

Copy:

- Project URL
- Publishable key

Open:

`multiplayer/config.js`

Replace the placeholders:

```js
window.PACMAN_SUPABASE_CONFIG = Object.freeze({
  url: "https://YOUR_PROJECT.supabase.co",
  publishableKey: "sb_publishable_YOUR_KEY"
});
```

Never place these in browser code:

- database password
- Secret key
- `service_role` key

## 5. Deploy or use a local web server

Use one of these:

- Vercel
- VS Code Live Server
- another local HTTP server

## 6. Test username accounts

Browser A:

1. Press **Create Account**.
2. Enter an account name such as `golden_j`.
3. Enter a password of at least eight characters.
4. Confirm that the account logs in immediately.

Check Supabase:

- **Authentication → Users** contains an internal `@pacman.invalid` identity.
- **Table Editor → profiles** contains `account_name = golden_j`.

Browser B or an incognito window:

1. Create a different account.
2. Confirm it receives a different profile.

## 7. Test room creation and late joining

Browser A:

1. Log in.
2. Press **Create Game**.
3. Copy the game ID.
4. Press **Start Game**, even if alone.

Browser B:

1. Log in.
2. Press **Join Game**.
3. Enter Browser A's game ID after Browser A has already started.

Browser B should be accepted and sent directly into the game screen.

Gameplay is not synchronized yet, so both browsers still run separate local simulations after entering.

## 8. Test host transfer

### Normal leave

1. Create a room with Browser A.
2. Join with Browser B, then Browser C.
3. Browser A presses **Leave Room** or signs out.
4. Browser B, the earliest remaining player, becomes host immediately.

### Unexpected close

1. Create and join the room from at least two browsers.
2. Close the host tab without pressing Leave.
3. Wait up to about 30 seconds.
4. A remaining player's heartbeat removes the stale host and promotes the earliest remaining player.

If the last player leaves, the room status becomes `ended` and later joins are rejected.

## Troubleshooting

### Account creation says Confirm Email must be disabled

Open **Authentication → Sign In / Providers → Email** and disable Confirm Email.

### Account name is already taken

Choose another 3–20 character name using lowercase letters, numbers, or underscores.

### Old email account cannot log in with a username

Old test users used a different identity scheme. Delete those test users and create new username accounts.

### Host does not transfer instantly after closing the tab

Unexpected closes use heartbeat cleanup. Allow up to about 30 seconds. Clicking **Leave Room** transfers host immediately.

### Room player list does not update

Confirm the SQL completed successfully and that `game_rooms` and `room_players` are in the `supabase_realtime` publication.

## P.A.C v7.0 leaderboard upgrade

If your Supabase project is already running the v6.x SQL, open **SQL Editor**, paste the contents of:

`supabase/v7-leaderboard.sql`

and press **Run** once.

This adds:

- `profiles.high_score`
- `submit_pacman_score(p_score)`
- `get_pacman_high_scores(p_limit)`
- public read access to the safe leaderboard function for the lobby ticker

Do not rerun the full `setup.sql` on an existing configured project unless you intentionally want to re-apply the complete setup. The v7 migration file is the smaller and safer update.
