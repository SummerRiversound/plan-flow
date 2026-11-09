# Plan Flow

**English** | [한국어](README.ko.md)

A [Claude Code](https://claude.com/claude-code) mod that shows the plan of the work Claude is doing, right inside Claude Code. A small model of the mod's own watches the session from the side and lays the work out as stages, tasks and checkpoints, and you watch it move: a live tree above the prompt while it works, and a flowchart in a side drawer when you want the whole picture.

![The plan tree above the prompt: stages, the tasks under them, and the running step with what it does](docs/images/en/band.png)

## Quick start

At the prompt of a Claude Code session:

```text
/plugin marketplace add https://github.com/SummerRiversound/plan-flow.git
/plugin install plan-flow@plan-flow
```

Then ask Claude for any task that takes more than a couple of steps. A plan appears above the prompt within a few seconds and follows the work as it goes. Type `/flow` to open the flowchart.

## What you see

- **The tree above the prompt.** The plan's title, one dim line on what the work is for, and a progress bar, then the stages with their tasks. The running step is bold and shows one sentence on what it does and why. When Claude waits on you (a question, a permission, or a turn that ended with work left and no background agents, workflows or shells still running; while they run the line says so in plain text), a blue-violet `● Waiting for your answer` shows under the progress bar and the running step takes the same colour. Finished stages fold to one line, and the tree keeps to 10 rows around the current step, so it never pushes your conversation away. Press the title (`▴`) to shrink it to the title, that line and the progress bar, and again (`▾`) to open it. `Flowchart ▸` on the right opens the drawer. When the plan is done, the tree folds to its title, that line and the full progress bar and stays until the next plan starts; press the title to open it.
- **The flowchart in the drawer.** `/flow` opens it beside the conversation. Each stage is a box; steps that run at the same time sit side by side and join again below. Boxes unfold one level at a time, and the drawer follows the running step until you scroll. In a narrow drawer, or with `List view`, the same plan shows as an indented list. On the desktop app and in the editor, the tree and the drawer are set in the app's own type: each stage is a rounded card joined by lines, the progress bar is a real bar, the drawer scrolls by itself, and the step Claude is on takes the focus.
- **Links to what each step produced.** A step can carry its pull request, issue, commit, artifact or file, shown in the drawer as short names that open on click.
- **Steps only you can confirm.** Some steps need you: trying something on a phone, signing in, a judgement call. They wait for your check without holding the progress back, and they are listed together under the progress bar. Press one in the drawer to mark it `Checked`, or press `Discuss` to start a message about it in the prompt box.
- **A closing note.** When every step is done, the drawer ends with what the plan was for and how that was reached.

![The flowchart in the drawer: stage boxes, two branches running side by side, links under the steps that produced them](docs/images/en/drawer.png)

## How the plan follows your session

The board follows the work of the whole session, not each message:

- More work on the same task joins the current plan, under the stage it continues; a new stage is added only for a new part of the work.
- A detour (say, a quick bug fix in the middle) puts the current plan on a shelf, and it comes back when the detour is done. The shelf sits at the bottom of the drawer; press a parked plan to see its steps.
- Starting over cancels the current plan.
- A step that has to be redone opens again and is marked `↺` until it is done.
- Work Claude goes on with without asking is a step, the review, merge or release that follows the request included. Work after the plan that waits on your go-ahead or on someone else (say, a merge you decide on, or review comments still to come) hangs dim and dotted after the last stage, two at most. It does not count towards progress, becomes a step when it starts, and stays after the plan finishes.
- A new task after a finished plan starts a new plan. The finished one stays listed at the top of the drawer and named on one line above the prompt, so a glance shows everything the session did; when the work goes back to it, it comes back as the plan in hand.

The mod's planner decides which of these fits, from your messages, the calls Claude makes and what Claude says. When a plan starts or its goal changes, and again after each answer that followed work, a copy of the conversation asks Claude to design it: the goal as the end you are after, and the stages the whole way there. The working conversation never sees the board: nothing is added to what it reads, so the mod does not change how it works.

## Options

Set them on the install screen, or later in `/config`.

| Option | Default | What it does |
| --- | --- | --- |
| `language` | `auto` | The language of the tree, the drawer and the notices: `en` or `ko`. `auto` follows Claude Code's own language setting, then the system locale, then English. |
| `autoShow` | on | Shows the tree as soon as a plan starts. Off, it shows only after you type `/flow`. |

## Try it without a task

`/flow demo` walks through sample boards: a plan with parallel branches, a long plan, added and reopened steps, a detour, blocked and skipped steps, a finished plan. `/flow demo next` moves on and `/flow demo stop` ends it. Your own board is not touched.

## What it reads and keeps

The mod writes no files and works only through Claude Code's own hooks. It adds no tool, and nothing to what Claude reads.

- **Keeps** the board of your 20 most recent sessions in Claude Code's storage for this mod, so a session that resumes finds its plan again. A board holds the step titles, details, notes and links Claude wrote. Beside it go the mod's last 50 model calls for that session (when, which call, how long it took, how it ended, how many tokens it used), so a board that stopped changing can be explained.
- **Asks a small model (Haiku) to keep the board**: when you send a message, after every 6 calls that change something, once a minute while Claude only reads, when Claude says something between its calls, and when Claude answers; while Claude works, looks are at least 20 seconds apart. A look that fails is tried once more 15 seconds later. It sends the board, your message, one line per tool call, a subagent's included (what the call says it is for, the file it touches or the pattern it searches, marked when it failed; never file contents or command output), one line per notice Claude gets (a background task finishing), the start of what Claude says between its calls and the start of Claude's answer. These calls go through Claude Code's own model access, outside the session's cost total, and take a few thousand tokens each, most of them cached.
- **Asks a copy of the conversation to design the plan**: when the planner starts a plan or changes its goal, once Claude has taken the message, and again after each answer that followed work; an answer with no tool call behind it, such as a question explained, asks nothing. The copy is the session's own conversation with the board and one question after it, run with no tools; its answer reshapes the board and goes nowhere else. It runs beside the small model's looks, never holding them up; the mod stops waiting for it after two minutes, and drops an answer that comes after the plan was replaced. It reads the conversation from the session's cache, so one costs about as much as one of Claude's own requests.
- **Watches tool calls** to show what Claude is doing (for example `Running Edit`) and for the lines above. It never changes or refuses a call.
- **Reads** Claude Code's `language` setting and the `LC_ALL`, `LC_MESSAGES` and `LANG` environment variables, only when `language` is `auto`.
- **Checks for a newer version**: it lists the folder its installed copy sits in, and once a day reads `.claude-plugin/plugin.json` from this repository on raw.githubusercontent.com. When a newer copy is installed or released, the band's title line says so. Setting `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` skips the network read.
- **Fills your prompt box** only when you press `Discuss` on a step; nothing is sent until you send it.

## Requirements

Claude Code 2.1.318 or later, with mods (function-hook plugins). Mods are in early access, and their API may change between releases. The tree and the drawer are drawn for the terminal; the desktop app and the editor extensions get the same views.

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

To see how the board served a real session, `bun scripts/review.ts` lists the sessions with a saved board, and `bun scripts/review.ts <session>` has Opus score the board the person last saw, against the bar its user set while using it and the decisions in `.claude/CLAUDE.md`. Add `--replay` to run the side planner again over the session's transcript, subagents' calls included, and score that board too, which shows what a change to the planner's rules does to the same session. The page also lists the session's recorded model calls. The page and the scores land in `.scratch/review/`; models are called through `claude -p` on your own sign-in. `bun scripts/review-all.ts` scores every saved session five at a time and gathers the scores into `.scratch/review/index.html`; `--limit N` takes only the newest N and `--replay` is passed through.

## Support

If Plan Flow helps you, you can [buy me a coffee](https://ko-fi.com/riversound). Thank you!

## License

[MIT](LICENSE)
