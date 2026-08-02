# P.A.C v9 Living City

## Add

- `js/living-city.js`

## Edit

Follow `INDEX-CHANGES.txt`.

## Included changes

### City mix

The update keeps the existing procedural city style and replaces selected
existing obstacle lots rather than adding a second layer of obstacles.

The generated city now aims for:

- housing blocks;
- offices;
- schools;
- parks;
- up to a controlled number of malls;
- the existing shops, stalls, cones and generic buildings.

Three selected lots are converted into walkable parks. This adds open space
rather than making the map narrower.

### Day and night

- 120 seconds of day;
- gradual dusk transition;
- 120 seconds of night;
- gradual dawn transition;
- lamps and windows illuminate as night approaches;
- daylight returns smoothly.

The cycle follows the shared match elapsed time, so players in the same room
see the same part of the day/night cycle.

### Citizens

Citizens are generated deterministically from the shared map seed.

Their routine is:

1. remain inside housing at the beginning of the day;
2. leave home;
3. walk along valid map paths;
4. enter an office, school, mall/shop, or remain visible inside a park;
5. leave before night;
6. walk back home;
7. remain indoors during the night.

Citizens are deliberately limited to roughly 14-22 so they do not clutter the
map. Their appearance is smaller than the pellet orbit and uses the current
non-pixel, miniature-city visual direction.

## Not changed

- pellets;
- creep spawning;
- creep AI;
- scores;
- respawning;
- multiplayer rooms;
- mobile joystick;
- Supabase schema.

## GitHub status

An automatic branch creation was attempted but GitHub returned:
`403 Resource not accessible by integration`.

The repository was not modified automatically.
