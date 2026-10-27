# Operations Contract

`OperationsModule` imports the global `CoreModule` and exports `OperationsService`.
`MastersModule` supplies shared indicator/section mutation routes; Operations
supplies their reads and the tenant operational routes below.

All routes require the application's authentication guard. Mutation roles are
enforced both through `@Roles` and service checks. DTO validation rejects unknown
properties, null optional values (except `evidenceId`), invalid UUIDs, non-finite
numbers, duplicate bulk indicator IDs, and batches exceeding2000 entries.
Indicator IDs/section codes are natural string keys, not UUIDs; encode each path
segment. Tenant/user/resource IDs remain UUIDs.

## Tenancy And Users

Tenant operations call `tenantFor`. Dinkes must provide `healthCenterId` explicitly
except when listing health centers or audit logs, where omission means all tenants.
Puskesmas actors may omit their tenant but cannot select another tenant.
User lists are tenant-scoped and paginated. All user responses use a safe select;
password hashes and session/token details are never returned. Admins can edit only
PIC users, never themselves or other admins. Role, username, password, and tenant
changes are not accepted by PATCH. NIP is editable. Status changes invalidate existing sessions.
Passwords require at least 12 characters and use Argon2id; usernames are required
for both user creation routes. DELETE `/users/:id` soft-deactivates to `INACTIVE`.

POST `/users/:id/reset-password` accepts `{healthCenterId?,newPassword,reason}`.
An admin may reset only their own tenant's PIC; Dinkes may reset admin/PIC accounts
in an explicitly selected tenant, never another Dinkes. No peer-admin or self
reset; use `/auth/change-password` for yourself. Password12..256 characters and a
trimmed nonblank reason1..1000 are required. The transaction increments
tokenVersion, revokes all target sessions and audits target/role/reason without
passwords, hashes or tokens. Response: `{id,username,sessionsRevoked}`.
Self-service recovery/forgot-password is unavailable and not planned, per the
explicit user requirement.

Dinkes alone creates/archives centers; admins may edit their own center profile.
DELETE `/health-centers/:id` sets `isActive:false`, preserves history and revokes
tenant sessions. Only Dinkes creates years, edits cutoff, locks/unlocks, deletes,
or selects the active year. See [active period contract](../../ACTIVE_PERIOD.md).
DELETE `/master/years/:year` returns409 for the active year or
if targets, assignments, records, periods, recommendations, uploads or export jobs
referencing that year; otherwise it deletes the year and audits the operation.

## Response Shapes

- Catalogue: `{ items, total, page, limit }`. No page/limit returns the complete matching active catalogue; `klasterId=0` means all clusters. Section filters match exact codes or dot-delimited descendants. Pagination maximum500.
- User and audit lists: `{ items, total, page, limit }`; page defaults to1 and limit to50 (maximum500).
- Sections, years, health centers, assignments, periods, recommendations: arrays.
- Annual targets: `{ healthCenterId, year, items }`; each item includes `indicator`, target fields, `source: PERSISTED | DEFAULT`, and `hasExplicitTarget`.
- Monthly records: `{ healthCenterId, year, month, denominatorMode, items }`; each item includes `indicator`, record fields, `source: PERSISTED | MISSING`, `isMissing`, `hasExplicitTarget`, and `isAssignedToMe`. Missing numerators and metrics are null, not zero.
- Bulk writes: tenant/period identity plus `updated`, `assigned`, or `locked` count. Monthly writes also report `syncStatus: NOT_SYNCED`.
- Single creates, updates, and workflow transitions return the persisted resource.

These values are the controller payloads; the core response interceptor supplies
the application's standard outer response envelope.

## Catalogue And Targets

Both `ADMIN_PUSKESMAS` and `DINKES_ADMIN` have POST/PATCH/DELETE routes at
`/master/indicators[/:id]` and `/master/sections[/:code]`. This is deliberately one
GLOBAL catalogue across all tenants, not tenant-owned copies. DELETE soft archives;
PATCH `isActive:true` restores. GET defaults to active indicators in active
sections; optional `includeArchived=true` on indicator/section GET is manager-only.
Archive active descendants/indicators before their section; restore parent first.
Section PATCH accepts name/order/isActive, not identity or hierarchy changes.

Indicator PATCH accepts optional `expectedUpdatedAt` (stale returns409). Once any
monthly record references the indicator, changes to klasterId, sectionCode,
targetNumeric, totalSasaranDefault, targetSasaranDefault or polarity return409:
create a new indicator ID/version instead. scoringVersion is server-managed;
formulaRaw is inert metadata. Mutations are audited, may affect draft/live reports,
and never rewrite protected snapshots. Archived keys remain reserved.

Seed upserts existing sections/indicators with `update: {}`, preserving manual
labels/edits/archive state. The initial272 indicators are a baseline, not a runtime
constant; active catalogue counts and submit requirements are dynamic. Section
active migration `20261019000000_section_is_active` has been deployed; deploy all
migrations in other environments. Optional annual rollover is not implemented.

Annual target writes acquire the year row lock, reject any submitted/verified
tenant period in that year, reject locked annual targets, and reject affected
indicators with existing monthly records (409). This avoids silently stale scores
without introducing an unsupported rescoring path. `targetSasaran` is derived as
`totalSasaran * targetPct / 100`, rounded to four decimals; a supplied value must
match. Bulk persistence and audit are atomic.

## Monthly Scoring And Evidence

Monthly writes acquire `lockYear` before `assertWritable`. PICs may read the complete
tenant catalogue but can write only assigned indicators, checked inside the same
transaction. An explicit persisted annual target is mandatory.

Compatibility mode is `ANNUAL_DIVIDED_BY_12`: both annual population and target
population are divided by 12 and rounded to the schema's four-decimal precision.
`calculateScore(indicator, achievement, monthlyPopulation, annualTargetPct)` is
imported from `../analytics/scoring`. Zero population, target population, or target
percentage yields null metrics. Every edit resets sync status; no fake remote sync
is reported.

Evidence must be READY/ATTACHED, have a finalized etag, and match tenant/year/month.
Successful attachment sets ATTACHED. Omission retains the existing attachment;
explicit null clears it. Integrations owns object existence/finalization and signed
object immutability; Operations never signs or overwrites stored objects.

## Workflow And History

Month periods cover a single month. Quarter periods are year-to-date (months 1
through `quarter * 3`). All transitions acquire the year lock and reject a locked
year, including verification. Submit accepts DRAFT/REVISION_REQUIRED only; verify
and revise accept SUBMITTED only; reopen accepts VERIFIED only. Verify/revise/reopen
require `expectedRevision`; submit accepts it optionally. Every
transition increments revision. Revise requires `revisionNote`, reopen `reason`.

Submission requires all active indicators to have explicit targets and non-null
scored records for every covered month, then locks every annual tenant target.
An existing verified child period does not prevent quarter submission. Submission
stores a complete JSON snapshot of tenant metadata, catalogue/version/polarity,
section hierarchy, targets, monthly values/scores, period identity, actor and
server timestamp. Verification retains that snapshot. Subsequent transitions keep
the previous snapshot in full audit details, bypassing only the core audit
helper's array truncation (never including credentials).

Revision/reopen rejects overlapping other submitted/verified periods with409 and
dependency IDs by default; the explicit Dinkes cascade option below invalidates
dependencies atomically without rewriting historical snapshots.

Recommendations restrict Dinkes feedback and tenant-admin action plans to their
respective editable fields. All recommendation writes respect year locks. Audit
reads exclude PICs and support ISO `from`/`to` timestamps.
# Workflow Dependencies and Default Targets

Reopen requires `expectedRevision` and `reason`; revise requires `expectedRevision`
and `revisionNote`. Both are Dinkes-only. By default, overlapping submitted or
verified periods return HTTP 409 with a top-level `dependencies` list. This list
includes the transitive overlap closure, including monthly periods connected
through a quarter. Set `cascadeDependencies: true` to atomically transition those
dependencies to `REVISION_REQUIRED`, increment revisions, clear verification,
and preserve each complete previous snapshot in an append-only audit with actor,
reason and cascade origin. The response retains the PeriodLock fields and adds
`invalidatedPeriods` entries containing `id`, `status`, and `revision` (empty when
no dependencies were invalidated). Stored snapshots are retained until resubmit.

Annual target defaults expose `rawTargetNumeric` in catalogue units. Default
`targetPct` is `round4(targetSasaranDefault / totalSasaranDefault * 100)` when
population is positive, otherwise0; it is not derived from polarity thresholds.
These are previews, not accepted targets. Monthly entry and submission still
require explicitly persisted targets.

## Latest Verification

Latest reported results:16 default backend tests (including new section archive
tests) and the frontend build passed. Eight new real-DB API subtests passed in a
separate run after correcting the fixture. The two older backend suites passed
in the run where the new fixture still failed; a fully passing latest combined
backend run is not yet claimed.

The final `node tests/master-browser.e2e.mjs` run from the repository root passed
the entire flow with a clean console: Admin/Dinkes global CRUD, cross-center
visibility, managed PIC reset, old-session revocation, old-password401/new-login200,
and archive cleanup. This standalone suite is not yet in the combined browser
runner. This documentation-only update does not rerun tests.

The8 focused master tests and5 operations tests are outside the default
`test/*.test.ts` glob. Run explicitly with working directory **backend/**:

```bash
npx tsx --test src/master/masters.test.ts src/operations/operations.service.test.ts
```
