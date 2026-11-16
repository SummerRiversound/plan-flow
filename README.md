# Plan Flow

**English** | [한국어](README.ko.md)

A [Claude Code](https://claude.com/claude-code) mod that shows what a session is doing, right inside Claude Code. Each request you send becomes a chapter with what came of it, and under the latest one sits what is left, by who moves next: you, Claude, or someone else. Glance at a tab and you know what the session is for, where it stands and whether it waits on you.

## Quick start

At the prompt of a Claude Code session:

```text
/plugin marketplace add https://github.com/SummerRiversound/plan-flow.git
/plugin install plan-flow@plan-flow
```

Then send Claude a request. Its chapter shows above the prompt at once, and after Claude answers, the board is written again from the whole session. Type `/flow` to open the session chapters: every request, and every other session's state.

## What you see

```text
Payment webhook retries ▴                                         Show all ▸
A failed payment notifies the customer only once
2 ✓ Replace the retry queue  → Queue replaced, 48 tests pass
3 ◐ Apply review comments  → Three comments applied, CI passes
  Your turn
  ◐ Retry three times or five?
  ◐ Try one payment on staging
  Claude goes on with
  ○ Merge once it is checked
```

- **The band above the prompt.** The session's subject and one dim line on what it is for, then the latest three chapters: `✓` done, `○` not done, `◐` when the latest waits on you, each with its result after `→`. Under the latest chapter go the pull requests opened or merged and the releases made in it, with their links, then what Claude is doing right now while it works (the chapter's mark turns meanwhile), and `N background tasks running` while agents, workflows or shells it started still run. Last comes what is left: `Your turn` in blue-violet (a question Claude asked in a dialog and has no answer to yet, a check only you can make), `Claude goes on with`, and `Waiting on others` (a reviewer, CI). It keeps to 10 rows, dropping older chapters first. Press the title (`▴`) to fold it to the title and that line, and again (`▾`) to open it. `Show all ▸` on the right opens the drawer.
- **A note when you come back.** Three minutes after Claude answers with nothing new from you, a short note sits above the band: how the latest request ended, what it produced, and what waits on you. It goes away as soon as you type or send a request.
- **The session chapters in the drawer.** `/flow` opens them beside the conversation: every chapter of the session, oldest first, each with your request, its result and its links, which open on click. What waits on you is gathered at the top, and the latest chapter also lists what is optional and what Claude said it did not check. `↻` in its head has the board written again at once from the whole session.
- **All sessions.** At the end of the drawer, every other session you ran in the last day, one row each: `◐` in blue-violet when it waits on you, `●` while it works, a green `✓` when it is done, then its subject and how long ago that changed (`3m ago`). Those waiting on you come first, then those at work, then the rest, newest first.
- **A notification when something waits on you.** When a session's board newly has something for you (a question in a dialog, a check only you can make), plan-flow raises one notification with the session's subject and that item, never twice for the same item. The desktop app holds it a minute and drops it if you come back to the session first; a terminal shows it at once through your notification setting. Sending a request in that session takes it back.
- **On the desktop app and in the editor** the band and the drawer show the same rows in the app's own type, with links as links.

## How the board follows your session

A new request starts a new chapter, named by your words until the board is written again; a bare go-ahead (`ok`, `go on`) stays in the chapter before. Between writes, rules add what is certain the moment it happens: a new chapter, a pull request opened, marked ready or merged, a release, a question Claude asks in a dialog, background work starting and finishing.

After an answer that followed work, a model of the mod's own (Sonnet) reads the whole session again and writes the board anew: the subject, the goal, each chapter's title and result, and what is left. The working conversation never sees the board: nothing is added to what it reads (unless you turn on `statusBlock`), so the mod does not change how it works.

## Options

Set them on the install screen, or later in `/config`.

| Option | Default | What it does |
| --- | --- | --- |
| `language` | `auto` | The language of the band, the drawer and the notices: `en` or `ko`. `auto` follows Claude Code's own language setting, then the system locale, then English. |
| `autoShow` | on | Shows the band as soon as you send the first request. Off, it shows only after you type `/flow`. |
| `enabled` | on | Runs plan-flow in each new session. Off, a session starts with no board and no model calls until you type `/flow on`. |
| `statusBlock` | off | An experiment. On, Claude is asked, through one section of its system prompt, to end each answer that followed work with a short `<status>` block: what the answer achieved, what waits on you, what it goes on with, what waits on others and what it did not check. The board reads the block at once into the latest chapter until the board is next written; the block stays visible in the answer. Off, nothing is added to what Claude reads. |

`/flow off` turns plan-flow off in the current session only: the band and the drawer go away and no model is called. `/flow on` turns it back on and writes the board again from the whole session. The choice survives `/reload-plugins`. `/flow status` says whether it is on here, whether `statusBlock` is on, and how many tokens its recent board writes used.

## Try it without a task

`/flow demo` walks through sample boards: a session at work, the same session after an answer and when you come back to it, a finished session, and one waiting on background work. `/flow demo next` moves on and `/flow demo stop` ends it. Your own board is not touched.

## What it reads and keeps

The mod writes no files and works only through Claude Code's own hooks. It adds no tool, and nothing to what Claude reads unless you turn on `statusBlock`.

- **Keeps** the board of your 100 most recent sessions in Claude Code's storage for this mod, so a session that resumes finds its board again. A board holds the subject, goal, chapter titles, requests (cut to 200 characters until the board is written again), results, links and what is left, as the model wrote them, plus the dialog questions still open and the background work still running. Beside it, for the 20 most recent sessions, go the mod's last 50 board writes for that session (when, how long it took, how it ended, how many tokens it used), so a board that stopped changing can be explained. For the drawer's list of all sessions, each of your 20 most recent sessions also keeps one line: its subject, whether it waits on you, works or is done, how many things wait on you, and when that changed; `/flow off` removes the session's line.
- **Asks Sonnet to write the board**: after an answer that followed work, three minutes after an answer when something happened since the last write, when you press `↻` in the drawer, and when a resumed session has no board yet; writes start at least 30 seconds apart, except for `↻`. It sends the session as short lines: your messages, what Claude says, one line per tool call, a subagent's included (what the call says it is for, the file it touches or the pattern it searches, marked when it failed; never file contents or command output), the questions Claude asks in a dialog with your answers, and one line per notice Claude gets (a background task finishing), the newest 200,000 characters. These calls go through Claude Code's own model access, outside the session's cost total.
- **Watches tool calls** to show what Claude is doing (for example `Running Edit`), and reads the output of `gh pr create`, `gh pr merge`, `gh pr ready` and `gh release create` for the pull request and release they made. It never changes or refuses a call.
- **Reads** Claude Code's `language` setting and the `LC_ALL`, `LC_MESSAGES` and `LANG` environment variables, only when `language` is `auto`.
- **Checks for a newer version**: it lists the folder its installed copy sits in, and once a day reads `.claude-plugin/plugin.json` from this repository on raw.githubusercontent.com. When a newer copy is installed or released, the band's title line says so. Setting `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` skips the network read.

## Requirements

Claude Code 2.1.318 or later, with mods (function-hook plugins). Mods are in early access, and their API may change between releases. The band and the drawer are drawn for the terminal; the desktop app and the editor extensions get the same views.

## Update and uninstall

```sh
claude plugin marketplace update plan-flow
claude plugin update plan-flow@plan-flow
claude plugin uninstall plan-flow@plan-flow
```

An update applies after a restart. See the [changelog](CHANGELOG.md) for what each version changed.

## Development

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which Claude Code writes the first time it loads the mod from this folder, so run `claude --plugin-dir .` once before type-checking with `tsc -p .`. The look is described in [DESIGN.md](DESIGN.md), and releases follow [RELEASING.md](RELEASING.md).

To see how the board served a real session, `bun scripts/review.ts` lists the sessions with a saved board, and `bun scripts/review.ts <session>` has Opus score the board the person last saw, against the bar its user set while using it and the decisions in `.claude/CLAUDE.md`, beside what the board's writes cost. The page also lists the session's recorded board writes. The page and the scores land in `.scratch/review/`; models are called through `claude -p` on your own sign-in. `bun scripts/review-all.ts` scores every saved session five at a time and gathers the scores into `.scratch/review/index.html`; `--limit N` takes only the newest N.

## Support

If Plan Flow helps you, you can [buy me a coffee](https://ko-fi.com/riversound). Thank you!

## License

[MIT](LICENSE)
