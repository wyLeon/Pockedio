# Pockedio Technical Spikes

This directory contains disposable probes for Pockedio v1 dependencies.

Rules:

- Probe scripts may read local data only when the user has already approved the source.
- Probe scripts should write outputs to a local ignored path, not private raw data in git.
- Do not commit generated outputs unless they are sanitized fixtures needed by tests or docs.
- Do not commit credentials, cookies, generated audio, private diary/calendar text, machine-local paths, or environment dumps.
- Successful probes inform the production implementation plan.

Tracked files in this directory should be reusable scripts, small fixtures, or documentation only.
