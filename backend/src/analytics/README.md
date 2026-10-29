# Analytics

## DO 2026 cumulative extension

`do2026/cumulative.ts` evaluates independent confirmed period recaps. Automatic
pooling of the five candidate monthly streams (K5-R23/24/25/26/37) is suspended:
complete months do not establish compatible samples, methods or observation windows.
Supported profiles require a declared cumulative source; unknown profiles remain
unavailable. Neither mean monthly percentages nor scores become an annual result.

`period_recaps` is separate persistence, with source attestation and revision checks.
An exact manual recap supersedes but is never added to monthly records, even old
V1 history. `missingMonths` describes standalone monthly observations;
`requiredMissingMonths` and `dataComplete` describe the selected measurement source.
`scoreComplete` may remain false for a complete measurement without a defined rubric.
These completeness fields describe arithmetic only. DO results explicitly expose
`assessmentComplete=false`, `completionScope=ARITHMETIC_ONLY` and unverified observation
validity. New count inputs are integer-validated at write boundaries; estimated source
denominators retain decimals. Historical scalar arithmetic is unchanged.

Live cumulative datasets include recaps; frozen snapshot paths return before any
live recap lookup. Recap-only V2 dispatches into DO evaluation and blocks official
submission. Annual arithmetic means stay unavailable for DO; the explicit annual
measurement is exposed at `GET analytics/period-recap?year=2026&endMonth=12`.
The frontend recap mutation uses shared scoped invalidation so cached Sheet7 and
trends reload together. See `docs/pkp-2026/18-rekap-kumulatif-dan-tahunan.md`.
`reporting-policy.ts` also holds all new 2026+ submissions and verifications, including
V1-only inputs. Existing verified workflow snapshots keep their status and arithmetic;
API/export disclose that workflow verification is not regulatory approval.

## Legacy and shared infrastructure

AnalyticsModule exports AnalyticsService and uses the globally provided Core DbService.
Authorization is performed by the controller; worker callers must pass an already
authorized, explicit healthCenterId to sheet7(healthCenterId, year, quarter).
All tenant-owned reads are scoped to a concrete tenant. Dinkes must select a tenant;
only Dinkes can request dashboard compare=true, which explicitly iterates active tenants.

No Redis or precomputed cache is used. Each dataset is read in a repeatable-read
database transaction. Trends read twelve independent monthly datasets, not an
atomic year-wide snapshot.

## Scoring

ILP_2026_V1 uses four-decimal internal scores and two-decimal response metrics.
The scorer's target argument is a percentage, matching OperationsService.saveMonthly:
HIGHER = min(100, (achievement / denominator * 100) / target * 100).
BINARY uses achievement >= target, accepts any nonnegative finite achievement,
and returns only 0 or 100. All polarities require positive denominator and target;
zero always means NO_TARGET, including binary. Unknown versions/tiered IDs fail 400.
Lower generic thresholds use indicator.targetNumeric * 100, never a penalty curve.
Bracket comparisons use unrounded Decimal ratios so rounding cannot move a boundary.
Categories are >=91 Baik, >=81 Cukup, otherwise Kurang, with null preserved.

## V1 Periods And Aggregation

Sheet 7 uses January through quarter*3. ANNUAL uses quarter 4's exact quarterly
lock, never a monthly period 4 or a different quarterly lock. Population and annual
target counts are prorated by quarter/4. Monthly trends use annual population and
target /12 (the operations compatibility basis). Both monthly and YTD prorated
population and target counts use the exported prorated helper and round to four
decimal places before scoring, matching operations monthly storage precision.
Numerators are summed only from present records. Missing months are not zeros:
an indicator without every covered month has a null score. No explicit target or
zero population, target count, or target percentage gives NO_TARGET.

Each section averages its direct indicator group and its child section groups
equally. Each cluster averages its top sections equally; the overall value is
the mean of five cluster slots. Null groups are excluded, not converted to zero,
and missing groups/indicators make the result incomplete. Partial values and
categories are descriptive only: aggregateStatus=PARTIAL and isOfficial=false.
Only a complete VERIFIED exact-period snapshot is official.

SUBMITTED and VERIFIED datasets are read solely from schemaVersion=1 operations
snapshots (healthCenter, sections, indicators, targets, records). Missing or invalid
protected snapshots fail 409 rather than silently recomputing from live master data.
Monthly trends prefer each month's exact protected monthly snapshot. Otherwise,
they select the smallest SUBMITTED/VERIFIED quarter whose YTD coverage contains
that month, scoped to the same tenant and year. Snapshot identity is validated
against the selected lock's actual period. Such sources are labelled
SUBMITTED_QUARTER_SNAPSHOT or VERIFIED_QUARTER_SNAPSHOT. Monthly statuses inherit
the protective quarter status; this is not individual monthly verification and
the arithmetic monthly trend remains isOfficial=false. Frozen per-month master
metadata is included in indicator trends; the summary indicator metadata is the
latest available definition. Records' persisted scores are recalculated from the
frozen inputs under the explicitly supported scoring version.

Annual trend averages use only complete months, with null if none exist. Indicator
averages use populated scored months only. These arithmetic averages are labelled
and must not be presented as the cumulative official annual Sheet 7 result.
Monthly submitted counts count complete indicators in SUBMITTED/VERIFIED locks,
not merely saved drafts. Output numeric arrays and categories are nullable, unlike
the legacy mock frontend types. No frontend changes are included here.
