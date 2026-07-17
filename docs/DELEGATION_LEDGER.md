# Delegation ledger — model × effort × task-type, measured

Discipline (owner request 2026-07-17): EVERY delegation names its **model + effort**
explicitly, with a one-line rationale, and is **measured** (duration, tokens, outcome) so we
build a solid base to optimize model choice per case. No silent "I'll delegate" — the model
and effort are a conscious, documented decision.

## How to read
- **effort**: the reasoning-effort tier passed (xhigh/high/medium/low), or `n/a` if the engine
  has no effort knob.
- **cost basis**: `forfait` (Codex Pro / Claude subscription — no per-token charge) vs
  `token` (metered) vs `quota` (a burnable quota the owner wants used, e.g. agy/Gemini).
- **tokens/dur**: from the task-notification `<usage>` when available. Codex detached tasks
  report the rescue-wrapper usage, not the real task — marked `~` when partial.
- **quality**: subjective, judged against the other models on the SAME task when comparable.

## Known engine facts (the base itself)
- `codex --model gpt-5.6-luna --effort xhigh` — forfait Pro, reliable. Default for delegated
  intelligence. [[codex-delegation-models]]
- `codex --model gpt-5.3-codex-spark --effort xhigh` — forfait, lighter/faster tier.
- ⛔ `codex --model gpt-5.5` — **stalls in silent backoff** (heavily rate-limited OpenAI side);
  not a hard quota, just dead air. Do NOT use for a task that must complete. Use luna.
- `codex --model gpt-5.6-sol --effort xhigh` — token-metered; used when owner says quota is back.
- `codex --model gpt-5.6-tera` — does NOT exist on this account (silent fallback to luna).
- `claude` agents (Agent tool `model: opus|sonnet|haiku|fable`) — Claude subscription; opus =
  Opus 4.8 (strongest, most credits), fable = Fable 5. Effort not settable via the Agent tool.
- `agy -p <prompt> --model "Gemini 3.5 Flash (High)" --output-format json` — **one-shot,
  headless, NOT an exploring agent**. Burnable quota. MEASURED FIT (2026-07-17 eval on an open
  design-review task = BAD): headless `-p` auto-denies tool permissions (`command`, then `mcp`)
  → empty output; adding `--dangerously-skip-permissions` makes it WANDER the filesystem
  (`ls`, scratch) instead of answering. Cost: >300k input tokens for 0 usable review across 3
  tries. CONCLUSION: agy fits **bounded extraction where the full input is provided via `@`
  refs and no exploration/verification is needed** — exactly its existing engine-C grille role
  (`lib/grille-agy-cli.ts`, `bench/run-agy-normes-bench.ts`). Do NOT use agy for open review or
  multi-step acquisition. To evaluate it properly, run the grille bench, not a review.

## Log

| date (UTC) | model | effort | cost | task-type | task | dur | tokens | quality / outcome |
|---|---|---|---|---|---|---|---|---|
| 2026-07-17 | opus (Opus 4.8) | high | forfait | design-review | geo-4a effet_densifiant lane | ~5.5min | 135.6k | ⭐ excellent — found the readEntries cross-field hole + AVANT guard + dual-key bug, grounded in code |
| 2026-07-17 | codex gpt-5.6-luna | xhigh | forfait | design-review | geo-4a lane (2nd opinion) | ~4min | ~ | ⭐ strong — converged with Opus independently; sharpened idempotence/ledger |
| 2026-07-17 | codex gpt-5.5 | xhigh | forfait | design-review | geo-4a lane | 22min→killed | — | ⛔ FAILED — silent backoff, 22min dead air, cancelled |
| 2026-07-17 | fable (Fable 5) | n/a | forfait | design-review | graphify typed-linking capability | ~5min | 126.7k | ⭐ excellent — caught partition-scoping hole, cite-grounding precedent, occurrences.json empty stub |
| 2026-07-17 | codex gpt-5.6-sol | xhigh | token | design-review | graphify capability (4th, find-what-others-missed) | froze @18s | — | ⛔ NO OUTPUT — log froze 18s in (mid file-read), companion later lost the job. Same failure class as 5.5. |

## Reliability insight (2026-07-17)
The **Codex-companion detached path failed 2 of 3 recent long reviews** (5.5 stalled 22min; sol
froze 18s in + job lost). luna succeeded once. The **Claude Agent path delivered 2/2** (Opus,
Fable) reliably and with the sharpest findings. RULE: for a LONG, high-value review, prefer a
Claude agent (opus/fable); use Codex companion for shorter delegated coding where a stall is
cheap to retry. Always wrap detached Codex with `scripts/codex-await.sh`, but expect losses.
| 2026-07-17 | agy Gemini 3.5 Flash (High) | high | quota | design-review | graphify capability (5th, eval agy) | 3 tries | >300k in | ⛔ BAD FIT for review — headless auto-denies tools → empty; skip-perms → wanders FS. Suited only to bounded @-input extraction (its grille engine-C role). Eval it via the grille bench instead. |
