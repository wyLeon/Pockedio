# DJ Preview Spike

This spike generates first-run DJ trial audio for the setup flow.

Generated WAV files are local runtime artifacts and should not be committed:

```text
~/.pockedio/audio/previews/mina.wav
~/.pockedio/audio/previews/nova.wav
```

Run:

```bash
spikes/dj-previews/generate_previews.sh
```

The current accepted MVP voices use Fish S2 Pro prompt tags without reference audio:

- Mina: soft young voice, warm tone, low volume
- Nova: calm male voice, warm baritone, professional broadcast tone

These WAV files should be treated as setup trial sounds. Future generated DJ speech may still vary unless Pockedio promotes the chosen preview into a reusable voice anchor.
