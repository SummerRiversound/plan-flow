# Changelog

All notable changes to this mod. Versions follow `version` in `.claude-plugin/plugin.json`; installed copies update when it changes.

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
