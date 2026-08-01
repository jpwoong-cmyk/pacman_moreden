# Elemental Pacman v6.0 Username Multiplayer Starter

This package revises the Supabase multiplayer foundation around account names rather than visible email addresses.

## Included now

- Account-name/password registration and login
- Hidden internal Supabase Auth identity generation
- Automatic permanent player profiles
- Unique account names
- Real six-character rooms stored in Supabase
- Join while waiting or after the match has started
- Four-player room roster
- Creator becomes the first host
- Host-only Start Game button
- Automatic host transfer to the earliest remaining player
- Heartbeat cleanup after unexpected browser closure
- Room ends when no active players remain
- Realtime room and membership updates
- Existing desktop keyboard and mobile swipe gameplay

## Important limitation

The live game simulation is not synchronized yet. Joining a started room works at the account and room level, but every browser still runs its own local Pacman simulation.

The next checkpoint remains:

- deterministic map generation from `map_seed`
- multiple Pacman entities
- movement messages
- host-authoritative creeps and pellets
- world snapshots and interpolation

## Start here

Read:

`SUPABASE-SETUP.md`

Then edit:

`multiplayer/config.js`

## Supabase SQL

For a new project:

`supabase/setup.sql`

For a project that already used the previous email starter:

`supabase/upgrade-from-previous.sql`

## Security rule

Only use the browser-safe Supabase Publishable key in `config.js`.

Never add a database password, Secret key, or `service_role` key to this project.
