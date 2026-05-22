# LoreForge — Claude Code Project Notes

The canonical design is `ARCHITECTURE.md`. Treat it as the source of truth for schemas, interfaces, and structural decisions.

## Stack
- pnpm workspaces + Turborepo
- TypeScript (strict mode) throughout
- Node.js 22+ (current dev env is Node 25)
- Vitest for tests
- Biome for lint + format (no ESLint, no Prettier)

## Autonomy rules
- Proceed without confirmation for: file edits, `pnpm`/`turbo`/`vitest`/`npx`/`node`/`git` commands, commits to local branches.
- Confirm before: pushing to remote, deleting files outside `packages/` and `adventures/`, modifying CI, force operations.

## Conventions
- All shared types live in `packages/shared`. Other packages import from `@loreforge/shared`.
- Zod schemas live next to types in the same file: `Item` (type) and `ItemSchema` (zod) co-located.
- Pipeline stages in `packages/engine` are pure functions where possible. Side effects are injected via `EngineDependencies`.
- IDs: slugs for definitions (`rusty_dagger`), UUIDs for instances/sessions/players.
- Commit at each Phase milestone (one logical unit of work per commit).
