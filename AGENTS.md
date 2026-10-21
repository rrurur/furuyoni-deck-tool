# Furuyoni AI — project-wide replay and training contract (2026-10-22)

This is an authoritative carryover rule for ALL new chats, contributors, automation runs, and scripts. Do not start by guessing the UI from a recent example.

## Canonical replay format — REQUIRED
- The user-approved format is the 2026-10-21 **AP-floor replay viewer** (the board/side-panel layout of `furuyoni_ai_ap_floor_20261021_1-2_vs_3-4_seed1370_strict_v1.html`), **not** the later `ai_o_sample_replay.cjs` standalone page layout used for seed311/329.
- It must show: existing board with card images, beginning mulligan, hidden/revealed opponent cards, normal and special cards, facedown cards darkened, focus near aura, aura/life/flare, current action and history, previous/next and keyboard navigation, **persistent review text when moving steps**, user review JSON export, and AP/DP in the **same browser view**.
- Official template: `rrurur/furuyoni-timeline/public/ai-replay-canonical-v1.template.html`.
- Official adapter: `rrurur/furuyoni-timeline/tools/ai_replay_canonical_renderer.cjs`.
- New `tools/ai_o_sample_replay.cjs` HTML exports now call the canonical adapter by default. Do not silently substitute the legacy layout, build an ad-hoc UI, or redraw this format from memory.
- AP/DP should display only audited values: label anything not yet computed **unscored**, never invent numeric AP/DP or mistake-free certifications.
- The template is data-free; historical example replays are **only visual reference**, not gameplay reference.

## AI training / evaluation reset — REQUIRED
- As of 2026-10-22, the user explicitly rejects actions generated in prior chats as garbage. **Do not use historical AI-vs-AI action trajectories** from old chats, replays, screenshots, samples, or past win/loss screens as positive training targets, few-shot examples, heuristic validation, priors, rollouts to imitate, or evidence of high-quality play.
- Do not rebuild the policy by copying old AI behaviors. Old generated matches may be retained as **forensic/bug reproductions only**, clearly labeled bad/unverified and never promoted to approved policy.
- Current user-authored feedback can be used as constraints, especially `research/ai_user_review_20261022_fresh_constraints.json`; old agent-produced claims or automatically labeled “good” actions cannot.
- Exclude legacy AI selfplay from **both** positive and negative learning datasets unless the user specifically supplies new explicit evaluation of those actions. Retain human-authored rule interpretations only when confirmed by the current task or new user evaluation.
- Evaluate fresh actions with turn-level AP/DP (opportunity cost of resources), life lost/prevented, distance, response and follow-up, and both sides' plausible best responses. A card's nominal 1AP use and an unopposed AI win are NOT evidence of good play.
- Focus persists between turns. Do not consume focus merely because it is available or because a forward movement is legal. Evaluate opponent distance-dependent attack ranges; preserving a resource can dominate using it now.
- User reviewed seed311: opening fullpower `無音壁` has about -3AP and -4AP relative to opening advance; turn2 `ハガネ＋トコヨ` forward using focus needlessly closes into サイネ range and worsens their own 砂風塵 conditions.
- Special attacks may be AP-negative when required for lethal. Evaluate lethal and prevented lethal as separate dominant factors.
- Do not claim a replay is “悪手なし” unless individual actions (and strategic deck choices) have actually been independently reviewed.

## Reproducibility / preservation
- Preserve original user review text and verdicts verbatim; don't erase feedback. Latest user attachment has two explicitly reviewed bad decisions and all other decisions are **unreviewed**, not endorsements.
- For a new replay, always save the actual raw actions, seed, deck, role order, rule version, source fingerprint, and user-editable review JSON. Verify generated HTML against exact match steps and winner before publishing.
- Changes should have runnable regressions; treat untested fixes as unverified.

The production static replay examples live in this repository under `r/`. For future published replays, use the canonical builder in `rrurur/furuyoni-timeline` and preserve one consistent layout.
