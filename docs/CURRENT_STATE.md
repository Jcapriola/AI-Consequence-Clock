# Current state of the preview, read from the files

Written before any product code in this branch was changed. Every number below was
computed from `data/incidents.json` at commit `1d51c76`, not recalled. The command used
is in `tests/derive.test.js`, which now enforces the same arithmetic.

## What the preview actually computes

`index.html` ships thirteen numeric slots. `js/clock.js` fills eleven of them from the
seed file, hardcodes one, and reserves one. The derivation is a single pass in
`derive()` over the ten records, filtered by `isHeadlineEligible()`, which is the
published rule: status in VERIFIED or CORROBORATED, and grade in PRIMARY or
INDEPENDENT_SECONDARY.

That filter admits exactly one record out of ten.

| Record | Status | Grade | Headline |
| --- | --- | --- | --- |
| `acc-2024-02-14-air-canada` | VERIFIED | PRIMARY | yes |
| `acc-2023-04-samsung-chatgpt` | REPORTED | INDEPENDENT_SECONDARY | no, status |
| `acc-2026-04-pocketos` | REPORTED | INDEPENDENT_SECONDARY | no, status |
| `acc-2026-06-openai-aihw` | REPORTED | INDEPENDENT_SECONDARY | no, status |
| `acc-2026-09-manus` | REPORTED | INDEPENDENT_SECONDARY | no, status |
| `acc-2023-12-17-chevy-watsonville` | REPORTED | ROUNDUP | no, both |
| `acc-2025-06-camoleak` | REPORTED | ROUNDUP | no, both |
| `acc-2025-07-18-replit-saastr` | REPORTED | ROUNDUP | no, both |
| `acc-2026-02-moltbook-supabase` | REPORTED | ROUNDUP | no, both |
| `acc-2026-03-safe-command-cve` | REPORTED | ROUNDUP | no, both |

So every headline counter on the page is currently derived from the Air Canada tribunal
decision alone. Agent-caused reads zero, because that record's `causal_role` is
`human_used_ai`. Unauthorized actions reads zero, because its `unauthorized_claim` is
the string `"false"`. Data exposures reads zero. Prompt injection reads zero. The hero
metric reads one. `data/summary.json` agrees: `eligible_record_count` is 1 and the
SHA-256 of the sorted id list matches what the page recomputes in the browser.

The methodology page already says this is intended: "The clock should look small until
primary sources are attached." That is the correct posture and this branch does not
weaken it.

## What is not derived

Three things on the page are not computed from the records, and two of them contradict
the records.

The geography card in `index.html` draws four `<circle class="dot">` elements at fixed
coordinates, commented US, Canada, Australia, Korea. Those coordinates are literals in
the markup. The legend beside them is derived from headline-eligible records only, so
the legend says Canada 1 while the map shows four red dots. A visitor reads four
geographies from a dataset that supports one. This is the exact failure
`METHODOLOGY_DIRECTION.md` legislates against in its geography rule, expressed in SVG
instead of in a field.

`days-since` is computed as `daysBetween(lastMajor.disclosure_date, "2026-09-24")`.
The second argument is a string literal. The day counter on a clock is frozen at the
date the seed file was generated and will read the same number forever. For a project
whose closest analogue is a debt clock, a hardcoded day count is the most damaging
possible defect, because it is the one number a returning visitor expects to have moved.

`kpi-reg` is hardcoded to `0` through `s.regulatory` and labelled "field reserved".
That one is honest, because no record carries a regulatory field at all.

## Every feature a visitor has today

The clock renders five top KPIs, a day counter, the hero authorization-gap metric, a
category mix list, four support KPIs, a decorative map with a derived legend, a
disclosure feed of all ten records, a canvas line chart of disclosures per month, the
public-limitation block, and a footer reproducibility line carrying the methodology
version, eligible count, checksum prefix, and eligible ids.

Six of the cards open a modal through inline `onclick="openList('...')"`. The modal
lists matching records with title, summary, status, grade, severity, the seven
differentiating fields, both dates, and source links.

What a visitor cannot do today is the whole of the brief. There is no country view. No
sector view. No vulnerability view beyond an unlabelled category mix computed from the
single eligible record. No consequence view. No view anywhere shows why a record was
excluded, so the nine excluded records appear in the feed with two status pills and no
explanation of which rule removed them. Nothing is deep-linkable: the modal state lives
only in a class on a div, so a refresh or a shared URL loses it. There is no filter, no
search, no empty state beyond a single fallback string, and no loading state other than
the word "loading…" in the timestamp slot.

## The schema as it exists

Every record carries: `id`, `title`, `summary`, `incident_date`, `disclosure_date`,
`disclosure_lag_days`, `verified_at`, `verification_status`, `evidence_grade`,
`ai_materiality`, `category`, `causal_role`, `adversary`, `authorization_evidence`,
`unauthorized_claim`, `reversibility`, `consequence_class`, `severity`, `organization`,
`sector`, `country_region`, `financial_loss_confirmed`, `financial_loss_estimated`,
`human_intervention`, `rolled_back`, `execution_auth_documented`, `sources[]`,
`source_quality_basis`, `primary_source_url`.

Distinct values actually present: five countries including the literal `"Unknown"`;
five sectors; five categories; three consequence classes; three severities.

Which counter reads which field, as written in `derive()`:

`kpi-known` is the eligible count itself. `kpi-agent` reads `causal_role` against the
agent set, correctly, per the direction document. `kpi-unauth` reads
`unauthorized_claim === "true"`, correctly separate from the hero. `hero-value` reads
`authorization_evidence === "none_documented"`. `kpi-money` sums
`financial_loss_confirmed` grouped by currency and never touches the estimate field.

Two counters OR across axes that the direction document keeps apart. `kpi-expose`
counts `category === "data_exposure" || consequence_class === "data"`, which mixes the
vulnerability axis with the consequence axis, so a prompt-injection record whose
consequence is data lands in a card labelled "AI-related data exposures".
`kpi-rollback` ORs `reversibility === "rolled_back"` against the separate boolean
`rolled_back`. Both currently read zero, so the conflation is invisible today and will
surface the moment a second record becomes eligible. The schema also carries
`execution_auth_documented` alongside `authorization_evidence`, and `rolled_back`
alongside `reversibility`, which is duplicate state that can disagree.

`derive()` also returns a hardcoded `methodology_version: "0.2.1-preview"` as its
fallback while the data file says `0.2.2-preview`. The published value wins at render
time, so this only misleads a future reader of the module.

## One defect that matters more than the counters

`CONTRIBUTING.md` invites public incident submissions, and every submitted field
reaches the DOM through `innerHTML` in `render()`, `openList()`, and the feed builder.
`i.title`, `i.summary`, `s.url`, `s.publisher`, and `i.severity` are interpolated with
no escaping, and `i.severity` is interpolated straight into a `class` attribute. A
single pull request to `data/incidents.json` carrying a crafted title executes script
on the published page, and a crafted `severity` breaks out of the attribute. For a
project whose entire value is that a stranger can trust what the page shows them,
stored cross-site scripting in the submission path is the most serious thing in this
repository. The six inline `onclick` handlers mean a Content-Security-Policy that would
have limited the blast radius cannot be added without a refactor.

The clickable cards are also `<article onclick>` with no role, no `tabindex`, and no
keyboard handler, so no keyboard or screen-reader user can open any record. The modal
has no `aria-modal`, no focus management, and no Escape binding. The canvas chart has
no text alternative.

## The gap against the brief

Jonathan's own statement of the bar is country by country, sector by sector,
vulnerability by vulnerability, consequence by consequence, each documented and sourced,
with no vendor hit list and no speculation.

Measured against that sentence, the preview delivers the trust model and the headline
rule, which are the hard parts, and none of the four axes. Country exists as a legend
beside a map that contradicts it. Sector is stored on every record and never displayed
anywhere. Vulnerability is displayed as raw snake_case category keys with no definition
of what any class means. Consequence is stored and never displayed. And the nine
excluded records, which are the most interesting thing on the page because they show
the rule working, carry no exclusion reason.

## What this branch builds, and the approach it commits to

Stay on static HTML, CSS, and JavaScript with no build step, no package manager, and no
framework, so the preview keeps running under `python -m http.server` exactly as
`README.md` documents. Derive every new number from `data/incidents.json` at request
time. Do not migrate to Astro or Next; `IMPLEMENTATION_PROPOSAL.md` puts that in a
later milestone and this contribution stays inside Milestone 1.

Concretely: extract the derivation into one module that both the browser and Node can
load without a bundler, so the arithmetic on the page is the arithmetic under test.
Build the four axis views on top of it, each splitting headline-eligible from
feed-only with the exclusion reason named. Replace the hardcoded map with geography
that cannot claim more than the sources support. Fix the frozen day counter. Escape
every interpolated field and drop the inline handlers. Make the views keyboard
reachable and deep-linkable. Attach real primary and independent-secondary sources
where the record's own `source_quality_basis` already admits one exists and the
document can actually be opened and confirmed, revision-bumped and change-logged, and
leave every record where it cannot.
