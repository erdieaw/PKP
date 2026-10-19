# Analytics

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

## Periods And Aggregation

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
