# AI-Judgement Review Workflow Walkthrough

This document explains the new AI-integrated workflow for human judges within the Meme Capsule `/curate` dashboard.

## Overview
The `/curate` dashboard now deeply integrates offline AI predictions directly into the human curation loop. AI Judge 4 (`user-judge4`) and AI Judge 5 (`user-judge5`) provide pre-evaluations for each meme. The human judge's role is to review these AI predictions and either adopt them or manually override them.

## The Three AI States

When a meme is loaded, the system evaluates the AI predictions and presents one of three states:

### State A: AI Consensus
- **Condition:** Both AI Judge 4 and AI Judge 5 have evaluated the meme and arrived at the exact same decision (e.g., both voted "Keep" or both voted "Exclude").
- **UI Presentation:** The panel displays "AI CONSENSUS" with a green badge. It shows the agreed-upon status, topics, tone, and humor mechanisms.
- **Curator Action:** 
  - To fast-approve the consensus: Press `Enter` or `Space`.
  - To disagree: Press `O` (Override) to switch to manual mode and curate from scratch.

### State B: AI Disagreement
- **Condition:** Both AIs have evaluated the meme, but their decisions differ (e.g., Judge 4 says "Keep" while Judge 5 says "Exclude").
- **UI Presentation:** The panel displays "AI DISAGREEMENT" with an orange badge. It side-by-side compares Judge 4 and Judge 5's analyses, including their reasoning.
- **Curator Action:**
  - To adopt Judge 4's decision: Press `4`.
  - To adopt Judge 5's decision: Press `5`.
  - To reject both and curate manually: Press `O` (Override).

### State C: Needs Eyes (Incomplete AI Data)
- **Condition:** One or both of the AI judgements are missing (e.g., the AI pipeline hasn't processed this meme yet, or only one AI successfully evaluated it).
- **UI Presentation:** The panel displays "NEEDS EYES" with a red badge, indicating that full AI consensus is unavailable.
- **Curator Action:**
  - The system defaults to Manual Override Mode.
  - The curator must use the standard Layer 0 keyboard shortcuts (`K`, `E`, `D`, `L`, etc.) to curate the meme from scratch.

## Keyboard Shortcuts Summary
- `Enter` / `Space`: Fast-approve AI Consensus (State A).
- `4`: Adopt AI Judge 4's decision (State B).
- `5`: Adopt AI Judge 5's decision (State B).
- `O`: Enter Manual Override Mode (Available in States A and B; default in State C).

When in Manual Override Mode, all original Layer 0 shortcuts apply:
- `K`: Keep
- `E`: Exclude
- `D`: Duplicate
- `L`: Review Later
- `1-9, 0, -, =`: Topics
- `Q, W, E, A, S, F`: Tone
- `Z, C, V, B, N, M, J, P, O`: Humor Mechanisms
- `Cmd/Ctrl + Z`: Undo
