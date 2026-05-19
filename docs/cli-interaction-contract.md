# Pockedio CLI Interaction Contract

## Section 1: Flow Spec Format And Global Display Rules

This document defines Pockedio's CLI user experience flow by flow. It should describe exact interaction structures, not exact final wording. Each flow must make clear what the user types, what Pockedio shows while processing, what output appears, what the user can do next, and what happens silently.

The contract is written section by section. A new section should be added only after the previous section is reviewed and accepted.

## 1.1 Why This Contract Exists

Pockedio has several interaction branches:

- setup
- startup guidance
- identity and capability questions
- mood and recommendation requests
- playback confirmation
- explicit playback
- conversation during playback
- queue and playback status
- feedback controls
- explicit DJ audio
- scheduled DJ jobs
- error and fallback states

The action logic can be correct while the CLI still feels unclear. This contract focuses on the visible UX:

- command shape
- user input shape
- processing display
- main output shape
- next choices
- silent actions
- error variants

The goal is to make each branch reviewable before implementation.

## 1.2 Design Principles

### Be Conversational, But Structured

The main `pockedio` session should feel like talking to a personal DJ. The CLI should still use stable structures for queue, setup, status, and errors.

### Do Not Hide Important Information In Animation

Processing states may animate in an interactive terminal, but the user must not need the animation to understand the result.

### Show The Right Surface At The Right Time

Before playback confirmation, show DJ text and a clear next question. After playback starts, show queue and now-playing surfaces.

### Separate Setup From DJ Voice

Setup should be concise and operational. It should not use radio-DJ language.

### Prefer Examples And Next Steps

Every command or flow should help the user understand what to do next. This follows common CLI UX guidance: make commands discoverable, show examples, and give actionable recovery text.

### Keep Non-Interactive Output Clean

When output is piped or running in CI, do not render spinners, repeated progress frames, or purely decorative formatting.

## 1.3 Required Flow Spec Template

Every flow section must use this structure.

```text
Flow name:
  Short name for the branch.

User entry:
  Command:
    The shell command that starts the flow.
  User input:
    The natural-language input or prompt answer the user gives.

Preconditions:
  Runtime/config state that changes the flow.

Processing display:
  What appears while Pockedio is working.
  Include spinner/plain-output rules.

Main output:
  The exact output shape.
  Define required content and forbidden content.

User choices after output:
  What the user can type next and where each choice routes.

Silent actions:
  What Pockedio stores, mutates, reads, schedules, or plays without displaying as primary output.

Error variants:
  Expected failures and their visible recovery shape.
```

No flow section should skip one of these headings. If a heading does not apply, state `None` and explain why.

## 1.4 Output Layer Definitions

### Status Layer

The status layer shows temporary work-in-progress state.

Examples:

```text
Thinking...
Reading your context...
Building a station...
Starting playback...
Preparing DJ voice...
Checking NetEase...
Saving setup...
```

Rules:

- Use only during waits.
- Keep status text short.
- In an interactive TTY, status may animate with a spinner.
- In non-TTY output, print stable plain lines.
- Never put important decisions, warnings, or recovery instructions only in status text.

### DJ Reply Layer

The DJ reply layer is conversational text from Pockedio.

Use for:

- identity answers
- mood acknowledgement
- music recommendation
- station framing
- conversation during playback
- spoken-DJ text fallback

Rules:

- Do not fix exact wording in this contract.
- Define required reply structure instead.
- Keep the reply concise.
- Use the configured DJ name and style where appropriate.
- Do not claim playback has started before playback starts.
- Do not show queue details inside a pre-confirmation DJ reply.

### Structured Surface Layer

The structured surface layer shows operational information.

Examples:

```text
Queue:
1. Title - Artist
2. Title - Artist

Now playing: Title - Artist
[==>.................] 01:15 elapsed
```

Use for:

- queue
- now playing
- playback status
- setup summaries
- health/status reports
- saved configuration summaries

Rules:

- Keep labels stable.
- Prefer scan-friendly sections.
- Do not mix long conversational prose into structured surfaces.
- Do not show generated queue before the user has approved playback, unless the flow explicitly asks the user to review a proposed queue.

### Prompt Layer

The prompt layer is what Pockedio asks the user to answer.

Examples:

```text
Play this station? [Y/n]
LLM model:
Choose setup section:
```

Rules:

- Prompts should be short and specific.
- Prompts should show defaults when defaults exist.
- Prompts should not ask unrelated questions.
- Prompts should not require visual-only cues.

### Memory And Trace Layer

The memory layer is silent by default.

Examples:

- transcript messages
- context snapshots
- pending station request
- selected station
- playback results
- feedback actions
- setup config changes
- DJ audio cache metadata

Rules:

- Store what is needed for personalization and debugging.
- Do not display database traces by default.
- Do not expose secrets.
- Do not expose raw diary content unless the user explicitly asks and permission exists.

## 1.5 Processing Display Rules

### Interactive TTY

In an interactive terminal, Pockedio may animate processing lines:

```text
| Thinking...
/ Thinking...
- Thinking...
\ Thinking...
```

When the step finishes, the spinner should clear or resolve before the main output appears.

### Non-TTY Or Test Output

When output is not interactive, Pockedio should print stable lines:

```text
Thinking...
Reading your context...
```

No repeated spinner frames should appear.

### Long Operations

For long operations, show phase changes rather than repeating one vague status forever.

Good:

```text
Thinking...
Reading your context...
Building a station...
Starting playback...
```

Bad:

```text
Loading...
Loading...
Loading...
```

## 1.6 Main Output Shape Rules

Every main output should answer three questions:

1. What did Pockedio understand?
2. What did Pockedio do, or what is it asking permission to do?
3. What can the user do next?

For conversational flows, this usually means:

```text
<acknowledgement>
<music direction or explanation>
<next action question>
```

For operational flows, this usually means:

```text
<section title>

Current:
- ...

Changed:
- ...

Next:
- ...
```

## 1.7 Error Output Shape Rules

Errors should be useful, not raw.

Every recoverable error should include:

```text
What failed:
What still worked:
What to do next:
```

Example shape:

```text
NetEase did not return a playable URL for the first track.
I kept the station and skipped to the next playable track.
Try `show queue` to see what remains.
```

Rules:

- Do not dump stack traces in normal CLI output.
- Keep the session alive when possible.
- Show exact setup command when configuration is missing.
- Store failure details silently for status/debugging.

## 1.8 Section Approval Workflow

This contract should be created incrementally.

Workflow:

1. Draft one section.
2. User reviews it.
3. Revise that section until accepted.
4. Only then add the next section.

Planned sections:

1. Flow spec format and global display rules.
2. Setup command flows.
3. Interactive startup and first-run guidance.
4. Identity and capability question flow.
5. Implicit mood and recommendation flow.
6. Pending station confirmation flow.
7. Explicit playback flow.
8. Conversation during playback flow.
9. Queue, status, and feedback flows.
10. Explicit DJ audio flow.
11. `pockedio status` flow.
12. `pockedio serve` scheduled DJ flow.
13. Error and fallback flow catalog.

## Section 2: Setup Decision Tree

This section is locked to the setup surfaces currently built in the CLI.

Supported commands:

```text
pockedio setup
pockedio setup calendar
pockedio import-taste <file>
```

Unsupported setup sections should fail plainly:

```text
$ pockedio setup diary
Unknown setup section: diary
```

## 2.1 `pockedio setup`

`pockedio setup` runs one guided first-setup flow. It does not open a setup menu yet.

### Full Flow Shape

```text
$ pockedio setup

Pockedio first setup

Hear DJs you can choose? [Y/n]
```

If the user chooses to hear DJs:

```text
Hear DJ
  Mina
  Nova
  Choose your DJ

> Mina

Preparing DJ voice preview...
Playing Mina preview...

Hear DJ
  Mina
  Nova
  Choose your DJ
```

The hear-DJ loop repeats until the user chooses `Choose your DJ`.

Then setup asks for the actual DJ:

```text
Choose your DJ
  Mina - warm, calm, young personal radio
  Nova - calm male broadcast voice
```

### Taste

```text
Import taste from a NetEase playlist? [y/N]
```

If yes:

```text
Paste NetEase playlist link
> https://music.163.com/#/playlist?id=123456

Reading NetEase playlist...

Imported
  Tracks            128
  Artists           42 detected
  Playlists         1 imported
  taste.md          /Users/leonw/.pockedio/taste.md

taste.md will grow as we talk and listen, so Pockedio can understand you better.
```

If no, setup continues without extra text.

### Weather

```text
Use local weather for better DJ context? [Y/n]
```

If yes:

```text
Weather city
> Guangzhou

Checking weather...

Weather ready
  Location          Guangzhou, China
  Current           28C, humidity 95%

Pockedio may use weather lightly when choosing music and replying.
```

If weather lookup fails:

```text
Weather not found.
You can skip it now and set it later.
```

### Calendar

```text
Other context
Calendar context stays local and stores event title and time only.
Enable Apple Calendar context? [y/N]
```

If yes:

```text
If macOS asks for Calendar permission, choose Allow.
Checking calendar...

Calendar ready
  Events read       7
  Window            Last 7 days

Pockedio may use this lightly when replying and planning scheduled DJ.
```

If Calendar access fails:

```text
Calendar unavailable.
Not authorized to send Apple events to Calendar. Enable Calendar access for your terminal in System Settings > Privacy & Security > Automation or Calendars, then run setup again.
You can skip it now and set it later.
```

### Diary

```text
Diary summaries are stored locally. If your LLM is remote, summary generation may send a diary excerpt.
Enable diary context? [y/N]
```

If yes:

```text
Diary path
> /Users/leonw/Diary

Checking diary...

Diary ready
  Path              /Users/leonw/Diary
  Latest entry      2026-05-18.md

Pockedio will use diary context lightly and locally.
```

If diary lookup fails:

```text
Diary unavailable.
Check the path and set it later if needed.
```

### Scheduled DJ

```text
Scheduled DJ programs
Pockedio can prepare weekday spoken DJ programs before the time you choose.

Scheduled DJ programs?
  Not now
  Morning only
  Evening only
  Morning and Evening
```

If Morning is enabled:

```text
Morning DJ ready time (HH:mm)
> 08:45
```

If Evening is enabled:

```text
Evening DJ ready time (HH:mm)
> 17:00
```

Invalid times re-prompt:

```text
Time must use HH:mm, for example 08:45.
```

The preparation offset is not shown in setup. Pockedio stores the ready time as the scheduled play time and prepares audio before that time internally.

### Completion

```text
Setup complete
  DJ                Mina
  Taste             imported
  Calendar          enabled
  Diary             enabled
  Scheduled DJ      Morning weekdays 08:45; Evening weekdays 17:00

Next
  pockedio
```

Skipped items appear as `skipped`:

```text
Setup complete
  DJ                Nova
  Taste             skipped
  Calendar          skipped
  Diary             skipped
  Scheduled DJ      skipped

Next
  pockedio
```

## 2.2 First Setup Decision Map

```text
hear DJs yes              -> open Hear DJ loop
hear DJs no               -> choose DJ directly
Hear DJ Mina/Nova         -> play preview, return to Hear DJ loop
Hear DJ Choose your DJ    -> continue to DJ choice
preview missing/fails     -> show preview fallback, continue setup
DJ choice                 -> set display name and persona preference
taste yes                 -> ask playlist link -> import taste -> continue setup
taste no                  -> continue setup
weather yes               -> ask city -> check weather -> save city
weather no                -> keep current/default city
calendar yes              -> request/check permission -> read last 7 days -> store title/time only
calendar unavailable      -> disable calendar and continue setup
diary yes                 -> ask path -> check latest diary file -> save path
diary unavailable         -> disable diary and continue setup
scheduled DJ not now      -> disable Morning DJ and Evening DJ
scheduled DJ morning only -> ask Morning ready time -> enable Morning only
scheduled DJ evening only -> ask Evening ready time -> enable Evening only
scheduled DJ both         -> ask both ready times -> enable both
after complete            -> suggest pockedio
```

Voice preview paths:

```text
Mina preview       /Users/leonw/.pockedio/audio/previews/mina.wav
Nova preview       /Users/leonw/.pockedio/audio/previews/nova.wav
```

Preview fallback:

```text
Voice preview is not ready yet.
You can still choose the DJ style now and configure voice later.
```

## 2.3 `pockedio setup calendar`

Calendar is the only dedicated setup subsection currently implemented.

```text
$ pockedio setup calendar

Calendar

Privacy
  Calendar context stays local.
  Pockedio stores event title and time only.

Enable Apple Calendar context? [y/N]
```

If enabled:

```text
If macOS asks for Calendar permission, choose Allow.
Checking calendar...

Calendar ready
  Events read       7
  Window            Last 7 days

Pockedio may use this lightly when replying and planning scheduled DJ.
```

If disabled:

```text
Saved
  Calendar          disabled
```

Calendar read modes:

```text
first setup / setup calendar -> read last 7 days, store as setup context
normal conversation          -> read today, store as interactive context
scheduled DJ                 -> read last 7 days + today, store as scheduled context
```

## 2.4 `pockedio import-taste <file>`

This is not a setup subsection, but it is the current standalone import command.

```text
$ pockedio import-taste spikes/fixtures/taste-normalized.csv

Imported 128 tracks into /Users/leonw/.pockedio/taste.md.
Artists: Ryuichi Sakamoto, ...
Playlists: Deep Work, ...
```

This command expects a normalized CSV file. First setup uses a NetEase playlist link instead.

## Section 3: Normal Listening Session Flow

This section defines what happens after the user runs `pockedio`.

## 3.1 Session Startup

Startup should be short. It confirms the selected DJ identity, gives one tiny greeting, then shows a few useful examples.

```text
$ pockedio

Mina is listening.
What are we tuning for?

Try:
  I'm exhausted and want something calm.
  play something for deep work
  what's playing?

Controls:
  next
  stop
  show queue

Spoken DJ:
  after a station suggestion, type dj

Setup:
  pockedio setup

>
```

Rules:

- Use the chosen DJ name: `Mina is listening.` or `Nova is listening.`
- Keep the greet fixed: `What are we tuning for?`
- Do not read weather, Calendar, or diary during startup.
- Do not start playback during startup.
- Do not repeat the full setup explanation.
- Show examples as natural inputs, not as a command manual.

If setup is incomplete, keep the session open and show a short setup hint:

```text
Mina is listening.
What are we tuning for?

Setup note:
  Taste is not imported yet.
  Run pockedio setup when you want to improve personalization.

>
```

## 3.2 Input Routing

Every user input is classified before action. Routing is invisible unless Pockedio needs clarification.

Routing priority:

```text
1. Session exit
2. Playback controls
3. Queue or status questions
4. Explicit DJ audio request
5. Pending station confirmation
6. Identity or capability question
7. Explicit playback request
8. Mood or life-context recommendation
9. Feedback
10. General conversation or fallback
```

Routing map:

```text
User input                       Route
quit / exit / Ctrl+C             3.14 Session Exit
next                             3.9 Playback Controls
stop                             3.9 Playback Controls
what's playing?                  3.10 Queue And Status Questions
show queue                       3.10 Queue And Status Questions
dj, when a station is pending    3.5 Pending Station Confirmation
make me a short DJ intro         3.12 Explicit DJ Audio Request
yes / play it                    3.5 Pending Station Confirmation, if pending
no / not now                     3.5 Pending Station Confirmation, if pending
Who are you?                     3.3 Identity And Capability Questions
What can you do?                 3.3 Identity And Capability Questions
play jazz for deep work          3.7 Explicit Playback Request
I'm exhausted, want relaxation   3.4 Mood / Life Context Conversation
more like this                   3.11 Feedback Actions
I like this                      3.11 Feedback Actions
This reminds me of college       3.8 During-Playback Conversation
unclear input                    3.13 Unknown / Fallback Conversation
```

Processing display:

```text
Thinking...
```

Rules:

- Use the global status layer while processing LLM-routed messages.
- Obvious local commands such as `next`, `stop`, `show queue`, and `yes` should respond without a visible spinner unless they trigger a slower action.
- Do not print routing labels such as `Detected intent: mood`.
- If a pending station exists, short confirmations like `yes`, `play it`, `no`, or `not now` route to pending station first.
- Playback controls override conversation.
- Explicit DJ audio requires clear spoken/audio wording.
- Mood and life-context requests should not auto-play.
- Explicit playback requests may proceed to station building more directly.
- Personal sharing during playback should be treated as conversation and memory, not automatically as taste feedback.
- Unknown input should receive a useful conversational response, not a generic error.

## 3.3 Identity And Capability Questions

Examples:

```text
Who are you?
What can you do?
```

Flow name:
  Identity and capability question.

User entry:
  Command:
    `pockedio`
  User input:
    Questions like `Who are you?`, `Who is talking there?`, `What can you do?`, or `Are you a real DJ?`

Preconditions:
  None.

Processing display:

```text
Thinking...
```

Main output:
  Answer directly in the selected DJ voice. Use the chosen DJ name and describe real capabilities without overpromising.

Example:

```text
> Who are you?

Mina is here. I’m your personal DJ for this terminal. I can talk with you, read the moment, shape a station, play music, remember useful taste signals, and make spoken DJ audio when you ask for it.
```

Example:

```text
> What can you do?

I can listen to what kind of moment you’re in, suggest a direction, build a station, control playback, show the queue, remember what works for you, and make a short spoken DJ intro when you ask.
```

Rules:

- Use the selected DJ name when answering identity questions: `Mina is here.` or `Nova is here.`
- Do not repeat the startup greet `What are we tuning for?` in every answer.
- Mention core capabilities: conversation, recommendations/stations, playback controls, queue/status, useful memory, explicit spoken DJ audio.
- Mention memory carefully: `remember useful taste signals`, not `remember everything`.
- Do not say `I am an AI language model`.
- Do not mention therapy disclaimers unless the user asks for emotional or mental-health support.
- Do not start playback.
- If ending with a question, make it specific to the user's context, not a fixed catchphrase.

Fallback if the LLM is unavailable:

```text
Mina is here. I can still build stations, play music, control playback, show the queue, and make spoken DJ audio if voice is configured. Deeper conversation and personal context may be limited until the LLM is available.
```

## 3.4 Mood / Life Context Conversation

Examples:

```text
I'm exhausted and want some relaxation.
I feel restless tonight.
```

Flow name:
  Mood and life-context conversation.

User entry:
  Command:
    `pockedio`
  User input:
    The user shares mood, energy, situation, or asks what to listen to from that state.

Examples:

```text
I'm exhausted and want some relaxation.
I feel restless tonight.
I had a heavy day and need something quiet.
I'm a little grumpy, what should I listen to?
```

Preconditions:
  The input is not an explicit playback command like `play...`.

Processing display:

```text
Thinking...
Reading your context...
```

Use `Reading your context...` only when weather, Calendar, diary, taste, or memory context is enabled and relevant.

Main output:
  Text reply first, then ask before station building or playback.

Output shape:

```text
[Acknowledge the user's state in one sentence.]
[Suggest a listening direction in one or two sentences.]
[Ask whether to build/play a station.]
```

Example:

```text
> I'm exhausted and want some relaxation.

I hear you. Let’s keep it low-pressure: warm, slow, and uncluttered, something that lets your body stand down without demanding attention.

Want me to build a calm five-track station for this?
```

Example with light context:

```text
> I'm exhausted and want some relaxation.

That sounds like a long day, and with Guangzhou this humid tonight, I’d keep the music soft and breathable rather than dense. I’d aim for gentle ambient, quiet piano, and warm downtempo.

Want me to build a calm five-track station for this?
```

Rules:

- Reply to the emotion or situation first.
- Do not say `I built a five-track station for...` before the user confirms.
- Do not start playback.
- Do not show the queue yet.
- Ask a clear confirmation question at the end.
- Use context lightly; do not announce raw Calendar, weather, or diary reads unless it helps.
- Do not diagnose, counsel, or over-personalize.
- Store the user’s mood/life-context message as session memory.
- Set a pending station request based on the user’s message.

User choices after output:

```text
yes / play it / sure -> 3.5 Pending Station Confirmation
no / not now         -> stay in conversation
make it softer       -> update pending station direction
more energetic       -> update pending station direction
```

Fallback if the LLM is unavailable:

```text
I can still help with the music, though my deeper conversation layer is offline right now.

Want me to search directly from your request and build a five-track station?
```

## 3.5 Pending Station Confirmation

Examples:

```text
yes
<press Enter>
no
make it softer
actually something energetic
```

Flow name:
  Pending station confirmation and refinement.

User entry:
  Command:
    `pockedio`
  User input:
    A response after Pockedio has asked whether to build or play a suggested station.

Preconditions:
  A pending station request exists from 3.4.

Processing display:

```text
Thinking...
```

Use no visible spinner for simple confirm/decline. Use `Thinking...` when interpreting a refinement or answering a question.

Decision map:

```text
Enter / yes / sure / play it    -> build and play pending station
dj / dj mode                    -> play a spoken DJ opening, then start station
no / not now                    -> clear pending station, stay in conversation
make it softer                  -> update pending station, ask again
more energetic                  -> update pending station, ask again
what kind of tracks?            -> answer, keep pending station alive, ask again
actually play jazz for work     -> replace pending station with explicit playback request
```

Confirmation output:

```text
> <press Enter>

Reading your context...
Building a station...
Starting playback...
```

Decline output:

```text
> not now

No problem. We can keep talking, or you can point me toward a different mood.
```

Refinement output:

```text
> make it softer

Got it. I’ll keep it softer and more spacious.

Play this version?

Press Enter to play it, type "dj" for a spoken DJ version, or tell me how to adjust it.
```

Question output:

```text
> what kind of tracks would it include?

Mostly warm ambient, slow instrumental pieces, and soft downtempo.

Play this version?

Press Enter to play it, type "dj" for a spoken DJ version, or tell me how to adjust it.
```

DJ-program choice:

```text
> dj

Reading your context...
Building a station...
Preparing DJ voice...
Starting playback...
```

Rules:

- Empty Enter means consent only when a pending station exists.
- Empty Enter outside pending confirmation should not start playback.
- Do not generate a station for refinements until the user confirms.
- Do not show queue before confirmation.
- Keep the pending station alive after refinements and questions.
- Clear the pending station after confirmation, decline, explicit playback replacement, or session exit.
- A new explicit playback request replaces the pending station and routes to 3.7.
- `dj` is only a shortcut when a station is pending. It means spoken opening plus normal station playback.

## 3.6 Station Building And Playback Start

Flow name:
  Station building and normal playback start.

User entry:
  Command:
    `pockedio`
  User input:
    Confirmation from 3.5 or explicit playback from 3.7.

Preconditions:
  Pockedio has a station request to build and play.

Processing phases:

```text
Thinking...
Reading your context...
Building a station...
Starting playback...
```

Main output:

```text
[Short station framing.]

Queue:
1. Track - Artist
2. Track - Artist
3. Track - Artist
4. Track - Artist
5. Track - Artist

Now playing: 1. Track - Artist
[>...................] 00:00 elapsed

Mina's note:
[One concise note about why this track starts here.]
```

Track-start rule:

```text
Every time a track starts, show:
  Now playing
  elapsed bar
  selected DJ name plus note
```

The DJ note should be text in normal station mode and should use the selected DJ name in the label, for example `Mina's note:`. It should sound warm and first-person. It may mention one useful angle:

- why the track fits the user request
- how it fits the station arc
- taste/personality signal
- recent context such as weather, Calendar, or diary summary
- song background when known

Rules:

- Keep each DJ note concise.
- Do not speak the DJ note by default.
- Do not delay playback to generate a long intro.
- Do not show long track biographies.
- Use track rationale as the fallback note when richer context is unavailable, but rewrite it as a first-person recommendation.
- Show DJ notes when the first track starts, on manual `next`, and on auto-advance.
- Previous, next, pause, resume, and favorite controls belong to 3.9 and 3.11.

DJ program mode:

```text
dj
play it as a DJ program
```

This should be explicit. In the first implementation, DJ program mode prepares one spoken opening, starts the first song quietly under that DJ voice, then hands off to normal-volume playback. Later versions may prepare a spoken break for each next song while the current song is playing. Normal station mode should remain text-first and fast.

## 3.7 Explicit Playback Request

Examples:

```text
play some jazz for deep work
put on something for a rainy commute
```

## 3.8 During-Playback Conversation

Examples:

```text
This reminds me of college.
Why did you pick this?
I feel calmer now.
```

## 3.9 Playback Controls

Examples:

```text
next
stop
pause
resume
```

## 3.10 Queue And Status Questions

Examples:

```text
what's playing?
show queue
what's next?
```

## 3.11 Feedback Actions

Examples:

```text
more like this
less like this
I like this
don't play this again
save this vibe
```

## 3.12 Explicit DJ Audio Request

Examples:

```text
make me a short DJ intro
say something before the next track
```

## 3.13 Unknown / Fallback Conversation

Use when the request is unclear, unsupported, or not actionable as music control.

## 3.14 Session Exit

Examples:

```text
quit
exit
Ctrl+C
```
