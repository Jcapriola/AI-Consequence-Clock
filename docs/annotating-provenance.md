# Annotating the provenance of a source

The published rule asks for "independently published" sources and checks that by counting
publisher names. Two outlets that rewrite the same advisory have two names and one root of
evidence. Provenance lets the project count roots.

Annotating is a human judgement. No tool in this repository does it for you, and none should:
it is not inferred from titles, from dates, or from how similar two texts look.

## The rule above all others

**When in doubt, `UNKNOWN`.** A source with no annotation is already `UNKNOWN`; there is nothing
to write. An `ORIGINAL` entered on a hunch manufactures independence nobody verified, which is
exactly the error this field exists to prevent. One `UNKNOWN` too many only leaves the record
`INDETERMINATE`, which is true.

## The fields

`id` and `provenance` are optional and live inside each element of `sources[]`. When
`provenance` is present, `kind` and both lists are required and `note` is optional.

```json
{
  "id": "nvd",
  "url": "https://...",
  "publisher": "...",
  "provenance": {
    "kind": "DERIVED",
    "derives_from_internal": ["cve"],
    "derives_from_external": [],
    "note": "The entry states 'Source: MITRE' and reproduces the CVE record's description."
  }
}
```

- `id`: lowercase slug (`a-z`, `0-9`, `-`), unique within the record. Required when the
  source declares `provenance`.
- `kind`:
  - `ORIGINAL`: the source produced the evidence itself (the tribunal that ruled, the
    researcher who found the flaw, the authority that assigned the CVE). Empty lists.
  - `DERIVED`: the source says where its claim came from. At least one reference.
  - `UNKNOWN`: you do not know, or the source does not say. Empty lists.
- `derives_from_internal`: ids of other sources **on the same record**.
- `derives_from_external`: roots that are not attached to the record, written `prefix:slug`.
  Allowed prefixes: `cve`, `vendor`, `paper`, `researcher`, `regulator`, `other`. For example
  `cve:CVE-2026-30306`, `vendor:acme-blog-2026-05-12` or `paper:arxiv-2401-12345`. Keys are
  compared without regard to case.
- `note`: free text. **Every edge carries its citation here**: the sentence, link or credit in
  the source that lets you say it derives from that root. The validator does not enforce it;
  a reviewer will. If you cannot cite it, it is not an edge. It is `UNKNOWN`.

## How to decide

1. Open the source. Remembering where that publisher usually gets its material is not enough.
2. Does it say explicitly where its claim comes from (a link, a credit, "according to...")? Then
   it is `DERIVED`, and the citation goes in `note`.
3. Is it the party that produced the evidence? Then it is `ORIGINAL`.
4. Anything else: `UNKNOWN`.

If the root is already attached to the record, cite it through `derives_from_internal`. Use
`derives_from_external` only for roots that are not in `sources[]`. Two sources citing the same
external key are joined, so the key must be spelled identically in both: before inventing one,
search the file for an existing key.

## What the calculation does by itself

These joins are not annotated; `js/evidence.js` always applies them:

- Same publisher (ignoring case and extra whitespace).
- Same URL host (ignoring `www.`).

The second is conservative on purpose: two different authors on one platform read as one root.
The possible error is counting too few roots, never too many.

Derivations are followed in one direction only: from a piece of evidence up to what it rests
on. Two sources that rest on the same thing are one root. A source that only cites others, such
as a roundup listing two independent reports, does not join those reports to each other.

## Reading the result

For each record the published rule counts:

| Verdict | Meaning |
| --- | --- |
| `INDEPENDENT_CONFIRMED` | Two or more roots holding a qualifying source, and no source in those roots left `UNKNOWN`. |
| `SINGLE_ROOT` | One root holding the qualifying sources, and no source in it left `UNKNOWN`. |
| `INDETERMINATE` | A qualifying source, or a source linked to one, is unannotated or `UNKNOWN`. |
| `NO_QUALIFYING_SOURCES` | No source is graded `PRIMARY` or `INDEPENDENT_SECONDARY`. |

This figure is published beside the frozen number and never replaces it. It does not change
which records count.

## Before opening the pull request

```bash
node tests/validate-records.js
node tests/provenance.test.js
node scripts/provenance-report.js
```

The validator rejects malformed or repeated ids, provenance on a source with no id, provenance
that is not an object, a `note` that is not text, an unknown `kind`, lists that are not arrays of strings, `ORIGINAL` or `UNKNOWN` that list a reference,
`DERIVED` with no reference, references to sources that do not exist, self-references,
malformed external keys, and cycles. A `DERIVED` source whose reference cannot be found is
treated as untraced, so its record stays `INDETERMINATE`. Annotating changes a record:
increment its `revision` and add the `change_log` entry, as with any correction, then follow
CONTRIBUTING (`node tests/update-expected.js`, `node tests/export-csv.js`). Annotating never
changes a published number, only the shadow metric.
