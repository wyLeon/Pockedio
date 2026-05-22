# macOS Siri TTS Fallback Design

## Context

Pockedio currently treats Fish TTS as the spoken DJ audio path. That works for the local development setup, but it is too much friction for an open-source default: users need a local Fish Speech runtime, model files, reference audio, and compatible Python tooling before they can hear DJ audio.

macOS provides high-quality local Siri voices through the Spoken Content voice manager. In testing, the English (United States) Siri voices were good enough for Pockedio DJ station intros and could generate distinct custom speech once the voices were downloaded and selected through System Settings.

The product should therefore use macOS Siri local TTS as the default spoken DJ path on macOS, while keeping Fish TTS as an optional advanced path for Mina, Nova, and custom cloned voices.

## Product Decision

Pockedio should support three spoken DJ tiers:

1. macOS Siri local TTS by default on macOS.
2. Fish TTS as an optional configured provider for cloned or custom voices.
3. Text-only DJ copy when no local TTS provider is available.

This keeps the open-source setup lightweight while preserving the higher-quality custom voice path for users who want to configure it.

## Voice Names

Pockedio should not expose Apple's raw `Voice 1` through `Voice 5` labels as product names. Those labels are platform implementation details and do not communicate any DJ identity.

Use these Pockedio-facing names:

| Pockedio name | macOS preview voice |
| --- | --- |
| Lumen | Samantha |
| Sable | Moira |
| Arden | Daniel |
| Vale | Karen |
| Sol | Tessa |

`Vale` is the default built-in voice.

Mina and Nova remain Fish/custom cloned DJ personas. They should not be reused for macOS Siri voices.

## Provider Priority

When spoken DJ audio is requested, Pockedio should resolve the provider in this order:

1. If Fish TTS is configured and selected, use Fish TTS.
2. Otherwise, if running on macOS and the configured macOS voice is available, use macOS Siri TTS.
3. Otherwise, fall back to text-only DJ copy with a concise reason.

The default provider mode should be `auto`, which means:

1. Prefer Fish only when the user explicitly configured it.
2. Use macOS Siri TTS on macOS.
3. Fall back to text-only elsewhere.

## Configuration Shape

Add a new TTS-level config instead of growing `fishAudio` into a generic provider:

```json
{
  "tts": {
    "provider": "auto",
    "macosVoice": "vale",
    "fishVoice": "mina"
  }
}
```

Provider values:

- `auto`: default behavior.
- `macos`: force macOS local TTS.
- `fish`: force Fish TTS.
- `text`: disable synthesized voice and show DJ copy only.

macOS voice values:

- `lumen`
- `sable`
- `arden`
- `vale`
- `sol`

Fish voice values:

- `mina`
- `nova`

Custom Fish voice configuration is out of scope for this pass. Users can still configure Fish runtime paths and reference audio through the existing `fishAudio` settings.

The existing `fishAudio` config remains as the Fish runtime details: Python path, script path, model directory, reference audio, and reference text.

## macOS Implementation Constraint

Direct calls like this are unreliable:

```bash
say -v "Siri Voice 4" "Welcome back."
```

In local testing, `say -v "Siri Voice N"` produced identical fallback audio even after the Siri voices were downloaded.

The earlier Siri voice experiment showed that directly targeting `Siri Voice N` can collapse to identical fallback audio. The current CLI setup therefore uses stable named macOS `say` voices for true previews and selection. A later macOS system-voice switcher can revisit the Siri voice path if it can restore global state safely.

The Siri working path was:

1. Download the English (United States) Siri voices through System Settings.
2. Select the intended Siri voice as the macOS Spoken Content system voice.
3. Run `say` without a `-v` argument.

Pockedio should hide this behind a `MacOsTtsProvider`. It may temporarily switch the system Spoken Content voice to generate a DJ clip, then restore the previous system voice.

Because changing the system voice is user-visible global state, this provider must:

- restore the previous voice after synthesis succeeds or fails;
- serialize macOS TTS synthesis so two clips do not race the system voice setting;
- report a clear fallback reason if voice switching fails;
- avoid changing rate, pitch, or volume in this pass.

## Setup Behavior

First setup should not require Fish TTS.

Recommended first setup flow:

1. Ask whether the user wants to hear built-in DJ voice previews.
2. Offer the five named macOS voices on macOS: Lumen, Sable, Arden, Vale, Sol.
3. Default to Vale.
4. Preview selected voices by running `say -v <voice>` with a fixed DJ sample sentence.
5. Offer Fish TTS as an advanced/local custom voice option, not as the default path.

Fish setup should be available from a dedicated setup or settings entry:

```text
pockedio setup voice
```

That entry can configure Fish runtime paths and Mina/Nova reference audio.

## User Interaction

When a user asks for a DJ version of a station, the voice provider choice should not become part of the normal conversation. Pockedio should simply prepare and play the DJ audio.

If macOS voice generation works:

```text
Preparing DJ voice...
```

If macOS voice generation fails and Fish is not configured:

```text
DJ audio is unavailable, so I’ll keep this as text for now.
```

The user should not need to understand the provider chain during ordinary listening.

## Open Source Defaults

Open-source users should be able to run Pockedio without Fish TTS. On macOS, they should get a usable spoken DJ path with system voices. On non-macOS platforms, the app should still run and show DJ copy as text.

Fish TTS remains a documented upgrade path for users who want higher personality fidelity or cloned voices.

## Testing

Add focused tests for:

- TTS provider resolution in `auto`, `macos`, `fish`, and `text` modes.
- macOS voice name mapping from Pockedio names to Apple labels.
- fallback behavior when macOS TTS is unavailable.
- Fish provider still using existing `fishAudio` config.
- spoken DJ flows still showing text fallback when synthesis fails.

Manual verification on macOS should include:

- generating one DJ sentence for Lumen, Sable, Arden, Vale, and Sol;
- checking output files are non-empty and hash-different;
- confirming the previous system voice is restored after generation.
