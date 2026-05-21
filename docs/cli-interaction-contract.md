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
- spoken DJ station/program mode
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
- Use English by default for Pockedio's own terminal and spoken-DJ copy, even when the user writes in another language.
- Preserve song titles and artist names in their original language.
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
| Thinking...  Ctrl+C to cancel
/ Thinking...  Ctrl+C to cancel
- Thinking...  Ctrl+C to cancel
\ Thinking...  Ctrl+C to cancel
```

When the step finishes, the spinner should clear or resolve before the main output appears.

Interrupt rule:

- At the idle prompt, Ctrl+C exits the CLI session.
- During processing, Ctrl+C cancels the in-flight turn, prints `Cancelled.`, and returns to the prompt.
- If playback already started, cancellation is too late; use `stop`, `pause`, or `next`.

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

Scheduled DJ playback consent:

- At the configured Morning or Evening DJ ready time, `pockedio serve` should deliver a ready program, not auto-play audio.
- The readiness surface is: `Morning DJ program is ready.` or `Evening DJ program is ready.`
- Follow with: `Press Enter to play now, type "later" to keep it, or type "skip" to dismiss.`
- Show the expiration timestamp. MVP scheduled programs expire six hours after their configured ready time.
- Enter starts the spoken DJ intro and then the station. `later` keeps the program available. `skip` dismisses it.
- If the terminal is non-interactive, keep the program for later and do not start audio.
- The spoken DJ script must not tell the user to press play; playback consent lives in the CLI prompt.
- Write the expiry in user-readable local time, for example `Available for 6 hours, until 23:00 today.`, not as an ISO timestamp.
- After Enter, show the DJ program lineup and `Now playing` surface before or as music starts.
- After Enter, scheduled DJ should use the same ducked handoff as DJ-mode station: start the first track quietly under the spoken opening, then restore normal music volume after the voice.
- Mood check prompts must not block an upcoming scheduled DJ preparation or ready-time prompt. If a scheduled DJ prepare/play window is near, scheduled DJ wins and mood check waits.
- MVP definition: a scheduled DJ program is a short spoken host opening plus a five-track scheduled station. It is different from normal playback because it arrives at a configured time, uses morning/evening context, and starts with the selected DJ voice when FishAudio succeeds.

## Section 2: Setup Decision Tree

This section is locked to the setup surfaces currently built in the CLI.

Supported commands:

```text
pockedio setup
pockedio setup calendar
pockedio setup netease
pockedio import-taste <file>
pockedio refresh-context
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

Music provider

Music provider
  NetEase Cloud Music

Connect NetEase account now?
  Yes, scan QR
  Yes, paste MUSIC_U cookie
  Not now, use anonymous playback
```

If the user chooses account setup:

```text
Preferred playback quality
  hires - best quality, may be unavailable
  lossless - very high quality, needs support
  exhigh - best daily default
  higher - good fallback
  standard - safest fallback
  Back to account options
```

If the user chooses cookie setup:

```text
Paste MUSIC_U cookie
> ********
```

If the user chooses QR setup:

```text
Waiting for NetEase QR login...
Open and scan this QR image with NetEase Cloud Music: /Users/leonw/.pockedio/secrets/netease-login-qr.png
The QR code is valid for about 90 seconds.
Waiting for NetEase QR confirmation...

NetEase connected.
Pockedio will use your account for playback when available.
```

If QR login fails:

```text
Could not verify NetEase login.
NetEase QR login timed out.
Continuing with anonymous playback for now.
```

Then setup continues:

```text
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
Context

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

Diary usage rules:

- Diary is emotional/situational context, not direct taste memory.
- Raw diary text is never stored in SQLite.
- The latest entry is summarized once per file version and cached locally.
- Music prompts should prefer the diary listening hint over full personal detail.
- If the configured LLM is remote, summary generation may send the latest diary excerpt to that LLM.

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

The preparation offset is not shown in first setup. Pockedio stores the ready time as the scheduled play time and prepares audio 20 minutes before that time internally by default.

### Completion

```text
Setup complete
  Music            NetEase Cloud Music - account-backed (exhigh)
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
  Music            NetEase Cloud Music - anonymous
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
music provider            -> choose NetEase Cloud Music
music account QR          -> show QR image path -> poll login -> save cookie or fall back anonymous
music account cookie      -> save MUSIC_U cookie locally -> account-backed playback
music anonymous           -> clear NetEase cookie -> anonymous playback
hear DJs yes              -> open Hear DJ loop
hear DJs no               -> choose DJ directly
Hear DJ Mina/Nova         -> play preview, return to Hear DJ loop
Hear DJ Choose your DJ    -> continue to DJ choice
preview missing/fails     -> show preview fallback, continue setup
DJ choice                 -> set display name and persona preference
taste yes                 -> ask playlist link -> import taste -> continue setup
taste no                  -> continue setup
weather yes               -> ask city -> check weather -> save enabled=true + city
weather no                -> save enabled=false and do not fetch weather during context reads
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

## 2.3 `pockedio setup netease`

NetEase setup is available as a repair/change path after first setup.

```text
$ pockedio setup netease

NetEase playback
Connecting your account can reduce unavailable tracks and preview-only playback.

Connect NetEase account now?
  Yes, scan QR
  Yes, paste MUSIC_U cookie
  Not now, use anonymous playback
```

Completion:

```text
Saved
  Music            NetEase Cloud Music - account-backed (exhigh)
```

## 2.4 `pockedio setup calendar`

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

Calendar usage rules:

- Calendar is situational context, not taste memory.
- Store title, calendar name, start time, end time, and all-day flag only.
- Derive a short calendar listening hint from event count and event titles.
- Use the hint in station generation, recommendation replies, station intros, scheduled DJ copy, and context-like conversation.
- Do not read event notes, attendees, URLs, or locations.
- Do not mention calendar in every response; use it when it improves the moment.

## 2.5 `pockedio import-taste <file>`

This is not a setup subsection, but it is the current standalone import command.

```text
$ pockedio import-taste spikes/fixtures/taste-normalized.csv

Imported 128 tracks into /Users/leonw/.pockedio/taste.md.
Artists: Ryuichi Sakamoto, ...
Playlists: Deep Work, ...
```

This command expects a normalized CSV file. First setup uses a NetEase playlist link instead.

## 2.6 `pockedio refresh-context`

Use when the user wants Calendar and diary changes reflected in long-term context memory without starting playback.

```text
$ pockedio refresh-context

Refreshing context...

Calendar
  Status            available
  Events read       12
  Agenda memories   1 updated

Diary
  Status            available
  Latest file       2026-05-21.md
  Diary memories    1 updated

taste.md           /Users/leonw/.pockedio/taste.md

Context memory is ready for future stations.
```

Behavior:

- Reads Calendar using the wider context window when available.
- Reads the latest diary file only when diary context is enabled.
- Stores summarized `agenda` and `diary` memories in SQLite.
- Does not store raw diary text in SQLite.
- Scheduled DJ preparation also refreshes these memories before generating the program.

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

When I suggest a station:
  press Enter to play it
  type dj for a spoken DJ version

Controls:
  next
  stop
  show queue
  Ctrl+C exits, or cancels while processing

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
- Explain `Enter` and `dj` only as pending-station choices; they are not global commands.

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
4. Pending station confirmation or refinement
5. Explicit DJ audio request
6. Identity or capability question
7. Explicit playback request
8. Mood or life-context recommendation
9. Feedback
10. General conversation or fallback
```

Routing map:

```text
User input                       Route
quit / exit / Ctrl+C             3.15 Session Exit
next                             3.10 Playback Controls
stop                             3.10 Playback Controls
what’s playing?                  3.11 Queue And Status Questions
show queue                       3.11 Queue And Status Questions
dj, when a station is pending    3.5 Pending Station Confirmation
Enter, when a station is pending 3.5 Pending Station Confirmation
make me a short DJ intro         3.13 Standalone DJ Audio Deprecated
yes / play it                    3.5 Pending Station Confirmation, if pending
no / not now                     3.5 Pending Station Confirmation, if pending
Who are you?                     3.3 Identity And Capability Questions
What can you do?                 3.3 Identity And Capability Questions
play To Be Alone With You        3.7 Specific Song Playback
play jazz for deep work          3.8 Explicit Station Playback Request
I'm exhausted, want relaxation   3.4 Mood / Life Context Conversation
more like this                   3.12 Feedback Actions
I like this                      3.12 Feedback Actions
This reminds me of college       3.9 During-Playback Conversation
unclear input                    3.14 Unknown / Fallback Conversation
```

Processing display:

```text
Thinking...
```

Rules:

- Use the global status layer while processing LLM-routed messages.
- Obvious local commands such as `next`, `stop`, `show queue`, and `yes` should respond without a visible spinner unless they trigger a slower action.
- Do not print routing labels such as `Detected intent: mood`.
- If a pending station exists, empty Enter and short confirmations like `yes`, `play it`, `no`, or `not now` route to pending station first.
- If a pending station exists, `dj` means the 3.6 DJ-program branch, not a generic DJ-audio request.
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

Mina is here. I’m your personal DJ for this terminal. I can talk with you, read the moment, shape a station, play music, remember useful taste signals, and make a spoken DJ version when you choose it before playback.
```

Example:

```text
> What can you do?

I can listen to what kind of moment you’re in, suggest a direction, build a station, control playback, show the queue, remember what works for you, and make a spoken DJ version when you choose it before playback.
```

Rules:

- Use the selected DJ name when answering identity questions: `Mina is here.` or `Nova is here.`
- Do not repeat the startup greet `What are we tuning for?` in every answer.
- Mention core capabilities: conversation, recommendations/stations, playback controls, queue/status, useful memory, and before-playback spoken DJ station/program mode.
- Mention memory carefully: `remember useful taste signals`, not `remember everything`.
- Do not say `I am an AI language model`.
- Do not mention therapy disclaimers unless the user asks for emotional or mental-health support.
- Do not start playback.
- If ending with a question, make it specific to the user's context, not a fixed catchphrase.

Fallback if the LLM is unavailable:

```text
Mina is here. I can still build stations, play music, control playback, show the queue, and make spoken DJ station versions if voice is configured. Deeper conversation and personal context may be limited until the LLM is available.
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

Press Enter to play it, type "dj" for a spoken DJ version, or tell me how to adjust it.
```

Example:

```text
> I'm exhausted and want some relaxation.

I hear you. Let’s keep it low-pressure: warm, slow, and uncluttered, something that lets your body stand down without demanding attention.

Want me to build a calm five-track station for this?

Press Enter to play it, type "dj" for a spoken DJ version, or tell me how to adjust it.
```

Example with light context:

```text
> I'm exhausted and want some relaxation.

That sounds like a long day, and with Guangzhou this humid tonight, I’d keep the music soft and breathable rather than dense. I’d aim for gentle ambient, quiet piano, and warm downtempo.

Want me to build a calm five-track station for this?

Press Enter to play it, type "dj" for a spoken DJ version, or tell me how to adjust it.
```

Rules:

- Reply to the emotion or situation first.
- Do not say `I built a five-track station for...` before the user confirms.
- Do not start playback.
- Do not show the queue yet.
- Ask a clear confirmation question at the end.
- Always include the pending-station action line after the confirmation question.
- Use context lightly; do not announce raw Calendar, weather, or diary reads unless it helps.
- Do not diagnose, counsel, or over-personalize.
- Store the user’s mood/life-context message as session memory.
- Set a pending station request based on the user’s message.

User choices after output:

```text
Enter / yes / play it / sure -> 3.5 Pending Station Confirmation, normal 3.6 playback
dj / dj mode                 -> 3.5 Pending Station Confirmation, 3.6 DJ-program playback
no / not now                 -> stay in conversation
make it softer               -> update pending station direction
more energetic               -> update pending station direction
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
Enter / yes / sure / play it    -> 3.6 normal station building and playback start
dj / dj mode                    -> 3.6 DJ-program branch with spoken opening
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
- A new explicit playback request replaces the pending station and routes to 3.7 or 3.8.
- `dj` is only a shortcut when a station is pending. It means spoken opening plus normal station playback.
- Confirmation does not itself print queue details; queue appears only after 3.6 starts playback.
- DJ mode should be a before-playback fork, not a mid-station toggle. If the user asks for DJ mode while a station is already playing, explain that they can choose DJ mode before the next station.

## 3.6 Station Building And Playback Start

Flow name:
  Station building and normal playback start.

Built state:
  Implemented for normal station playback and before-playback DJ program mode.

User entry:
  Command:
    `pockedio`
  User input:
    Confirmation from 3.5 or explicit station playback from 3.8.

Preconditions:
  Pockedio has a station request to build and play.

Processing phases:

```text
Reading your context...
Building a station...
Starting playback...
```

Use animated status lines in interactive TTY. Do not print repeated spinner frames in non-interactive output.

Main output:

```text
[Short station framing.]

Now playing: 1/5  Track - Artist
[>...................] 00:00 / 04:13

Mina's note:
[One concise note about why this track starts here.]

Up next:
  2. Track - Artist
  3. Track - Artist

Queue:
> 1. Track - Artist
  2. Track - Artist
  3. Track - Artist
  4. Track - Artist
  5. Track - Artist
```

Track-start rule:

```text
Every time a track starts, show:
  Now playing with position count, for example 3/5
  elapsed / total bar when track duration is known, for example [===>................] 00:42 / 04:13
  elapsed-only bar when track duration is unavailable, for example [=>..................] 00:42 elapsed
  selected DJ name plus note
  Up next, when tracks remain
  full compact queue with current track marked by >
```

The progress bar is duration-aware but not continuously ticking in-place yet. It updates whenever Pockedio prints a track-start or playback-status surface, including `what's playing?`.

Station-complete rule:

```text
That station’s done. Press Enter to continue this vibe, or tell me where to take it next.
```

When the final playable track finishes, return control to the user with this closure message. Keep the finished station’s request as a pending station direction so Enter continues the same vibe, while any typed response can reshape the next station.

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
- Previous, next, pause, resume, and favorite controls belong to 3.10 and 3.12.
- Put the DJ note before `Up next` and `Queue`; it belongs to the current track, not the playlist block.

DJ program mode:

```text
dj
play it as a DJ program
```

This should be explicit and two-step. DJ program mode first prepares the spoken program, then waits for the user to start it:

```text
DJ program is ready.

Press Enter to start it, or tell me how to adjust it.
```

Only after the user presses Enter should Pockedio start the first song quietly under the DJ voice, then hand off to normal-volume playback. This avoids audio appearing from nowhere after a long generation step. It should not speak before every song. Pockedio should treat each transition as a possible DJ cue and decide whether to speak based on program pacing, meaningful mood/artist/context shifts, and the selected program length.

Default DJ program pacing:

```text
short:
  opening voice
  no automatic transition voice
  closing voice

standard:
  opening voice
  quiet first transition
  one middle transition voice when useful
  closing voice

extended:
  opening voice
  up to two transition voices when useful
  closing voice
```

If a transition is intentionally quiet, do not print a warning. Just start the next track and show the normal playback surface. If Pockedio chose a transition voice but it is still rendering when auto-advance or manual `next` happens, start the next song normally and show a tiny status line such as:

```text
Mina is still preparing the next voice break, so I’ll keep the music moving.
```

Normal station mode should remain text-first and fast.

Whenever DJ program voice is played, the terminal should also show the spoken transcript before the now-playing surface:

```text
Mina:
[spoken DJ copy]

Now playing: 2/5  Track - Artist
[>...................] 00:00 / 04:13
```

When the final playable track finishes in DJ program mode, Pockedio should play a short closing voice break before the station-complete prompt:

```text
Mina:
[short closing DJ copy]

That station’s done. Press Enter to continue this vibe, or tell me where to take it next.
```

DJ mode is not a mid-station toggle. Once normal playback starts, `dj` / `dj mode` should not retrofit spoken mode into that station. The user can stop and ask for a new DJ version, or choose DJ mode before the next station starts.

Scheduled DJ program distinction:

- Scheduled DJ uses the same five-track station engine, but the request brief is time-triggered rather than user-authored.
- Morning scheduled logic prioritizes the first useful listening arc of the day: focus, energy, weather, calendar pressure, diary state, and user taste.
- Evening scheduled logic prioritizes transition out of the workday: decompression, commute, remaining focus, weather, calendar residue, diary state, and user taste.
- Scheduled DJ is allowed to be opening-voice only for MVP. DJ-mode `standard` should remain more hosted: opening voice, quiet first transition, one useful middle transition, and closing voice.
- Scheduled FishAudio preparation may use a longer timeout, currently 10 minutes, because it runs before the ready-time prompt. Interactive DJ mode should stay tighter to avoid blocking the user.
- Scheduled DJ and DJ-mode station should share the same opening handoff behavior: voice over ducked first-track music, then normal-volume playback.

## 3.7 Specific Song Playback

Use when the user asks for one song, not a station.

```text
> play To Be Alone With You by Sufjan Stevens
Searching NetEase...
Starting playback...
Now playing: To Be Alone With You - Sufjan Stevens
[>...................] 00:00 elapsed

Mina's note:
Playing this one directly. I can keep the station door open after it lands.
```

If the title is ambiguous:

```text
> play Intro
Searching NetEase...
I found a few close matches:
1. Intro - The xx
2. Intro - M83
3. Intro - Ariana Grande

Which one?
> 2
Starting playback...
Now playing: Intro - M83
```

Rules:
- `play [song] by [artist]` plays one track.
- `play [song]` searches one track and asks if there are close matches.
- `play something like [song]`, `make a station from [song]`, or mood/use-case language remains station flow.
- Direct song playback replaces current playback and must not create a five-song queue.

## 3.8 Explicit Station Playback Request

Examples:

```text
play some jazz for deep work
put on something for a rainy commute
play songs by Sufjan Stevens
play songs from Mina Okabe
```

Artist-only playback:

```text
> play songs by Sufjan Stevens
Reading your context...
Building a station...
Starting playback...
I made a 3-track station for "play songs by Sufjan Stevens". 3 tracks are playable now.
Now playing: 1/3  Chicago - Sufjan Stevens
```

Rules:
- `play songs by/from [artist]` builds an artist-catalog station, not a single-song request.
- Keep only tracks whose listed artist matches the requested artist.
- Deduplicate repeated song titles before filling the queue.
- Do not add unrelated artists just to reach five songs.
- If fewer than five playable matching tracks are found, show the real count.

## Active Playback Interaction Map

Use when music is already playing. These are user-facing interaction options, not hidden implementation labels.

```text
User input                         Route                         Built state
what's playing?                    3.11 Queue And Status         built
what is playing?                   3.11 Queue And Status         built
show queue                         3.11 Queue And Status         built
what are we listening to?          3.11 Queue And Status         built
next                               3.10 Playback Controls        built
skip                               3.10 Playback Controls        built
next song / next track             3.10 Playback Controls        built
stop                               3.10 Playback Controls        built
pause                              3.10 Playback Controls        built with mpv; fallback stops audio, keeps session open
resume                             3.10 Playback Controls        built with mpv
previous                           3.10 Playback Controls        not built
favorite this                      3.12 Feedback Actions         not built
I like this                        3.12 Feedback Actions         built
good pick / nice pick              3.12 Feedback Actions         built
more like this                     3.12 Feedback Actions         built
keep this vibe                     3.12 Feedback Actions         built
change the vibe                    3.12 Feedback Actions         built
don't play this artist             3.12 Feedback Actions         built
never play this                    3.12 Feedback Actions         built
Who is the singer?                 3.9 During-Playback Talk      built
Tell me about this artist          3.9 During-Playback Talk      built
Tell me about [artist]             3.9 During-Playback Talk      built
Why did you pick this?             3.9 During-Playback Talk      built
This reminds me of college         3.9 During-Playback Talk      built
dj / dj mode                       3.6 DJ Program Boundary       built rejection
play something else                3.8 Replacement Station       built
play [specific song]               3.7 Specific Song Playback    built
```

Rules:

- During playback, questions and personal comments should not stop or replace music unless the user clearly asks for playback control.
- During playback, current-track and artist questions should use the LLM conversation path with current track, rationale, and queue context.
- During playback, `next` means skip current track and start the next playable track.
- During playback, `stop` stops playback and keeps the interactive session open.
- During playback, `pause` and `resume` are real controls when mpv is available; with ffplay/afplay fallback, pause stops audio and resume is unavailable.
- During playback, `dj` is not a toggle. DJ mode is chosen before playback starts.
- Replacement requests such as `play something else` may stop current playback and start a new station.

## 3.9 During-Playback Conversation

Examples:

```text
This reminds me of college.
Why did you pick this?
I feel calmer now.
Who is the singer?
Tell me about Kenny Dorham.
```

Flow name:
  Conversation while music keeps playing.

Preconditions:
  Music is currently playing.

Processing display:

```text
Thinking...
```

Main output:
  Answer in the selected DJ voice. Use current track, artist, album when available, recommendation rationale, and queue context when relevant. Do not start a new station unless the user clearly asks for playback.

Example:

```text
> Who is the singer?

That’s listed as Kenny Dorham and Joe Henderson on this track. I’d treat those credits as the reliable source here, then keep the answer focused on how their playing shapes the room.
```

Example:

```text
> Tell me about Kenny Dorham.

Kenny Dorham was a lyrical hard bop trumpeter with a warm, understated sound. In this set, his playing gives the track a relaxed but focused center.
```

Example:

```text
> This reminds me of college.

I hear that. I’ll keep this memory close to the current lane: reflective, patient, and not too crowded.
```

Rules:

- Keep music playing.
- Do not show queue unless the user asks for queue/status.
- Do not turn artist or song-background questions into playback requests.
- Resolve phrases like `the singer`, `this artist`, `this song`, and `this track` against the current playback metadata before answering.
- If Pockedio does not have verified background details, say what is known from metadata instead of inventing a story.
- Store useful personal listening comments as conversation memory.
- Keep answers concise; this is still a listening session, not a long article.

## 3.10 Playback Controls

Examples:

```text
next
stop
pause
resume
```

Built controls:

```text
next / skip / next song / next track
  -> stop current track, mark it skipped, start next playable track, show 3.6 track-start surface
  -> if the next track cannot start, show the playback detail, keep the CLI session open, and let the next `next` try the following track

stop
  -> stop current playback, mark current track skipped, keep the CLI session open

pause
  -> with mpv: pause current playback and keep the session open
  -> with afplay fallback: stop current audio and keep the session open

resume
  -> with mpv: resume paused playback
  -> with afplay fallback: say nothing resumable is paused
```

Planned controls:

```text
previous
  -> return to previous playable track
```

Rules:

- Controls should be fast and should not use the LLM.
- `next` should preserve the station and queue context.
- `next` should show the selected DJ note for the new current track.
- `pause` should not end the CLI session.
- `resume` should only claim success when a controllable paused player exists.
- If no next playable track remains, show the station-complete message.
- `previous` needs explicit implementation before being shown as a reliable control in startup copy.

## 3.11 Queue And Status Questions

Examples:

```text
what's playing?
show queue
what's next?
```

Built queries:

```text
what's playing?
what is playing?
current song
current track
show queue
where are we?
what are we listening to?
```

Main output:

```text
Now playing: 2. Track - Artist
[===>................] 00:42 / 04:13
Queue:
  1. Previous Track - Artist
> 2. Track - Artist
  3. Next Track - Artist
```

Rules:

- Status should not change playback.
- Show the current track marker with `>`.
- Use elapsed / total when duration is known.
- Use elapsed-only when duration is unavailable.
- Do not include the DJ note in status unless the user asks why the track was picked.

## 3.12 Feedback Actions

Examples:

```text
more like this
less like this
I like this
don't play this again
save this vibe
```

Built feedback:

```text
I like this / love this / good pick / nice pick
  -> record like on current track
  -> write positive taste signals for current track and artist
  -> "Noted. I will weigh this direction more strongly."

more like this / similar to this / keep this vibe
  -> record more_like_this on current track
  -> write stronger positive taste signals for current track, artist, and station direction
  -> reshape the unplayed queue around the current track when a station is active
  -> "Noted. I will stay near this lane."

less like this / less of this / not so much like this
  -> record less_like_this on current track
  -> write soft negative taste signals for current track and artist
  -> reshape the unplayed queue away from the current track when a station is active
  -> "Noted. I will ease away from this texture without banning it."

change the vibe / different vibe / switch the mood / change mood
  -> record change_vibe on current track
  -> write a negative taste signal for the current station direction
  -> "Understood. I will shift the mood."

don't play this artist / do not play this artist / never play / ban / block
  -> record ban on current track
  -> write a hard exclude taste signal for the current artist
  -> "Understood. I will avoid this in future sets."

favorite this / save this / add to best list
  -> record favorite on current track
  -> write a high-confidence local favorite taste signal
  -> "Saved locally as a high-confidence favorite signal."

save this vibe / remember this vibe
  -> record save_vibe on current station
  -> write a reusable vibe preset taste signal
  -> "Saved this vibe as a direction I can return to later."

skip / next
  -> record skip and a context-bound negative signal for current track, then advance to the next playable track
```

Rules:

- Feedback should attach to the current playing track when possible.
- `more like this` and `less like this` should keep the current track playing and reshape only the unplayed queue.
- Feedback should not create a fully new station by itself, except `skip / next` advancing within the existing station.
- Feedback should be stored twice: raw `feedback` event plus derived `taste_signals`.
- Future stations should read recent taste signals during `Reading your context...` and use them during `Building a station...`.
- Hard bans should exclude matching artists or tracks from future station plans.
- Positive seeds and favorites should bias future station planning and fallback search; only explicit queue-shaping feedback should change the current queue.
- `favorite` should not be treated as a normal NetEase favorite until account-backed collection behavior is designed.

### 3.12.1 Taste Profile Growth

`taste_signals` are the fast operational layer. They affect future stations immediately, but they should not rewrite `taste.md` after every single reaction.

`taste.md` is the slower user-readable taste contract. It should grow through explicit consolidation:

```text
update my taste profile
refresh taste.md
summarize my music taste
```

Output:

```text
Updated your taste profile.
Signals reviewed: 12
taste.md: /Users/leonw/.pockedio/taste.md
```

Rules:

- Generated content must live inside `<!-- POCKEDIO:BEGIN GENERATED TASTE PROFILE -->` and `<!-- POCKEDIO:END GENERATED TASTE PROFILE -->`.
- Pockedio must preserve all user-written text outside the generated block.
- The generated profile should summarize favorites, situational preferences, positive signals, negative signals, hard avoids, and open questions.
- Future station generation should use both `taste.md` and the latest generated taste profile.
- A single `skip` or `like` should remain a signal only until enough feedback accumulates or the user explicitly asks for profile consolidation.

### 3.12.2 Session Memory Growth

Session memory is local-first and silent by default.

Stored transcript:

```text
user input
Pockedio text response
auto-advance now-playing surfaces
station-complete message
```

Rules:

- Raw transcript rows remain in SQLite `messages`.
- Session memory is generated automatically and silently when a session ends.
- Durable summaries are stored as local `memory_items` with kind `summary`.
- Summaries should capture useful requests, listening memories, preference language, and feedback/control signals.
- Routine chatter without durable preference value should not create a summary.
- Station generation reads recent session summaries during `Reading your context...` and uses them during `Building a station...`.
- Manual session-memory commands may exist as internal/debug tools, but they should not be taught as normal listening-session behavior.
- QMD or another memory index can be evaluated later, but SQLite remains the canonical source for now.

## 3.13 Standalone DJ Audio Deprecated

Examples:

```text
make me a short DJ intro
say something before the next track
```

Output:

```text
DJ voice belongs to a station, not a loose clip. Tell Mina what kind of set you want; when I suggest it, type "dj" for a spoken DJ version.
```

Rules:

- Do not generate or play a standalone 10-15 second DJ voice clip.
- DJ voice is a before-playback fork for a pending station/program.
- If a station is pending, `dj` prepares the spoken DJ version and asks the user to press Enter before playback starts.
- If no station is pending, guide the user to describe the set first.
- Scheduled DJ jobs may still generate spoken DJ programs.

## 3.14 Unknown / Fallback Conversation

Use when the request is unclear, unsupported, or not actionable as music control.

Fallback principle:

- Normal conversation is the default.
- Do not start playback, build a station, skip, pause, or change queue unless the user clearly asks for a playback action.
- When unsure whether the user wants conversation or playback, ask one short clarifying question.
- Keep the DJ voice human: answer the user first, then lightly connect to music only when useful.

### 3.14.1 Plain Conversation

Use when the user shares a thought, mood, memory, or question that does not request music.

Input:

```text
> I'm tired today.
```

Processing:

```text
Thinking...
```

Output shape:

```text
That sounds heavy. Keep the evening low-pressure; if you want music for it, I can shape something gentle.
```

Rules:

- Do not build a station automatically.
- Do not say the sentence will be treated as taste unless the user clearly gives a lasting preference.
- Store the transcript locally; durable memory is summarized silently at session end only when useful signals exist.

### 3.14.2 Music Knowledge Question

Use when the user asks about the current artist, singer, song, version, album, credits, or song background.

Input:

```text
> Who is the singer?
> Tell me about the singer.
> What is the story behind this song?
```

Processing:

```text
Thinking...
```

Output shape:

```text
The listed artist here is Kenny Dorham, with Joe Henderson also credited on this track. Dorham was a lyrical hard-bop trumpeter, so this pick sits in a warm, late-night jazz lane.
```

Rules:

- Use current playback facts first: title, artist, album/version if available.
- Use LLM knowledge to explain background, but acknowledge uncertainty when facts are not available.
- Never answer a music-background question by starting a new station.
- Future enrichment may use Wikidata/Spotify only for factual grounding, not every turn.

### 3.14.3 Ambiguous Playback Request

Use when the wording might imply music, but the action is not clear enough.

Input:

```text
> Something softer maybe?
```

Processing:

```text
Thinking...
```

Output shape:

```text
Do you want me to reshape the pending station softer, or just talk through the mood first?
```

Rules:

- If a station suggestion is pending, treat natural adjustments as station refinement.
- If no station is pending and no explicit playback command exists, ask a short clarifying question.
- Do not surprise-start playback from ambiguous language.

### 3.14.4 Unsupported Action

Use when the user asks for something Pockedio cannot do yet.

Input:

```text
> Crossfade this into Spotify.
```

Processing:

```text
Thinking...
```

Output shape:

```text
I can't hand this off to Spotify yet. I can keep playing here, skip, pause, show the queue, or build a new station.
```

Rules:

- Say what is unavailable in one sentence.
- Offer the nearest available action.
- Do not over-apologize or expose internal implementation details.

### 3.14.5 LLM Unavailable

Use when the LLM cannot produce a usable answer.

Input:

```text
> Tell me about this song.
```

Processing:

```text
Thinking...
```

Output shape:

```text
I can see the current track is Blue Bossa - Kenny Dorham, Joe Henderson. I do not have enough detail right now to give reliable background, but I can keep the queue moving or show what is next.
```

Rules:

- Prefer current playback facts over generic command help.
- Do not invent credits, history, or meaning.
- If no track is playing, ask the user what they want to hear or talk about.

## 3.15 Session Exit

Examples:

```text
quit
exit
Ctrl+C
```

Decision tree:

```text
quit / exit
  -> stop active playback if needed
  -> save useful session memory silently
  -> end the CLI session
  -> print: Session closed.

Ctrl+C
  -> stop active playback if needed
  -> save useful session memory silently
  -> close the CLI session

stop
  -> not a session-exit command
  -> use 3.10 Playback Controls
```

Rules:

- `quit` and `exit` are explicit session-exit words.
- `stop` is a playback control, not an app exit.
- `pause` and `resume` remain playback controls and must keep the session open.
- Session exit should not run setup, build stations, or ask follow-up questions.

## Future Note: Music Knowledge Enrichment

Purpose:

- Improve DJ-style answers for artist background, song history, versions, credits, albums, genres, and related artists.
- Keep normal conversation LLM-first; enrichment should support answers, not replace the DJ conversation layer.

Candidate sources:

- Wikidata / Wikimedia APIs:
  - Treat as the first future candidate for factual enrichment.
  - Useful for open artist, album, genre, birthplace, date, relationship, and linked-entity facts.
  - Public data is open, but clients must respect request limits and identify themselves properly.

- Spotify Web API:
  - Treat as an optional future candidate for artist metadata, albums, popularity, related music surfaces, and provider-side identifiers.
  - Requires a Spotify developer app and OAuth/client credentials.
  - Do not assume it is a free public knowledge base; access is governed by Spotify developer terms, quota/rate limits, and current account requirements.

Interaction rule:

- Do not call external music-knowledge sources for every user turn.
- Use them only when the user asks factual music-background questions or when the LLM needs grounding for the current track/artist.
- If enrichment is unavailable, answer from current playback metadata and model knowledge, and acknowledge uncertainty instead of inventing facts.

Examples:

```text
Who is the singer?
Tell me about the singer.
What is the story behind this song?
Is this version a cover?
What album is this from?
Who produced this track?
```
