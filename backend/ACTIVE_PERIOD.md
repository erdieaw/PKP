# Active Period API Contract

All paths below are relative to `/api/v1`. Responses use the existing success
envelope; the JSON examples below describe its `data` field. Authentication is
required for all these endpoints.

## Bootstrap and Deployment

Deploy the new `20261019010000_active_period_settings` migration after existing
migrations. It adds `YearPeriod.provinceEnabled` (default false) and the singleton
`PeriodSettings` with id 1, activeYear null and revision 0. No existing year is
guessed or automatically selected. The prior province migration is unchanged.

**A DINKES_ADMIN must deliberately select an existing year through PUT
master/active-year before period writes or province remote reads can proceed.**
Neither creating a year nor running the seed activates one. Re-running the seed
preserves both the selected year and all province switches. A missing singleton
also fails closed for writes; normal deployment must create it via migration.
There is no API to clear the selection once configured.

## Year Management

- `GET /master/active-year`: available to every authenticated role.
- `PUT /master/active-year`: DINKES_ADMIN only, enforced in controller and service.
- `GET /master/years`: existing descending array of years; now each includes
  `provinceEnabled: boolean`. Use `/master/active-year` to determine selection.
- `POST /master/years`, `PATCH /master/years/:year`, and
  `DELETE /master/years/:year`: DINKES_ADMIN only. Existing request fields remain
  unchanged. Province switch changes go through PUT active-year only.

GET and PUT active-year return exactly:

```json
{"year":2026,"provinceEnabled":false,"revision":1}
```

The initial GET returns:

```json
{"year":null,"provinceEnabled":false,"revision":0}
```

PUT requires all three fields, with native JSON numbers/boolean:

```json
{"year":2026,"provinceEnabled":true,"revision":0}
```

`year` is an integer 1..9999 naming an existing year; `provinceEnabled` is a
boolean; `revision` is the last GET revision (integer 0..2147483646). Null, omitted
fields, unknown fields and wrong types are rejected with 400. An unknown year
returns 404; stale revision returns 409. On success the revision increments,
including same-year/same-switch requests. Reload state after 409 rather than
blindly retrying. Pointer and the destination year's province switch update in
one transaction. Each year's old switch is retained when switching away, but
the PUT body always supplies the intended destination switch. Locked years can
be selected; selecting does not unlock them.

Year configuration metadata remains manageable for inactive years by Dinkes.
The selected year cannot be deleted; referenced years also cannot be deleted.

## Province Contract

Existing tenant authorization is unchanged: province config, mappings, test,
catalog and preview require own-tenant ADMIN_PUSKESMAS. Dinkes controls the global
year and switch, not another tenant's province credentials.

`GET/PUT /bridge/config` responses additionally include:

```json
{"activeYear":2026,"provinceEnabled":true,"periodRevision":1}
```

Existing config `revision` remains the **tenant config/mapping** revision, not
the global period revision. Never substitute `periodRevision` in config or
mapping PUT bodies. Mapping GET and successful test/catalog/preview responses
also include this metadata. `activeYear` is nullable only when unconfigured.
Every province response retains `readOnly: true` and `canWrite: false`.

Config GET/PUT and mapping GET remain available when disabled or unconfigured.
Config PUT only stores credentials locally; it does not authenticate remotely
or synchronize data. Changing identity can invalidate old mappings as before.

Test, catalog, preview, and mapping PUT return 409 without contacting the portal
when no active year is selected or its province switch is false. Remote reads
check the active state and global revision before and after the request. A
switch, disable/re-enable, or any period PUT in flight invalidates the result
with 409, even if the final selected year is unchanged. Mapping replacement
rechecks under the singleton lock before committing. Preview checks again after
loading local records. These guards do not claim to cancel a request already
sent to the remote portal; they prevent accepting its stale result.

Preview POST body is now exactly one of:

```json
{"operation":"TARGETS"}
```

```json
{"operation":"MONTHLY","month":2}
```

`month` is required for MONTHLY, integer 1..12. `year` has been removed and is an
unknown field (400). The server derives all local reads from the active year;
the response `localYear` equals `activeYear`. Existing `remoteYear: null` and
remote-year/formula warnings remain: enabling reads does not prove remote year
or scoring equivalence. No province data-write endpoint is enabled.

`GET /bridge/status?healthCenterId=...` retains tenant authorization
and returns `healthCenterId`, `activeYear`, `provinceEnabled`, `periodRevision`,
`enabled` (equal to provinceEnabled), `status` (READ_ONLY or DISABLED),
`readOnly: true`, `canWrite: false`, and a reason. Legacy bridge sync remains
unavailable (503), regardless of the province switch.

## Historical Data and Write Locking

Historical local reads, reports and downloads remain available. Every existing
`lockYear` writer first locks the singleton, rejects a null/different selected
year (409), then locks the requested year and applies existing lock rules.
`allowLocked` does not bypass the active-year requirement. A concurrent switch
waits for an already-locked writer; a writer starting after the switch sees the
new selection and rejects historical writes. Storage finalization derives its
year from the persisted upload and rechecks before committing; READY/ATTACHED
idempotent reads remain available. Action-plan writes derive their year from
the existing recommendation. No caller-supplied replacement year is trusted.
