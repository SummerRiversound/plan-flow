---
version: alpha
name: plan-flow terminal
description: A session's requests drawn inside Claude Code's terminal, each with what came of it and what is left, in plain text with three colours that mean something — green for done, red for an error, blue-violet for what waits on you.
colors:
  success: "#5cc072"
  error: "#ff6b80"
  waiting: "#b1b9f9"
  text: "#e8e6e3"
  muted: "#9a968f"
  surface: "#0f0e0d"
typography:
  body:
    fontFamily: terminal monospace
    fontSize: 1em
    fontWeight: 400
    lineHeight: 1
  title:
    fontFamily: terminal monospace
    fontSize: 1em
    fontWeight: 700
    lineHeight: 1
spacing:
  cell: 1
  indent: 2
  band-rows: 10
  pane-columns: 53
components:
  chapter-row:
    textColor: "{colors.text}"
    typography: "{typography.body}"
  chapter-row-latest:
    textColor: "{colors.text}"
    typography: "{typography.title}"
  chapter-row-done:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  mark-done:
    textColor: "{colors.success}"
    typography: "{typography.body}"
  row-your-turn:
    textColor: "{colors.waiting}"
    typography: "{typography.title}"
  row-error:
    textColor: "{colors.error}"
    typography: "{typography.body}"
  result:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
---

# plan-flow terminal

## Overview

The board is the session's requests: one chapter per request the person sent (a bare go-ahead stays in the chapter before), each with what came of it, and under the latest what is left by who moves next. It is drawn in two places: a band above the prompt with the latest chapters, and the long list of every chapter in the `/flow` side drawer. It should read like a table of contents: calm, dense, factual. A chapter's mark is its state: `✓` done, `○` not done, `◐` the latest waits on the person, a turning mark while Claude works on it. The target drawing is in `docs/design-reference/terminal/`.

## Colors

Three colours, each with one meaning; everything else is plain text or muted. All are Claude Code theme keys, so light and dark themes follow the user's setting; the hex values are the dark-theme reference.

- **Success (#5cc072, `success`):** the `✓` of a done chapter and of a done session in `모든 세션`, and in the note for a person coming back the `✓` of a chapter that finished.
- **Error (#ff6b80, `error`):** the dot of the activity line when the turn ended in an error.
- **Waiting (#b1b9f9, `permission`):** what waits on the person: the `내 차례` heading and its `◐` items, the `◐` of the latest chapter while something waits on them, the drawer's `◐ 내 차례 N:` line, the `◐` of another session waiting on the person in `모든 세션`, and the activity line while a question or a permission dialog is open (`● 답변 기다리는 중`). The colour Claude Code gives its own permission prompts, so it reads as your turn.
- **Text (#e8e6e3, `text`):** chapter titles, items, links and receipts; bold for the subject, the latest chapter and group headings.
- **Muted (#9a968f, `inactive`):** chapter numbers, `→ results`, the goal, the `○`, `·` and `?` marks, the drawer's labels (`요청`, `결과`) and rule, the note's frame.

## Typography

The terminal's own monospace font; only weight varies. Every label comes in English and Korean; the Korean ones are quoted here. Bold marks the subject, the latest chapter and group headings. Hangul takes two cells, everything else one.

## Layout

All sizes are terminal cells. The band takes at most 10 rows and the rows the engine gives it; past that the least needed rows go first: the chapter before the one before, then what others and Claude do, then the rest of the goal and the chapter before; the subject, the latest chapter, what Claude is doing and what waits on the person stay longest. Rows under a chapter sit 2 cells in. The drawer is 53 columns when docked at 45% of a 120-column terminal; its text wraps to its width, a chapter's request and result under their own start beside a label column as wide as the longest label.

## Elevation & Depth

None. Hierarchy comes from indentation and weight, not shadows or boxes.

## Components

- **Band title:** the session's subject in bold (the writer's title, else the first request's words), a muted `▴` (open) or `▾` (folded); pressing the title or its arrow folds or unfolds the band, there is no fold button. `[ 전체 보기 ▸ ]` sits at the right edge as the band's main action: a primary button, in the accent colour in the terminal and the app's own primary button on the desktop; a newer version's notice sits before it and gives way first, then the title gives way. The band sits above every other plugin's band above the prompt.
- **Goal:** one sentence on what the session is for, muted, up to three rows while the band is open, one when it folds; the drawer shows all of it.
- **Chapter row:** number (muted), mark, title, then in the band `  → result` muted, cut with `…` where the row ends. Done chapters other than the latest read muted with their green `✓`; the latest is bold. The band shows the latest three.
- **Turning mark:** while Claude works the latest chapter's mark turns (`⠋⠙⠹…`, a frame each 100 ms); between turns it stands still as its state mark. On the desktop app and the editor it is a small turning circle, a picture that turns by itself.
- **Receipts and links:** under the latest chapter in the band (one row, ending in muted `+N` for what does not fit), under every chapter in the drawer (as many rows as they need): `↗ PR #142 머지됨  ↗ 릴리스 v1.4.2  ↗ 이슈 #139`, each a link where it has a target. A PR shows once, as the last thing done to it in the session (`열림`, `리뷰 준비`, `머지됨`).
- **Activity line:** under the latest chapter while Claude works or waits in a dialog, `● ` then what it is doing (`Bash 실행 중`), the dot in text colour, the permission colour while a question or permission is open, red after an error. Background work still running reads `백그라운드 작업 N개 진행 중` in plain text, while Claude works and after its turn ended.
- **What is left:** under the latest chapter, grouped by who moves next, each group a bold heading and its items: `내 차례` (heading and `◐` in the permission colour; open dialog questions first, then what the answer left to the person), `Claude가 이어서 할 일` and `다른 사람을 기다림` (muted `○`). The drawer adds `선택 사항` (muted `·`) and `Claude가 확인하지 못한 것` (muted `?`).
- **Note for a person coming back:** three minutes after an answer with no input, a note sits above the band: `╭ 자리 비운 동안` in bold, then down a muted `│` how the latest chapter ended (green `✓` when done, muted `·` otherwise), its receipts and links, and every `◐` item that waits on the person, closed by a muted `╰ 입력하면 평소 판으로 돌아가요`. It goes away when the person types or sends a request, and does not show when it would leave the band fewer than three rows. On the desktop app it is a box with a faint rounded edge and no frame characters.
- **Drawer:** the head holds the subject in bold with `[ ↻ ]` flush right (the writer reads the whole session again at once, and a toast says whether the board was written), the whole goal, a bold `◐ 내 차례 N: a · b` line in the permission colour when something waits on the person, the activity line, then a muted `┄` rule. Then every chapter, oldest first, a blank row between: its row, `요청` and `결과` with their text, its receipts and links, and under the latest every group of what is left. The engine scrolls the drawer; nothing in it follows or pins. The drawer's title is `세션 목차`.
- **모든 세션:** at the drawer's end, after a muted `┄` rule and a bold `모든 세션` heading, one row per other session whose line changed in the last day: its mark (`◐` in the permission colour when it waits on the person, `●` in text colour while it works, green `✓` when done, muted `○` otherwise), its subject, and muted how long ago the line changed (`방금`, `3분 전`, `2시간 전`); the subject is cut before the time is. Sessions waiting on the person first, then working, then the rest, newest first within each. Rows do nothing on press. With no other session the section is not drawn. The drawer is drawn again every 30 seconds while open, so the other sessions' rows keep up.
- **Notification:** not drawn by the mod: when the board newly has an item waiting on the person, one native notification headed by the session's subject with the first new item as its text.
- **Band and drawer on the desktop app and the editor:** the same rows set in the app's own type, not monospaced lines: the subject semibold (heading size in the drawer), the goal and everything under a chapter in footnote size, links and receipts as small underlined names, `↻` and `전체 보기 ▸` as native buttons. On the desktop app the band's title row is pressable end to end and lights under the pointer; the editor keeps the title as a plain button. Chapters are set apart by space instead of the rule and blank rows.

## Do's and Don'ts

- Do keep colour to green for done, red for an error and the permission colour for what waits on the person; the latest chapter stands out by weight, not colour.
- Do put the number and mark first on every chapter row and the result last.
- Do animate only while Claude works, and only the latest chapter's mark.
- Don't use literal colors in code; use theme keys. The exceptions are on the desktop app and the editor: the turning circle, a picture that cannot read theme keys and follows the viewer's light or dark scheme, and the note's edge and the title row's pointer highlight, one neutral grey at low opacity that holds on either theme.
- Don't show elapsed times, progress bars or counts of steps.
- Don't let the band grow past the rows it is given; drop the least needed rows, with no hint row.
