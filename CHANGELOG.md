# Changelog

All notable changes to this mod. Versions follow `version` in `.claude-plugin/plugin.json`; installed copies update when it changes.

## 0.1.37 — 2026-11-06

### Changed

- While Claude works, the planner looks at most once every 20 seconds, and what Claude said meanwhile goes with the next look, so many open sessions do not each call it several times a minute. Your messages, Claude's answers and a new plan's design are still looked at at once.

## 0.1.36 — 2026-11-06

### Changed

- Claude designs the plan: when the planner starts a plan or changes its goal, a copy of the conversation asks Claude once, after it has taken your message, for the goal as the end you are after and the stages the whole way there. The working conversation is untouched, and the copy reads it from the session's cache.
- The goal names the end you are after, not the steps, and stages ahead of the work stay on the board instead of being dropped.
- The planner hears what Claude says between its calls and looks again then, so the running step follows the work sooner.

## 0.1.35 — 2026-11-06

### Fixed

- When Claude asks you to approve, choose or say whether to go on, the planner keeps the step waiting on your answer open instead of closing the plan, so the board shows `● 답변 기다리는 중` rather than reading 100% done.

## 0.1.34 — 2026-11-06

### Changed

- When Claude waits on you, the board says so in a third colour, the one Claude Code gives its permission prompts: `● 답변 기다리는 중` under the progress bar, and the running step's mark and `답변 기다림` in place of `진행 중`. Besides an open question or permission, a turn that ended with work still open now counts as waiting, so a step no longer sits at `진행 중` without moving while Claude waits for your reply.

## 0.1.33 — 2026-11-06

### Changed

- A finished plan no longer leaves the band above the prompt after 5 seconds. It folds to its title, goal and full progress bar and stays until the next plan starts; press the title to open it. The fold you set while work runs is kept apart.

## 0.1.32 — 2026-11-06

### Fixed

- Expected work shows in the band above the prompt. It asked for three rows the band seldom had left, so it never appeared there; when rows run short it now drops its lone dotted row, then shares one row (`┆ ◌ PR 올리기 · npm 배포`).

## 0.1.31 — 2026-11-06

### Added

- Work likely to follow the plan, such as review comments once a pull request is open, hangs dim and dotted after the last stage: in the band, in the drawer's flowchart and list, and as faint cards on the desktop app. Two at most; it does not count towards progress, becomes a step when it starts, and goes when the plan finishes.

## 0.1.30 — 2026-11-06

### Changed

- `↺` shows only while a reopened step is still open; once it is done again the mark goes.
- A step that is done drops the note it carried while it waited for a check or was blocked, so a question already answered does not stay on the board.

## 0.1.29 — 2026-11-06

### Fixed

- The running step moves again while Claude works. The side planner often marked steps done without starting the next one, so no step was running and nothing was drawn as running; now, after each look, open work always has a step running.

## 0.1.28 — 2026-11-06

### Changed

- A plan's title and goal name the work by its subject, not "the current PR" or a bare number, so a glance at the board tells one session from another. When the request only says "this" or "current", the planner renames the plan once the work shows what it is about.

## 0.1.27 — 2026-11-05

### Changed

- The board keeps up with what is in progress: the planner hears which calls failed, so a failed test no longer marks its step done; it hears reads and searches and looks once a minute while Claude only investigates; it hears a subagent's calls; and a background task's notice no longer counts as your request.

## 0.1.26 — 2026-11-05

### Changed

- Claude no longer keeps the board. A small model the mod calls itself (Haiku) watches your messages, the calls Claude makes and Claude's answers, and keeps the board from the side. Nothing of plan-flow reaches Claude any more: no `plan` tool, no instruction in the system prompt, no note on your messages or on tool results, so the mod does not change how Claude works.

### Removed

- The `enforce` option, which refused edits until there was a plan.

## 0.1.25 — 2026-11-05

### Changed

- The note Claude reads with each request only says where the board stands; the cases to sort a request into sit once in the system prompt, with nothing telling Claude to update the board before working or to ask first. In a side-by-side run this cut Haiku sessions from 121 to 72 seconds.

### Added

- Press a parked plan at the bottom of the drawer to see its steps; press again to close it.

## 0.1.24 — 2026-11-05

### Fixed

- On the desktop app the band's `동시에` tag keeps its row height, and the fold arrow sits right after the plan title.
- In the desktop list view the tree lines run on beside a picked step's buttons.

## 0.1.23 — 2026-11-05

### Fixed

- On the desktop app the `동시에` tag keeps the height of its row instead of standing taller than it.

## 0.1.22 — 2026-11-05

### Fixed

- In the desktop drawer, opening a step in one of two side-by-side cards no longer stretches the other into an empty box.

## 0.1.21 — 2026-11-05

### Changed

- When Claude adds a new stage at the end of a plan that still has open work, the plan tool asks whether that work is a detour, so it gets parked and comes back instead of piling up as one more stage.

## 0.1.20 — 2026-11-05

### Fixed

- In the desktop drawer, a plan that starts or ends with stages side by side no longer draws a line hanging above or below them.

## 0.1.19 — 2026-11-05

### Changed

- Each request's board note lists the plan's stages with their ids and status, and asks Claude to put continuing work or a fix under the stage it continues, instead of adding a new stage at the end.
- When the goal is rewritten a second time, or work is added to a finished plan, Claude is told to consider closing the plan and starting a new one, so the board stays one piece of work rather than a log of the session.

## 0.1.18 — 2026-11-05

### Fixed

- In the desktop list view the `├─` guides line up with the step titles on every row. Rows are pressable end to end, and a picked step shows its detail, note and primary buttons under it.

## 0.1.17 — 2026-11-05

### Changed

- On the desktop app every pressable row of the drawer, and the band's title row, takes a click or Enter anywhere on the row and lights up under the pointer.
- A step's `확인 완료` and `논의` are primary buttons at the right, with space above them.
- A desktop drawer too narrow for the flowchart shows the list.

### Fixed

- The desktop card's title row spans the card with its count at the right edge. The fill that floated inside the card is gone.

## 0.1.16 — 2026-11-05

### Changed

- The desktop drawer's cards follow the mockup. Each title row sits on a faint fill, rows are split by hairlines and light up under the pointer, and links sit at the end of their row. Done steps are muted, and only running steps are semibold.

## 0.1.15 — 2026-11-05

### Fixed

- In the terminal drawer the box of tasks that run together is closed on its right, and a long note wraps inside it instead of running to the stage box's border.

## 0.1.14 — 2026-11-05

### Fixed

- On the desktop app the count beside the progress bar stays on one line, and cards side by side are the same height.
- `동시에` is a small pill beside each task that runs with its siblings, instead of a tag on its own line.
- The desktop list view keeps the character tree again, under the head in the app's type.

## 0.1.13 — 2026-11-05

### Changed

- On the desktop app and in the editor, the band and the drawer are set in the app's own type instead of monospaced lines. The title is a heading, the goal and details are smaller and muted, the progress bar is a rounded bar with counts beside it, and steps are indented by level.
- Drawer cards set stage titles in semibold and counts in small type. Tasks that run together sit under a small rounded tag, and links show as chips.
- The running step on the desktop shows a small turning circle beside its title.
- The desktop list view is a real indented list whose stages still fold.

## 0.1.12 — 2026-11-05

### Changed

- On the desktop app the lines between the drawer's cards show, cards side by side each fill their half, and every card lines up with the ones above and below.

## 0.1.11 — 2026-11-05

### Changed

- On the desktop app and in the editor, the drawer's flowchart is drawn with real boxes: each stage a rounded card, the running one in text colour, joined by thin lines that split and join around stages side by side. The terminal drawer is unchanged.

## 0.1.10 — 2026-11-05

### Changed

- A step no longer quietly holds several things you check one by one: the instruction asks Claude for one checkpoint per thing you check on its own, and a step that goes through 8 changes with the plan unchanged gets one note asking Claude to split it.

## 0.1.9 — 2026-11-05

### Changed

- The band folds and unfolds by pressing its title, which ends in a muted `▴` or `▾`; the fold buttons are gone. `[ 흐름도 보기 ▸ ]` sits alone at the right edge of the title line as a primary button, in the accent colour in the terminal and the app's primary button on the desktop.

## 0.1.8 — 2026-11-05

### Changed

- The band's `접기 ▴` and `흐름도 보기 ▸` are framed buttons like the drawer's (`[ 접기 ▴ ]`), a native button on the desktop app, so they read as something to press. With review-inbox 0.28.1 or later, the band sits above review-inbox's.

## 0.1.7 — 2026-11-05

### Changed

- The empty drawer says what fills it: a request that takes several steps makes Claude draw its plan there. The message wraps to the drawer's width instead of running past a narrow drawer.

## 0.1.6 — 2026-11-05

### Added

- Each plan carries a goal: one sentence on what the work is for, which Claude gives with the plan and rewrites when follow-up work widens it. The band shows it dim under the title, also when folded; the drawer's head wraps it to three rows.

## 0.1.5 — 2026-11-05

### Added

- The band's title line says when a newer plan-flow is ready: `↑ 0.1.6 installed · /reload-plugins` when a newer copy sits beside this one, or `↑ 0.1.6 is out · update in /plugin` when the repository has one. The repository is read at most once a day, and not at all when `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.

## 0.1.4 — 2026-11-05

### Changed

- Stages are named for what this task produces, not for the repo's routine: a stage name that would fit any task (setup, decision record, implement, PR) is a phase, and the issue comment, worktree, tests, commit and pull request go inside the stage they serve. A stage holding most of the tasks is split by what each part delivers.
- When a new plan has a stage named only for the routine, the tool's answer names it back so Claude renames it.

## 0.1.3 — 2026-11-05

### Fixed

- The reminder after Claude's first change no longer says the board has no plan when it holds a finished one; it tells Claude to set a new plan or add steps to the finished one.

## 0.1.2 — 2026-11-05

### Changed

- Steps are checkpoints for following where the work stands, not the edits: titles and details say what is done for the project, without file names, code or commands.

## 0.1.1 — 2026-11-05

### Changed

- The closing note sets its labels (Goal, Result, Links) in one column, wraps each text under its own start and leaves a blank row between parts.
- Claude is nudged to set a plan: each request on an empty board carries a short note, and when Claude first changes something in a turn with no plan, one line after that tool's result reminds it. Nothing is refused unless `enforce` is on.
- Stages are named for what will exist when they are done; setup and wrap-up steps go inside the stage they serve, and a stage holding a single task stays a plain step.
- Steps set without a detail are named back to Claude so it fills them in.

## 0.1.0 — 2026-11-04

First release.

### Added

- A `plan` tool Claude calls to lay out the work as stages, tasks and checkpoints, with steps that run at the same time, and to move through it step by step.
- Above the prompt, a live tree of the plan: title, progress bar, the running step with its one-sentence detail, at most 10 rows around the current step, and a button to fold it to the title and progress bar.
- `/flow` opens a side drawer that draws the plan as a card flowchart, with splits and joins for parallel steps, boxes that unfold one level at a time, and a list view for a narrow drawer. It follows the running step until you scroll.
- Steps carry links to what they produced (a PR, issue, commit, artifact or file), shown in the drawer as short names that open on click.
- Steps only you can confirm wait for your check without holding progress back, gathered on one line; pressing a step in the drawer offers "Checked" and "Discuss", which drafts a message in the prompt box.
- The board follows the session's work: added work joins the plan, a detour parks it until the detour ends, starting over cancels it.
- A finished plan ends the drawer with a closing note on what it was for and how that was reached.
- English and Korean, chosen by the `language` option, else Claude Code's language setting, else the system locale.
- Options: `autoShow` (show the tree as soon as a plan starts, on by default) and `enforce` (refuse edits until there is a plan, off by default).
- `/flow demo` walks through sample boards without touching your own.
