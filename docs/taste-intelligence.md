# Pockedio Taste Intelligence

## Goal

Pockedio should understand the user's music taste well enough to choose music at the right moment, not just recommend globally popular or mood-tagged tracks. Taste intelligence should combine explicit music data, written preference memory, diary context, and feedback from actual listening sessions.

## Source 1: Exported Music App Data

The user can export favorite tracks, liked playlists, historical playlists, and collection data from multiple music apps across different periods.

This is the most direct signal for musical preference. It can reveal:

- recurring artists, albums, genres, languages, and eras
- long-term favorites versus temporary phases
- tracks associated with specific periods of life
- differences between platforms, such as discovery playlists versus manually saved songs
- disliked gaps, such as styles that appear in app history but were never collected

The first version should treat exported music data as the primary taste seed. The product should keep raw imports separate from derived taste summaries so the system can regenerate better profiles later.

## Source 2: `taste.md`

Pockedio should maintain a human-readable `taste.md`, similar in spirit to a product `design.md`. This file should describe the user's music taste in language that both the user and the system can inspect.

It should include:

- durable taste statements, such as favorite genres, artists, moods, and disliked patterns
- situational preferences, such as work music, late-night music, travel music, and emotional reset music
- examples of high-confidence songs or artists
- negative constraints, such as artists, sounds, production styles, or moods to avoid
- notes about how taste has changed over time

The `taste.md` file should not be treated as static truth. It should be a curated memory that can be revised after imports, feedback, and listening sessions.

## Source 3: Diary Context

The user's diary under `/Users/leonw/openclaw/area/diary` may be an important source for understanding emotional context, recurring life patterns, work intensity, projects, and personal seasons.

Diary data should be used carefully. It is not music taste by itself, but it can help Pockedio understand when certain music is appropriate. For example, it may help distinguish:

- deep focus versus anxious overwork
- celebratory energy versus forced high energy
- calm recovery versus melancholy
- nostalgia, transition, closure, or momentum

The product should not read diary files by default. Diary access should be explicit, local-first, and explainable. When access is granted, Morning DJ should read the latest diary entry and combine it with durable diary memory. The system should summarize relevant patterns into taste and context memory rather than repeatedly exposing raw diary entries to every station-generation step.

## Product Stance

Pockedio should not rely on a single taste source. The strongest approach is layered:

1. Use exported music data to learn what the user actually saves and returns to.
2. Use `taste.md` as the editable taste contract.
3. Use diary-derived summaries to understand life context and emotional fit.
4. Use listening feedback to correct mistakes over time.

This creates a system that can answer both "what do I like?" and "what would fit me right now?"

## Open Decisions

- Which music apps and export formats should be supported first.
- Where `taste.md` should live in the project.
- Whether diary summaries should be generated manually on demand or maintained as an indexed local memory.
- What database-backed memory schema should store agenda memory, diary memory, taste memory, session memory, and feedback.
- What privacy guardrails are required before reading diary files.
- How the CLI should ask for and apply feedback during playback.
