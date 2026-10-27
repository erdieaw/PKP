# Read-Only Province Bridge

All routes below are under `/api/v1`, require a bearer token with role
`ADMIN_PUSKESMAS` and a non-null own `healthCenterId`. There is no tenant selector.
Service methods independently enforce the same scope. `DINKES_ADMIN` and `PIC`
are forbidden. Unknown request body properties are rejected by global validation.
Existing `/bridge/sync-batch` remains unavailable; there is no remote write API.

Every successful config/catalog/mapping/test/preview payload includes `readOnly: true, canWrite: false`. These flags
refer to province data, not the local configuration/mapping settings. Payloads
are inside the existing `{success, statusCode, data, meta}` API envelope.

## Frontend Contract

See [ACTIVE_PERIOD.md](../../ACTIVE_PERIOD.md) for the global active-year contract.
All successful config/catalog/mapping/test/preview payloads below also include `activeYear`, `provinceEnabled`, and
`periodRevision`; `revision` still means the tenant config/mapping revision.
Config GET/PUT and mappings GET remain available while the province switch is
disabled, since saving credentials is local configuration, not synchronization.
Test/catalog/preview and mappings PUT require a selected, enabled year (409
otherwise). Global period changes during remote reads or mapping validation
invalidate results (409), including disable/re-enable or switch-back races.

- `GET /bridge/config`: `{configured, hasPassword, username?, provinceHealthCenterCode?, revision, updatedAt?, connectionStatus}`. Absent config has revision 0 and status `NOT_CONFIGURED`; saved config is `UNTESTED`. Never returns password/ciphertext. Test status is not persisted or implied by saving credentials.
- `PUT /bridge/config`: `{revision, username, password?, provinceHealthCenterCode}`. First creation requires password and revision 0; subsequent updates require the last observed revision. Omitted password retains the existing encrypted password. Blank password is rejected. Response is the safe config payload. Stale/concurrent updates return 409. Changing username or portal code clears this tenant's mappings.
- `POST /bridge/test`: no body; reads saved credentials and verifies `get_current_user.user.role === 'puskesmas'` and exact nonempty string `user.puskesmas_kode === provinceHealthCenterCode`. Returns `{connectionStatus:'CONNECTED', revision, provinceHealthCenterCode, testedAt}` after reading catalog too. A successful login alone is insufficient. Missing/different identity fails closed, with no numeric conversion, trimming, or fallback to `kdpusk` or names.
- `GET /bridge/catalog`: `{revision, remoteYear:null, targets:[{kd_ind,indikator,satuan,total_sasaran}], months:[{bulan,nama}]}`. Codes are exact strings, not normalized or matched by label.
- `GET /bridge/mappings`: `{revision,items:[{indicatorId,provinceCode}]}`. Config revision and mapping items are loaded in one repeatable-read transaction; absent configuration has revision 0.
- `PUT /bridge/mappings`: `{revision,items:[{indicatorId,provinceCode}]}` replaces the entire own-tenant mapping set, including clearing via `[]`. Revision is required and must match the revision returned by GET mappings. Stale clients return 409, even for clearing or invalid mapping items. Each local ID must be active, each exact province code must appear exactly once in the freshly authenticated catalog; duplicate local IDs or province codes are rejected (400). A serializable transaction with a client-revision guard prevents partial replacement and races during validation. Mapping replacement increments config revision and returns `{revision,items,...}`; retain this new revision for subsequent edits and refresh config if displayed. Concurrent config or mapping changes return 409.
- `POST /bridge/preview`: `{operation:'TARGETS'|'MONTHLY',month?}`; month 1..12 is required for MONTHLY. A supplied `year` is rejected (400); the server derives the active year. Returns `{revision,operation,localYear,month,remoteYear:null,warnings,items,unmappedRemote}`. Each item is `{indicatorId,provinceCode,local,remote,warnings}`. TARGETS local fields: `targetPct,totalSasaran,targetSasaran`. MONTHLY local fields: `pencapaianRiil,totalSasaran,targetSasaran,capaianRiilPct,nilaiKinerja,scoringVersion`. Local Decimal values serialize as decimal strings in production. Missing persisted record is `null`, not a default or zero. Remote values retain portal string/number/null types. MONTHLY remote fields: `bulan,kdindikator,indikator,target,sasaran,jml_sasaran,target_sasaran,capaian,hasil_riil,hasil_kinerja`; `sasaran` is a text unit, NOT the numeric denominator. Only selected-month rows are compared. Duplicate remote keys yield `remote:null` plus `REMOTE_RECORD_AMBIGUOUS`. Unmapped rows are returned separately. No local or remote data records are changed.

Preview always warns `REMOTE_YEAR_UNKNOWN` and
`FORMULA_EQUIVALENCE_UNVERIFIED`. The portal has no verified year field/selector;
server-selected active year selects **only local persisted data**, including a
locked active period. Remote data must never be labeled as belonging to that year.
Missing local/remote records and inactive local indicators have item warnings.
Preview intentionally does not claim formula parity or compute sync readiness.

## Deployment And Security

1. Run `npm ci`, `npm run prisma:generate`, and `npm run db:deploy`.
2. Install Chromium and its OS dependencies in the backend runtime using `npx playwright install --with-deps chromium`. The dependency alone does not install the browser. Existing container deployments also need this runtime installation; see Dockerfile.
3. Set `PROVINCE_CREDENTIAL_KEY` to canonical base64 of exactly 32 random bytes, e.g. generated by `openssl rand -base64 32`. Never commit it. Missing/invalid key disables config/catalog/mapping/test/preview operations with 503, without disabling log reads or unrelated application features. Do not replace it without a deliberate credential re-encryption/reset procedure; no automatic rotation is provided.

Passwords use versioned AES-256-GCM with random 12-byte IV, authentication tag,
and tenant ID as authenticated additional data. No password, ciphertext, NIP,
cookie, browser state, or portal error body is returned or logged. Username is a
configured administrative setting and is returned only to the own-tenant admin;
it can itself be a NIP. Operators must not enable request/body logging or browser
tracing for these endpoints.

Every read launches a fresh browser and isolated nonpersistent context. Browser
closure in `finally` disposes context/cookies even on identity failure. Maximum
two concurrent browser operations per process; excess requests fail 503 rather
than queue indefinitely. Total browser/read deadline is 30 seconds (launch has
its own 10-second bound), individual actions 8 seconds and navigation 10 seconds.
For multi-replica deployments, size replicas or add an infrastructure-level
global rate limit; this is not a distributed semaphore.

Network is fixed to `https://vfs-dinkes.com/pkp/`. Only one login POST to
`api/login.php` is permitted per operation. All other non-GET requests, arbitrary
origins, query strings, unlisted endpoints, WebSockets, and service workers are
blocked. Only the landing/dashboard pages, static assets, and four named GET
endpoints are allowed. Every permitted intercepted request uses bounded
`route.fetch({maxRedirects:0,maxRetries:0,timeout})`, then fulfills the browser
response; `route.continue()` is never used. All server 3xx redirects are rejected
except login POST 302/303 with Location resolving exactly to the same-origin
`/pkp/puskesmas.html` without query, fragment, or embedded credentials. That login
response is synthesized as empty text HTTP 200 preserving only Set-Cookie, not
Location, Refresh, or the original body. Dashboard navigation remains an explicit
GET. Login 307/308 are always rejected, so no POST body or credentials can be
forwarded to a redirect destination. Non-3xx Refresh headers are also rejected.
No retries,
CAPTCHA/OTP bypass, session reuse, remote saves, or logout mutation occurs.
Portal failures return sanitized 503 messages; config races return 409.
The adapter message is `<CODE>: Province read failed`: `BROWSER_UNAVAILABLE`
for browser launch failures, `PORTAL_LOGIN_FAILED` for login/setup/navigation
failures or an explicit identity `ok:false`, `IDENTITY_MISMATCH` for a missing,
wrong-role, non-string, empty or unequal identity code, and `READ_FAILED` for
identity fetch/parse or subsequent data read/validation failures. Codes describe
the failing stage, not a definitive diagnosis (e.g. wrong credentials versus an
operator challenge). No underlying exception text is exposed. Excess concurrency
retains the separate sanitized busy/retry message.

## Persistent Integration Logs

`GET /api/v1/bridge/logs?page=1&limit=20` requires an authenticated
`ADMIN_PUSKESMAS` with a non-null own tenant, including at the service boundary.
PIC and Dinkes admins receive 403; unauthenticated requests receive 401.
There is no tenant selector. Unknown query parameters (including `healthCenterId`,
`year`, and `cursor`) return 400. `page` is an integer in 1..1000000 (default 1);
`limit` is an integer in 1..100 (default 20). Invalid values return 400.

Exact successful response shape (example values):

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "items": [
      {
        "id": "b23e95b8-ab52-40e9-989d-67496a107386",
        "actorId": "662a42b9-1c25-4072-8f15-34b5ceaa5488",
        "action": "PROVINCE_TEST",
        "status": "FAILURE",
        "timestamp": "2026-10-19T00:00:00.000Z",
        "durationMs": 123,
        "errorCode": "REMOTE_UNAVAILABLE"
      }
    ],
    "page": 1,
    "limit": 20,
    "hasMore": false
  },
  "meta": { "timestamp": "2026-10-19T00:00:00.001Z" }
}
```

Items are newest first, ordered by `createdAt DESC, id DESC` for timestamp ties.
An out-of-range page has `items: []` and `hasMore: false`. This is offset
pagination: concurrent inserts can shift pages; no snapshot across requests is
promised. No total count or period/config flags are included.

`action` is one of `PROVINCE_CONFIG_SAVE`, `PROVINCE_TEST`, `PROVINCE_CATALOG`,
`PROVINCE_MAPPING_SAVE`, `PROVINCE_PREVIEW`. `status` is `SUCCESS` or `FAILURE`.
`errorCode` is null for success; failures use only `INVALID_REQUEST` (HTTP 400),
`FORBIDDEN` (403), `CONFLICT` (409), `REMOTE_UNAVAILABLE` (502/503/504), or
`INTERNAL_ERROR` (all other errors). It is not extracted from exception messages.
`durationMs` is a nonnegative integer measuring the operation before the audit
write. `timestamp` is the database audit creation time in UTC ISO 8601.
`actorId` is the internal user UUID (nullable under the existing audit schema);
no actor name or user relation is returned. Defensive reads return null for
invalid stored duration/error code values.

Reuses existing `AuditLog` persistence and its tenant/user `onDelete: Restrict`
relations, preserving archive/delete semantics. No schema change, Prisma
generation, or new migration is required for this feature. Integration entries
store a constant actor label and an allowlisted JSON payload with `schemaVersion: 1`,
`status`, `durationMs`, and `errorCode`. Reads filter by own tenant, exact action
allowlist and schema version, then explicitly project safe response fields.
No credentials, usernames, NIP, cookies, exception text, request bodies,
mapping contents, or raw portal responses are written to logs.

Each authorized operation reaching the service wrapper records one success or
failure, including remote failures, credential-key failures and transaction
rollbacks. Persistence is awaited outside business transactions. If the audit
database write itself fails, a fixed diagnostic is emitted without exception
details; the operation result/original error is preserved. Such outages can
leave gaps (no durable retry queue). Guard/DTO rejections before the service
wrapper are not integration attempts. GET config, GET mappings and GET logs do
not self-log. Log reads work even with integration disabled or no credential key.

`npm test` covers these behaviors using database fixtures. The real database/HTTP
fixture is `test/province-logs.e2e.ts`, enabled with `TEST_E2E=true npm run test:e2e`;
it retains append-only fixtures and never calls the live portal.

## Verification And Remaining Constraints

`npm test` includes fixture-only crypto, tenant authorization/isolation, revision,
mapping, historical/zero/null preview, request policy, field redaction and mocked
browser identity/context/cleanup tests. No production credentials or live network
are used. The migration needs deployment against the target PostgreSQL instance.
The discovered live `get_current_user.user` keys are `user_id`, `nama`, `nip`,
`role`, `provinsi`, `kabupaten`, `kabupaten_kode`, `kabupaten_nama`,
`puskesmas_kode`, and `puskesmas`. Only role and the exact `puskesmas_kode` string
are used for identity validation; other identity fields are not returned.
Challenge behavior, login redirects and current portal assets still require an
authorized read-only smoke test before deployment. Root `/pkp/styles.css` remains
intentionally blocked as nonessential. A changed/missing `user.puskesmas_kode`
fails closed instead of falling back to legacy fields or names.
Remote year and formula semantics remain unverified by design.
