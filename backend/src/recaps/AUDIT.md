# Period recap audit format

`PERIOD_RECAP_SAVED.details.previous` and `.value` are the previous and new
recap revisions in the same transaction as the write. Ordinary aggregate recaps
retain `structuredInput: null` (older absent fields are also accepted).

For the six structured annual profiles (PME, RTM, LROA, semester survey, TB
and leprosy cohorts) and the 193 `DO_SOURCE_ASSESSMENT_V1` source assessment
contracts, each non-null `structuredInput` audit value is an envelope:

```json
{
  "format": "RECAP_LEDGER_CHUNKS_V1",
  "sha256": "<64 lowercase hexadecimal characters>",
  "complete": true,
  "ledger": {
    "kind": "PME_ANNUAL",
    "year": 2026,
    "participations": { "count": 101, "chunks": ["<first 100 entries>", "<last entry>"] }
  }
}
```

The example chunk strings are placeholders: actual chunks are arrays of original
entry objects. Every ledger collection (`participations`, `meetings`,
`recommendations`, `months`, `semesters`, `cohorts`) becomes `{count, chunks}`.
The fixed-small contracts use exactly 12, 2 and 2 entries respectively; the TB
`cohort` object and all other root scalars/objects stay unchanged.
Chunks preserve entry order, contain
at most 100 entries, and number at most 10 for the accepted 1000-entry limit. Empty
collections have `count: 0, chunks: []`. Kind, year and entry scalars are unchanged.
Concatenate chunks and replace each collection wrapper with that array to restore
the exact stored JSON value, including historical whitespace in string values.

Source assessments have no root arrays. Their `period`, `values`, `context`,
`provenance`, `attestation` and optional nested objects remain unchanged in
`ledger`; nested references are not converted to collection chunks. This uses
the same envelope and digest contract, not a new audit version. An assessment
with schema-valid but incomplete context, or an unresolved source rule, may
have a null measurement while retaining a complete audit payload.

`sha256` covers UTF-8 compact JSON of the restored ledger, with object keys sorted
recursively in JavaScript lexicographic order; array order is unchanged. It covers
the ledger only, not the envelope or other recap fields. Object key insertion
order and original HTTP JSON formatting are not part of the digest contract.

Both revisions are schema- and derived-N/D-validated before claiming `complete: true`. Validated
entry strings are at most 2000 characters, object fields are below 100 and nested
values remain below audit depth 12. Thus the unchanged global security sanitizer
(100 array entries/object fields, 4000-character strings, sensitive-key redaction)
does not truncate this representation. The digest key deliberately uses `sha256`,
not a sensitive-key name. No generic raw JSON or sanitizer bypass is introduced.

`complete: true` describes retained payload integrity, not clinical eligibility,
external verification of evidence references, or official approval. Source
assessment context and provenance remain user attestations. The 28 input-only
contracts do not gain a combined measurement or performance score from auditing.

Unexpected/malformed non-null stored payloads block replacement before any write
or audit event, including on ordinary aggregate profiles. Analytics preserve the
raw payload as `recapStructuredInput` and refuse to compute from an unexpected
aggregate-profile payload (`INVALID_STRUCTURED_INPUT`, `dataComplete: false`).
Older audit events that were already truncated are not repaired by this format;
only events carrying this envelope claim complete ledger history.

XLSX/PDF exports remain provisional measurement summaries with N/D, definition
source, recap revision/notes and arithmetic/assessment context. They do not export
ledger entry references, all nested source assessment references, or audit
envelopes. Authorized JSON recap/report paths may retain the structured payload.
Evidence stays in the existing authorized paths; this change adds no broader
report disclosure. Submitted/verified historical snapshots are not replaced by
live recaps. See the [2 November contract](../../../docs/pkp-2026/25-penerapan-seluruh-kontrak-do-2026-11-02.md)
for source assessment scope, precision, availability and deployment limits.
