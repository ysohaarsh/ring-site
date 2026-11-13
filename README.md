# ring-site

A one-screen personal site: a sentence set as a spinning ring of text that behaves like a rubber ball.

Open `index.html` in a browser. No build step, no dependencies.

## What it does

- Drag and throw the ring; it bounces off the edges with a soft-body wobble
- Every bounce flips the page to the next terminal palette
- Press it into a wall to squeeze it, release to launch it
- Hold a deep squeeze and it pops into words, then reassembles
- Pinch or scroll to resize; tilt a phone to change gravity
- Double-tap or double-click for 15 seconds of air hockey with a local leaderboard
- Keys: arrows nudge, `G` plays, `M` mutes, `Esc` leaves the game
- Add `?tweaks` to the URL for goal size and puck friction sliders

## Make it yours

Edit the `PROFILE` block at the top of `main.js` (name, ring sentence, tagline) and the `THEMES` list below it.

## Credit

The idea of a physical ring of text comes from [iansilber.com](https://iansilber.com/). This is an independent implementation: all code and sounds here are written from scratch.
