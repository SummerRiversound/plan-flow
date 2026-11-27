# Plan Flow

Plan Flow keeps a live plan board for each agent. The board shows what the work is for, the stages on the way there with the checkpoints under them, the step the agent is on, and the steps only you can confirm. You can switch between many agents and still see where each one stands.

## What you see

- **The plan panel.** Open it from the Plan Flow pill above an agent's composer, or from the Explorer. Each stage is a card joined to the next by a line; stages that run at the same time sit side by side. The stage the agent is on is open, finished stages fold, and a progress bar counts the finished steps.
- **Steps to check.** A step that waits on you (a choice, something to try on a device, an approval) is marked to check and counted at the top of the panel.
- **A count on the workspace row.** A workspace whose agent has an unfinished plan shows how many of its steps are done, such as `3/8`.

## How it works

1. When an agent's turn ends, the plugin reads that turn from the agent's timeline: your request, each tool call in one line, and the agent's answer.
2. A small model (Claude Haiku) updates the board from it: it starts a plan for work that takes several steps, marks steps done, and follows the work when it changes direction.
3. A larger model (Claude Sonnet) reshapes the plan from a short log of the whole session when the small model left the board unchanged after work, or when the agent rests for three minutes after a turn of work. It fixes statuses, adds work that was done but not shown, and names what is left.

A question, a chat or a one-step job leaves the board as it is.

## Setup

- Claude Code must be installed and signed in on the machine that runs the Paseo daemon, as the `claude` command. Every model call goes through it, whatever provider the agent itself uses.
- Paseo 0.17.5 or later. Tested on macOS.
- There are no settings.

## Data and costs

- After each turn, the plugin sends the text of that turn to Anthropic through Claude Code under your Claude account: your request, the agent's answer, the commands and files it used, and the start of what some tools returned. A reshaping call sends a short log of the whole session in the same way.
- These calls run with no tools, none of your Claude Code settings, skills or MCP servers, and no saved session.
- They are billed to your Claude account. The small model's call costs a fraction of a cent. The larger model's calls stop for an agent once they reach $2.
- Boards are saved on the daemon machine, in `plugin-data/plan-flow/` inside the daemon's Paseo home (`~/.paseo` by default).

## Limitations

- Without the `claude` command on the daemon machine, no plan is drawn.
- Background agents are not planned.
- A reshaping call reads the newest 2,000 timeline entries of a session, so the oldest turns of a very long session are not read.
- The plan follows the language you write in.
