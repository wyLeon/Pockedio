# Pockedio Technical Spikes

This directory contains disposable probes for Pockedio v1 dependencies.

Rules:

- Probe scripts may read local data only when the user has already approved the source.
- Probe scripts should write summaries to `spikes/results.md`, not private raw data.
- Probe scripts should avoid committing credentials, cookies, generated audio, or private diary/calendar text.
- Successful probes inform the production implementation plan.
