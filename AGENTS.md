# Repository Guidelines

## Project Structure

`game-development-guide.md` is the working reference for integrating this game with Game Hub. `LICENSE` contains the repository license. The game source, tests, and assets are still to be added.

For the initial implementation, follow the layout suggested in the guide. Use `src/` for game code, `public/` for static assets, and `scripts/` for build and verification helpers. Keep rendering and player input separate from guest identity, room lifecycle, and server actions. Make shared catalog, backend, and integration test changes in the sibling `game-hub` checkout.

## Build and Development

This checkout has no build, dev server, or test commands yet. When adding the game, document the exact install, dev, build, and test commands and commit the dependency lockfile if the build uses one. For local Game Hub setup, run `npm ci` in the hub checkout to install its dependencies, then follow the development guide's local backend and shared-origin setup.

## Coding Style and Naming

Use lowercase, hyphenated game IDs and match the deployment path to the ID, for example `my-game` and `/my-game/`. If using JavaScript, follow the guide's examples with ES modules and two-space indentation. The repository has no configured formatter or linter.

## Testing

There is no test runner or coverage threshold yet. Add game-specific lifecycle and action tests to the hub suite when integrating multiplayer. Build and serve the hub and game on the same local origin to verify shared guest sessions and the full hub-to-match-and-back flow. Cover direct room links, refresh, reconnects, and stale actions.

## Commits and Pull Requests

Git history contains only `Initial commit`. Use short, action-oriented subjects. In pull requests, summarize the change, report verification results, and link related hub or backend changes. For game UI changes, include screenshots. For integration changes, document the game ID, route, player limits, and source and asset licenses.
