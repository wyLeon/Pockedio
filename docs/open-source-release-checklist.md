# Open-Source Release Checklist

Use this checklist before tagging the first public GitHub release.

## Scope

Release target: source install from GitHub.

Not in scope for the first public release:

- npm publication
- hosted backend
- multi-user account system
- mandatory Fish TTS install

`package.json` intentionally keeps `"private": true` for the source-install release. Remove it only when the project is ready for npm publication.

## Required Checks

- [ ] Working tree contains only intentional changes.
- [ ] `npm ci` succeeds from a fresh clone.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm pack --dry-run` contains only the intended future package surface.
- [ ] Fresh-clone manual smoke uses a disposable home, for example `POCKEDIO_HOME=/tmp/pockedio-clean-test`.
- [ ] `POCKEDIO_HOME=/tmp/pockedio-clean-test node dist/cli.js status` runs and shows `Local     /tmp/pockedio-clean-test`.
- [ ] `POCKEDIO_HOME=/tmp/pockedio-clean-test node dist/cli.js setup` can configure LLM, voice, NetEase, context, and scheduler.
- [ ] Selectable setup screens support `B Back`.
- [ ] Nested text/password setup prompts support `Esc to back`.
- [ ] Built-in macOS voice path works without Fish TTS on macOS.
- [ ] Fish TTS setup remains optional.
- [ ] NetEase anonymous path works or fails with a clear message.
- [ ] NetEase cookie path does not echo the cookie.
- [ ] Playlist import works with a NetEase playlist URL or ID.
- [ ] A basic station can be generated and playback starts or fails gracefully.

## Secret Safety

- [ ] No `.env` or `.env.*` files are tracked except `.env.example`.
- [ ] No API keys are present in docs, tests, fixtures, scripts, or config.
- [ ] No NetEase cookies are present.
- [ ] No local `~/.pockedio/` files are copied into the repo.
- [ ] No personal absolute paths are required for setup.
- [ ] No generated audio, spike outputs, environment dumps, or machine-local paths are tracked.
- [ ] README examples use placeholders only.
- [ ] Clean-release test output does not list real favorites, diary context, imported taste, or prior sessions from the user's normal `~/.pockedio`.

Suggested local scan:

```bash
git ls-files | grep -E '(^|/)(\\.env|config\\.json|pockedio\\.sqlite|.*cookie.*|.*secret.*)$' || true
rg -n --hidden --glob '!node_modules/**' --glob '!package-lock.json' 'sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY=.+|DEEPSEEK_API_KEY=.+|OPENROUTER_API_KEY=.+|MUSIC_U=' .
rg -n --hidden --glob '!node_modules/**' --glob '!package-lock.json' 'api[_-]?key\\s*[:=]\\s*[^[:space:]]{12,}' .
rg -n --hidden --glob '!node_modules/**' --glob '!package-lock.json' '(/Users/|~/.pockedio|~/.openclaw|\\.wav$|MUSIC_U=)' .
```

## Community Profile

- [ ] `README.md` explains purpose, setup, requirements, local data, and limitations.
- [ ] `LICENSE` is present.
- [ ] `CONTRIBUTING.md` is present.
- [ ] `SECURITY.md` is present.
- [ ] `CODE_OF_CONDUCT.md` is present.
- [ ] GitHub issue templates are present.
- [ ] GitHub pull request template is present.

## npm Publication Gate

Do not publish to npm until all of these are true:

- [ ] `"private": true` is intentionally removed.
- [ ] `npm pack --dry-run` is reviewed.
- [ ] The package includes only runtime files and public docs.
- [ ] A tag and changelog entry exist for the exact package version.
- [ ] Installation from the packed tarball works in a clean directory.

## Release Steps

1. Finish the smoke checklist.
2. Update `docs/v1-acceptance.md` with the latest evidence.
3. Commit release-prep changes.
4. Push `main`.
5. Create a GitHub release tag such as `v0.1.0`.
6. Include known limitations in the release notes.
