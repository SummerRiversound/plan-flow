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
  tint: "#3a3834"
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
  badge-your-turn:
    backgroundColor: "{colors.waiting}"
    textColor: "{colors.surface}"
    typography: "{typography.title}"
  badge-done:
    textColor: "{colors.success}"
    typography: "{typography.body}"
  rail-done:
    textColor: "{colors.success}"
    typography: "{typography.body}"
  your-turn-bar:
    textColor: "{colors.waiting}"
    typography: "{typography.body}"
  tag-your-turn:
    backgroundColor: "{colors.waiting}"
    textColor: "{colors.surface}"
    typography: "{typography.title}"
  tag-other:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  chapter-current-drawer:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.text}"
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

The board is the session's requests: one chapter per request the person sent (a bare go-ahead stays in the chapter before), each with what came of it, and under the latest what is left by who moves next. It is drawn in two places: a band above the prompt that says at a glance whose turn it is and where the session stands, and a timeline of every chapter in the `/flow` side drawer. It should read like a table of contents: calm, dense, factual. A chapter's mark is its state: green `●` done, `○` not done, `◐` the latest waits on the person, a turning mark while Claude works on it. The target drawing is in `docs/design-reference/terminal/`.

## Colors

Three colours, each with one meaning; everything else is plain text or muted. All are Claude Code theme keys, so light and dark themes follow the user's setting; the hex values are the dark-theme reference.

- **Success (#5cc072, `success`):** the `●` of a done chapter on the band's rail and the drawer's timeline, the rail's joins and the timeline's line under done chapters, the band's `✓ 끝` badge, the `✓` of a done session in `모든 세션`, and in the note for a person coming back the `✓` of a chapter that finished.
- **Error (#ff6b80, `error`):** the dot of the activity line when the turn ended in an error.
- **Waiting (#b1b9f9, `permission`):** what waits on the person: the band's `◐ 내 차례 N` badge and the drawer's `내 차례` tags as a fill behind dark bold text (`inverseText`), the `▌` bar down the band's your-turn rows with its bold `내 차례` heading and `◐` marks, the `◐` of the latest chapter on the rail and the timeline while something waits on them, the drawer's `◐ 내 차례 N:` line, the `◐` of another session waiting on the person in `모든 세션`, and the activity line while a question or a permission dialog is open (`● 답변 기다리는 중`). The colour Claude Code gives its own permission prompts, so it reads as your turn.
- **Text (#e8e6e3, `text`):** chapter titles, items, links and receipts, the `○` of a chapter not done; bold for the subject, the current chapter and the `일하는 중` badge.
- **Muted (#9a968f, `inactive`):** `→ results`, the goal, the rail's joins after the last done chapter and its older short names, the band's folded `Claude가 이어서:` and `다른 사람 기다림:` lines, the timeline's line under a chapter not done, the drawer's tags other than `내 차례`, its labels (`요청`, `결과`), the note's frame, the letters of a swept title outside its bright band.
- **Tint (#3a3834, `subtle`):** a faint fill behind the drawer's current chapter row on a terminal.

## Typography

The terminal's own monospace font; only weight varies. Every label comes in English and Korean; the Korean ones are quoted here. Bold marks the subject, the current chapter, the badges and the `내 차례` heading and tag. Hangul takes two cells, everything else one.

## Layout

All sizes are terminal cells. The band takes at most 10 rows and the rows the engine gives it; past that the least needed rows go first: the rest of the goal, then what others and Claude do, then the links, then the rail; the badge and subject, the current chapter, what Claude is doing and what waits on the person stay longest. Receipts, links, the activity line and the folded lines sit 2 cells in. The drawer is 53 columns when docked at 45% of a 120-column terminal; its timeline's line is the first column, a chapter's title starts 3 cells in and what sits beside the line 5 cells in; its text wraps to its width, a chapter's request and result under their own start beside a label column as wide as the longest label.

## Elevation & Depth

None. Hierarchy comes from indentation, weight, the badge's fill and the current chapter's tint, not shadows or boxes.

## Components

- **Badge:** before the band's title, one piece that says the session's state when the person switches tabs: ` ◐ 내 차례 N ` bold in dark text on the permission colour while anything waits on the person (open dialog questions and what the last answer left to them), `⠋ 일하는 중` bold with the turning mark while Claude works, `✓ 끝` in green when the latest chapter is done and nothing waits, and no badge otherwise (background work keeps its own line). It stays when the band folds.
- **Band title:** after the badge, the session's subject in bold (the writer's title, else the first request's words), a muted `▴` (open) or `▾` (folded); pressing the title or its arrow folds or unfolds the band, there is no fold button. `[ 전체 보기 ▸ ]` sits at the right edge as the band's main action: a primary button, in the accent colour in the terminal and the app's own primary button on the desktop; a newer version's notice sits before it and gives way first, then the title gives way. The band sits above every other plugin's band above the prompt.
- **Goal:** one sentence on what the session is for, muted, up to three rows while the band is open, one when it folds; the drawer shows all of it.
- **Rail:** on its own row under the goal, one node per chapter joined by five `━`: done chapters green `●` with green joins, the latest `◐` in the permission colour while something waits on the person, the turning mark while Claude works, plain `○` otherwise; joins after the last done chapter muted. Three cells on, the chapters' short names `1 원인 · 2 큐 교체 · 3 리뷰 반영`, muted and the current one bold; a short name is the title cut to fit, the oldest names going first, none cut below 10 cells. With more than eight chapters the rail keeps the latest eight after a muted `…`; on a narrow band the joins shorten down to one `━`. A session of one chapter has no rail.
- **Current chapter:** under the rail, the latest chapter's number and title in bold, then `  → result` muted, cut with `…` where the row ends. Older chapters are not listed on the band; the rail stands for them.
- **Turning mark and sweep:** while Claude works the latest chapter's mark turns (`⠋⠙⠹…`, a frame each 100 ms) on the rail, in the badge and on the timeline, and a bright band three letters wide sweeps its title (muted letters, the band in text colour), on the band and in the drawer; between turns the title stands still in bold. On the desktop app and the editor the mark is a small turning circle and the swept title a picture of it, both moving by themselves.
- **Receipts and links:** under the current chapter in the band (one row, ending in muted `+N` for what does not fit), under every chapter in the drawer (as many rows as they need): `↗ PR #142 머지됨  ↗ 릴리스 v1.4.2  ↗ 이슈 #139`, each a link where it has a target. A PR shows once, as the last thing done to it in the session (`열림`, `리뷰 준비`, `머지됨`).
- **Activity line:** under the current chapter while Claude works or waits in a dialog, `● ` then what it is doing (`Bash 실행 중`), the dot in text colour, the permission colour while a question or permission is open, red after an error. Background work still running reads `백그라운드 작업 N개 진행 중` in plain text, while Claude works and after its turn ended.
- **Your turn on the band:** a `▌` in the permission colour down every row of the group: the bold `내 차례` heading in the permission colour, then each thing waiting as `◐ text` (open dialog questions first, then what the answer left to the person).
- **What Claude and others do next on the band:** one muted row each, 2 cells in: `Claude가 이어서: <first>` and `다른 사람 기다림: <first>`, with ` 외 N` when there are more.
- **Note for a person coming back:** three minutes after an answer with no input, a note sits above the band: `╭ 자리 비운 동안` in bold, then down a muted `│` how the latest chapter ended (green `✓` when done, muted `·` otherwise), its receipts and links, and every `◐` item that waits on the person, closed by a muted `╰ 입력하면 평소 판으로 돌아가요`. It goes away when the person types or sends a request, and does not show when it would leave the band fewer than three rows. On the desktop app it is a box with a faint rounded edge and no frame characters.
- **Drawer:** the head holds the subject in bold with `[ ↻ ]` flush right (the writer reads the whole session again at once, and a toast says whether the board was written), the whole goal, a bold `◐ 내 차례 N: a · b` line in the permission colour when something waits on the person, and the activity line. Then the timeline: every chapter, oldest first, a dot (its mark, as on the rail) on one `│` line down the left, the line green under a done chapter and muted under one not done. Two cells after the dot, the chapter's number and title (done ones muted, the latest bold); four cells after the line, `요청` and `결과` with their text and its receipts and links; a row of bare `│` between chapters. The latest chapter's title row is tinted to the edge, and what is left branches off the line under it, `├─` and `└─` for the last: a tag saying whose it is, ` 내 차례 ` bold in dark text on the permission colour, ` Claude `, ` 다른 사람 `, ` 선택 ` and ` 확인 못 함 ` muted, padded to one column, then the item. Under the latest chapter the line runs on only to its branches. The engine scrolls the drawer; nothing in it follows or pins. The drawer's title is `세션 목차`.
- **모든 세션:** at the drawer's end, after a muted `┄` rule and a bold `모든 세션` heading, one row per other session whose line changed in the last day: its mark (`◐` in the permission colour when it waits on the person, `●` in text colour while it works, green `✓` when done, muted `○` otherwise), its subject, and muted how long ago the line changed (`방금`, `3분 전`, `2시간 전`); the subject is cut before the time is. Sessions waiting on the person first, then working, then the rest, newest first within each. Rows do nothing on press. With no other session the section is not drawn. The drawer is drawn again every 30 seconds while open, so the other sessions' rows keep up.
- **Notification:** not drawn by the mod: when the board newly has an item waiting on the person, one native notification headed by the session's subject with the first new item as its text.
- **Band and drawer on the desktop app and the editor:** the same rows set in the app's own type, not monospaced lines: the subject semibold (heading size in the drawer), the goal and everything under a chapter in footnote size, links and receipts as small underlined names, `↻` and `전체 보기 ▸` as native buttons. The badge and the drawer's tags are small filled labels in caption size: the permission colour or green behind dark semibold text, the faint grey behind the others and behind `일하는 중` with its turning circle. The rail is its characters in the app's type. The timeline's line and the your-turn bar are a thin filled box down the left of their rows, with no space between the rows so the line runs on; the dots stay characters. The current chapter's row gets the faint grey fill. On the desktop app the band's title row is pressable end to end and lights under the pointer; the editor keeps the title as a plain button. Space stands for the terminal's rule.

## Do's and Don'ts

- Do keep colour to green for done, red for an error and the permission colour for what waits on the person; the current chapter stands out by weight and, in the drawer, a faint tint, not colour.
- Do put the mark first on every chapter row and the result last.
- Do animate only while Claude works, and only the latest chapter: its mark and the sweep over its title.
- Don't use literal colors in code; use theme keys. The exceptions are on the desktop app and the editor: the turning circle and the swept title, pictures that cannot read theme keys and follow the viewer's light or dark scheme, and the note's edge, the title row's pointer highlight, the current chapter's fill and the plain tags' fill, one neutral grey at low opacity that holds on either theme.
- Don't show elapsed times, percentages or counts of steps; the rail shows where the session stands with no number beyond the chapters' own.
- Don't let the band grow past the rows it is given; drop the least needed rows, with no hint row.
