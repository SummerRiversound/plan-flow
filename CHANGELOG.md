# Changelog

All notable changes to this mod. Versions follow `version` in `.claude-plugin/plugin.json`; installed copies update when it changes.

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
