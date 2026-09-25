# AI Consequence Clock™

Open, auditable measurement of publicly verifiable AI consequences.

**Preview URL (intended):** https://aimodularity.com/ai-consequence-clock

This folder is a Milestone 0/1 starter: a public page, a methodology page, a sourced seed dataset, and an implementation proposal that answers section 15 of the development specification.

## Trust model

**AI discovers. Evidence verifies. Sources remain visible.**

The preview does **not** claim complete global coverage. Every headline number is computed from `data/incidents.json`. The concept render in `assets/concept-render.png` is illustrative. Those multi-million counters are not wired into the page.

## Run locally

No build step.

```bash
cd ai-consequence-clock
python3 -m http.server 4173
```

Open http://localhost:4173

If you open `index.html` as a file:// URL, `fetch` of the JSON may be blocked by the browser. Use the local server.

## What’s in the box

| Path | Role |
| --- | --- |
| `index.html` | Public clock |
| `methodology.html` | v0.1-preview rules |
| `data/incidents.json` | Seed records + source links |
| `css/clock.css` / `js/clock.js` | UI and counter derivation |
| `IMPLEMENTATION_PROPOSAL.md` | Stack, timeline, ownership, assumptions |
| `CONTRIBUTING.md` | Fork + PR / submission rules |
| `assets/concept-render.png` | Visual direction only |

## What this is not

- Not a live global incident census
- Not production data
- Not an A2SPA advertisement
- Not a transfer of brand, domain, official dataset, or canonical repo ownership

Canonical repository, production deployment, and data governance stay with AI Blockchain Ventures LLC / AI Modularity.
