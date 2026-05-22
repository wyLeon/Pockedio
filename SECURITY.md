# Security Policy

Pockedio is local-first and stores its own data under `~/.pockedio/`.

## Supported Versions

The project is pre-1.0. Security fixes are applied to the current main branch until formal release branches exist.

## Reporting A Vulnerability

Please open a private GitHub security advisory for this repository if available. If not, open a GitHub issue with minimal public detail and avoid posting secrets, tokens, cookies, or private diary/calendar content.

## Sensitive Data

Do not include any of the following in issues, logs, screenshots, PRs, or commits:

- LLM API keys
- NetEase cookies
- `.env` files
- `~/.pockedio/secrets/`
- raw diary text
- private calendar details
- generated local config files

## Local Data Boundary

Pockedio does not provide a hosted backend. External data sharing depends on user-enabled integrations:

- LLM providers may receive conversation, station-planning, and DJ-copy prompts.
- NetEase adapter receives music search and playable URL requests.
- Open-Meteo receives configured location lookup.
- Fish TTS is local when configured locally.

If you add a new integration, document what leaves the machine and keep it opt-in where possible.
