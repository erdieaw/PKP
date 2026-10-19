import { api, ApiError, type SessionTokens } from './apiClient';
import type {
  AuthUser, UserRole, OfficialIndicator, PicUser, AdminPuskesmasUser, YearPeriod,
  HealthCenter, AuditLogEntry, IndicatorAnnualTarget, MonthlyRecord,
  DinkesRecommendation, PeriodLockState, Sheet7OfficialSummary, AnnualTrendData,
  AnnualIndicatorTrend,
} from '../types/pkp';

export interface SubKlasterMaster {
  id: string;
  klasterId: number;
  code: string;
  name: string;
  indicatorCount?: number;
  parentCode?: string | null;
  order?: number;
  isActive?: boolean;
}

export type MasterIndicator = OfficialIndicator & { isActive?: boolean; updatedAt?: string; scoringVersion?: number; notes?: string | null; formulaRaw?: string | null; hasRecords?: boolean };
export type ManagedHealthCenter = HealthCenter & { isActive?: boolean; address?: string };

// Wire objects retain server metadata as well as the legacy selector fields.
// Decimal strings are normalized only at this boundary; null is never zero.
type Wire = Record<string, any>;
type Quarter = 1 | 2 | 3 | 4 | 'ANNUAL';
type Reload = 'month' | 'targets' | 'assignments' | 'recommendations' | 'users' | 'workflow' | 'all';
type RecordView = MonthlyRecord & { isMissing: boolean; evidenceId?: string | null };
type PeriodView = PeriodLockState & { revision: number };
interface State {
  version: number;
  pendingWrites: number;
  user: AuthUser | null;
  year: number;
  healthCenterId: string | null;
  load: { loading: boolean; error: Error | null; scopeKey: string };
  indicators: OfficialIndicator[];
  sections: SubKlasterMaster[];
  masterIndicators: MasterIndicator[];
  masterSections: SubKlasterMaster[];
  years: YearPeriod[];
  centers: ManagedHealthCenter[];
  pics: PicUser[];
  admins: AdminPuskesmasUser[];
  audit: AuditLogEntry[];
  assignments: Record<string, string>;
  targets: Record<string, IndicatorAnnualTarget>;
  recommendations: DinkesRecommendation[];
  months: Record<number, Record<string, RecordView>>;
  periods: PeriodView[];
  sheets: Partial<Record<Quarter, Sheet7OfficialSummary & Wire>>;
  trend: AnnualTrendData | null;
  indicatorTrends: AnnualIndicatorTrend[];
}

const numericFields = new Set(['targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault', 'targetPct', 'totalSasaran', 'targetSasaran', 'pencapaianRiil', 'capaianRiilPct', 'nilaiKinerja']);
function normalize(value: any, key = ''): any {
  if (value === null || value === undefined) return value;
  if (numericFields.has(key)) return Number(value);
  if (Array.isArray(value)) return value.map(item => normalize(item));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const emptyScope = () => ({ pics: [], admins: [], audit: [], assignments: {}, targets: {}, recommendations: [], months: {}, periods: [], sheets: {}, trend: null, indicatorTrends: [] });
const initial = (): State => ({ version: 0, pendingWrites: 0, user: null, year: new Date().getFullYear(), healthCenterId: null, load: { loading: false, error: null, scopeKey: '' }, indicators: [], sections: [], masterIndicators: [], masterSections: [], years: [], centers: [], ...emptyScope() });
const missingRecord = freeze({ pencapaianRiil: null, capaianRiilPct: null, nilaiKinerja: null, isSubmitted: false, isMissing: true, evidenceId: null } as unknown as RecordView);
const emptyArray = freeze([]);
const emptyMap = freeze({});
const roleLabels: Record<UserRole, string> = { DINKES_ADMIN: 'Admin Dinas Kesehatan', ADMIN_PUSKESMAS: 'Admin Puskesmas', PIC: 'PIC' };
const pick = (data: Wire, keys: string[]) => Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
const items = (data: Wire | Wire[]): Wire[] => Array.isArray(data) ? data : data.items;

class ApiStore {
  private state: State = freeze(initial());
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller = new AbortController();
  private flight: Promise<void> | null = null;
  private readCache = new Map<string, unknown>();
  private invalidation = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private restoring: Promise<AuthUser | null> | null = null;
  private initializing: { userId: string; promise: Promise<void> } | null = null;

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('sipkp-session-expired', () => this.clear());
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state.version;
  getServerSnapshot = () => 0;
  private commit(patch: Partial<State>) {
    this.state = freeze({ ...this.state, ...patch, version: this.state.version + 1 });
    this.readCache.clear();
    this.listeners.forEach(listener => listener());
  }
  private cached<T>(key: string, get: () => T): T {
    if (!this.readCache.has(key)) this.readCache.set(key, freeze(get()));
    return this.readCache.get(key) as T;
  }
  private clear() {
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.flight = null;
    this.restoring = null;
    this.initializing = null;
    this.commit(initial());
  }
  private userView(row: Wire): AuthUser {
    return { ...row, roleLabel: roleLabels[row.role as UserRole], healthCenterId: row.healthCenterId ?? undefined, healthCenterName: row.healthCenter?.name ?? this.state.centers.find(c => c.id === row.healthCenterId)?.name, avatarColor: 'bg-emerald-600' } as AuthUser;
  }
  // Sessions last for this browser tab only. The legacy remember argument does not persist credentials.
  async authenticate(username: string, password: string): Promise<AuthUser | null> {
    this.clear();
    api.clearSession();
    const epoch = this.generation;
    const response = await api.login<SessionTokens & { user: Wire }>(username, password);
    if (epoch !== this.generation) throw new ApiError(401, 'Sesi telah berubah.');
    const user = this.userView(response.user);
    this.commit({ user });
    return this.state.user;
  }
  restore = (): Promise<AuthUser | null> => {
    if (this.restoring) return this.restoring;
    const work = this.restoreSession();
    this.restoring = work;
    void work.finally(() => { if (this.restoring === work) this.restoring = null; }).catch(() => {});
    return work;
  };
  private async restoreSession(): Promise<AuthUser | null> {
    if (!api.hasSession()) return null;
    const epoch = this.generation;
    try {
      await api.refresh();
      if (epoch !== this.generation) throw new ApiError(401, 'Sesi telah berubah.');
      const user = this.userView(await api.request<Wire>('/auth/me'));
      if (epoch !== this.generation) throw new ApiError(401, 'Sesi telah berubah.');
      this.commit({ user });
      return this.state.user;
    } catch (error) {
      if (epoch === this.generation && error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        api.clearSession();
        this.clear();
      }
      throw error;
    }
  }
  async logout() {
    const epoch = this.generation;
    try { await api.logout(); }
    finally { if (epoch === this.generation) this.clear(); }
  }
  getSessionUser = () => this.state.user;
  getCurrentUser = (): AuthUser => {
    if (!this.state.user) throw new ApiError(401, 'Silakan masuk terlebih dahulu.');
    return this.state.user;
  };
  getLoadState = () => this.state.load;
  isMutating = () => this.state.pendingWrites > 0;
  private assertNoWrites() {
    if (this.isMutating()) throw new Error('Tunggu penyimpanan selesai sebelum mengganti lingkup.');
  }
  private async trackWrite<T>(operation: (epoch: number) => Promise<T>): Promise<T> {
    const epoch = this.generation;
    this.commit({ pendingWrites: this.state.pendingWrites + 1 });
    try { return await operation(epoch); }
    finally {
      if (epoch === this.generation) this.commit({ pendingWrites: Math.max(0, this.state.pendingWrites - 1) });
    }
  }
  getCurrentYear = () => this.state.year;
  getSelectedHealthCenterId = () => this.state.healthCenterId;
  getCurrentHealthCenterId = () => this.state.healthCenterId;
  getSelectedHealthCenter = () => this.state.centers.find(c => c.id === this.state.healthCenterId);

  private async read(path: string, query: Wire = {}, signal = this.controller.signal): Promise<any> {
    const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
    return normalize(await api.request(`${path}${search.size ? `?${search}` : ''}`, { signal }));
  }
  private scope(year = this.state.year) {
    if (!this.state.healthCenterId) throw new Error('Pilih Puskesmas terlebih dahulu.');
    return { healthCenterId: this.state.healthCenterId, year };
  }
  private centerView(row: Wire): ManagedHealthCenter {
    return { ...row, subdistrict: row.district, headName: row.headName ?? '', picCount: row.picCount ?? 0, currentScore: row.currentScore ?? null, kategoriPKP: row.kategoriPKP ?? null, klasterScores: row.klasterScores ?? {} } as ManagedHealthCenter;
  }
  private yearView(row: Wire): YearPeriod {
    return { ...row, year: row.year, cutoffDay: row.cutoffDay, status: row.isLocked ? 'LOCKED' : 'OPEN', description: row.description ?? String(row.year), isCurrent: row.year === this.state.year };
  }
  private indicatorView(row: Wire): OfficialIndicator {
    return { ...row, section: row.section && typeof row.section === 'object' ? `${row.section.code}.${row.section.name}` : row.section ?? this.state.sections.find(s => s.code === row.sectionCode)?.name ?? row.sectionCode, klasterName: row.klasterName ?? `Klaster ${row.klasterId}`, formulaKinerjaRaw: row.formulaRaw ?? row.formulaKinerjaRaw } as OfficialIndicator;
  }
  initialize = (user: AuthUser = this.getCurrentUser()): Promise<void> => {
    if (this.initializing?.userId === user.id) return this.initializing.promise;
    this.assertNoWrites();
    const work = this.initializeSession(user);
    this.initializing = { userId: user.id, promise: work };
    void work.finally(() => { if (this.initializing?.promise === work) this.initializing = null; }).catch(() => {});
    return work;
  };
  private async initializeSession(user: AuthUser) {
    this.generation++;
    const epoch = this.generation;
    this.controller.abort();
    this.controller = new AbortController();
    this.flight = null;
    this.commit({ ...emptyScope(), user, healthCenterId: null, load: { loading: true, error: null, scopeKey: '' } });
    try {
      const [indicators, sections, years, centers] = await Promise.all([
        this.read('/master/indicators'), this.read('/master/sections'), this.read('/master/years'), this.read('/health-centers'),
      ]);
      if (epoch !== this.generation) return;
      const current = new Date().getFullYear();
      const available = years.map((row: Wire) => row.year as number);
      const preferredYear = available.includes(current) ? current : Math.max(...available.filter((y: number) => y <= current));
      const hasYear = Number.isFinite(preferredYear);
      if (!hasYear && user.role !== 'DINKES_ADMIN') throw new Error('Tidak ada tahun pelaporan saat ini atau sebelumnya.');
      const year = hasYear ? preferredYear : current;
      const tenant = user.role === 'DINKES_ADMIN' ? (hasYear ? centers.find((c: Wire) => c.isActive !== false)?.id : undefined) : user.healthCenterId;
      this.commit({ year, sections: sections.filter((s: Wire) => s.isActive !== false).map((s: Wire) => ({ ...s, id: s.code })), indicators: items(indicators).filter(i => i.isActive !== false).map(i => this.indicatorView(i)), years: years.map((y: Wire) => this.yearView({ ...y })), centers: centers.map((c: Wire) => this.centerView(c)), healthCenterId: tenant ?? null, user: { ...this.userView(user), healthCenterName: centers.find((c: Wire) => c.id === user.healthCenterId)?.name } });
      if (!tenant) {
        if (user.role !== 'DINKES_ADMIN') throw new Error('Tidak ada Puskesmas yang tersedia untuk akun ini.');
        this.commit({ ...emptyScope(), load: { loading: false, error: null, scopeKey: `global:${year}` } });
        return;
      }
      await this.refreshScope();
    } catch (error) {
      if (epoch === this.generation) this.commit({ load: { ...this.state.load, loading: false, error: error as Error } });
      throw error;
    }
  }
  async setCurrentYear(year: number) {
    this.assertNoWrites();
    if (!this.state.years.some(y => y.year === year)) throw new Error('Tahun tidak tersedia.');
    if (year === this.state.year) return;
    await this.switchScope({ year });
  }
  async selectHealthCenter(id: string) {
    this.assertNoWrites();
    const user = this.getCurrentUser();
    if (user.role !== 'DINKES_ADMIN' && id !== user.healthCenterId) throw new ApiError(403, 'Akses Puskesmas ditolak.');
    if (!this.state.centers.some(c => c.id === id && c.isActive !== false)) throw new Error('Puskesmas tidak tersedia atau telah diarsipkan.');
    if (id === this.state.healthCenterId) return;
    await this.switchScope({ healthCenterId: id });
  }
  private async switchScope(patch: Partial<State>) {
    this.assertNoWrites();
    this.generation++;
    this.controller.abort();
    this.controller = new AbortController();
    this.flight = null;
    this.commit({ ...emptyScope(), ...patch, load: { loading: true, error: null, scopeKey: `${patch.healthCenterId ?? this.state.healthCenterId}:${patch.year ?? this.state.year}` } });
    if (!this.state.healthCenterId && this.getCurrentUser().role === 'DINKES_ADMIN') {
      this.commit({ load: { loading: false, error: null, scopeKey: `global:${this.state.year}` } });
    } else await this.refreshScope();
  }
  private periodView(row: Wire): PeriodView {
    return { ...row, periodKey: `${row.year}-${row.isQuarter ? 'Q' : 'M'}${row.periodNumber}`, revision: row.revision ?? 0 } as PeriodView;
  }
  private recommendationView(row: Wire): DinkesRecommendation {
    return { ...row, klasterId: row.klasterId ?? Number(row.sectionCode.split('.')[0]), sectionName: row.section?.name ?? this.state.sections.find(s => s.code === row.sectionCode)?.name ?? row.sectionCode, puskesmasRtl: row.actionPlanText ?? '', status: row.statusFollowUp ?? 'PENDING' } as DinkesRecommendation;
  }
  private monthView(data: Wire, periods: PeriodView[]): Record<string, RecordView> {
    const protectedMonth = this.monthSubmitted(data.month, periods);
    return Object.fromEntries(items(data).map(row => [row.indicatorId, { ...row, isSubmitted: protectedMonth, notes: row.notes ?? undefined }]));
  }
  private monthSubmitted(month: number, periods: PeriodView[]): boolean {
    return periods.some(p => ['SUBMITTED', 'VERIFIED'].includes(p.status) && (p.isQuarter ? month <= p.periodNumber * 3 : month === p.periodNumber));
  }
  private rosterView(rows: Wire[]): Wire[] {
    return rows.map(row => ({ ...row, role: roleLabels[row.role as UserRole], healthCenterName: this.state.centers.find(c => c.id === row.healthCenterId)?.name, avatarColor: 'bg-emerald-600' }));
  }
  private async analytics(scope: Wire, signal: AbortSignal) {
    const [trend, trends, ...sheets] = await Promise.all([
      this.read('/analytics/annual-trend', scope, signal), this.read('/analytics/indicator-trends', scope, signal),
      ...[1, 2, 3, 4].map(quarter => this.read('/analytics/sheet7', { ...scope, quarter }, signal)),
    ]);
    return { trend, indicatorTrends: items(trends).map(row => ({ ...row, indicator: this.indicatorView(row.indicator) }) as AnnualIndicatorTrend), sheets: { ...Object.fromEntries(sheets.map((sheet, i) => [i + 1, sheet])), ANNUAL: { ...sheets[3], quarter: 'ANNUAL', periodLabel: 'Tahunan' } } };
  }
  private async users(path: string, scope: Wire, signal: AbortSignal): Promise<Wire[]> {
    const result: Wire[] = [];
    for (let page = 1; ; page++) {
      const data = await this.read(path, { healthCenterId: scope.healthCenterId, limit: 272, page }, signal);
      result.push(...data.items);
      if (result.length >= data.total) return result;
    }
  }
  refreshScope = (): Promise<void> => {
    if (this.flight) return this.flight;
    const scope = this.scope();
    const epoch = this.generation;
    const signal = this.controller.signal;
    const role = this.getCurrentUser().role;
    this.commit({ load: { loading: true, error: null, scopeKey: `${scope.healthCenterId}:${scope.year}` } });
    const work = (async () => {
      try {
        let patch: Partial<State>;
        let revision: number;
        do {
          revision = this.invalidation;
          const [targets, assignments, periodsRaw, recommendations, analytics, pics, admins, audit, ...months] = await Promise.all([
            this.read(`/targets/annual/${scope.year}`, { healthCenterId: scope.healthCenterId }, signal),
            this.read('/pic-assignments', scope, signal), this.read('/workflow/periods', scope, signal), this.read('/recommendations', scope, signal),
            this.analytics(scope, signal),
            role !== 'PIC' ? this.users('/users/pics', scope, signal) : Promise.resolve([]),
            role === 'DINKES_ADMIN' ? this.users('/users/admin-puskesmas', scope, signal) : Promise.resolve([]),
            role !== 'PIC' ? this.read('/audit-logs', { healthCenterId: scope.healthCenterId, limit: 272 }, signal) : Promise.resolve([]),
            ...Array.from({ length: 12 }, (_, i) => this.read('/records/monthly', { ...scope, month: i + 1 }, signal)),
          ]);
          const periods = periodsRaw.map((p: Wire) => this.periodView(p));
          patch = { ...analytics, targets: Object.fromEntries(items(targets).map(row => [row.indicatorId, row])), assignments: Object.fromEntries(assignments.map((row: Wire) => [row.indicatorId, row.picUserId])), periods, recommendations: items(recommendations).map(row => this.recommendationView(row)), pics: this.rosterView(pics) as PicUser[], admins: this.rosterView(admins) as AdminPuskesmasUser[], audit: items(audit).map(row => ({ ...row, timestamp: row.createdAt, userName: row.actorName, details: typeof row.details === 'string' ? row.details : JSON.stringify(row.details) })) as AuditLogEntry[], months: Object.fromEntries(months.map((month, i) => [i + 1, this.monthView(month, periods)])) };
        } while (revision !== this.invalidation && epoch === this.generation);
        if (epoch === this.generation) this.commit({ ...patch, load: { ...this.state.load, loading: false, error: null } });
      } catch (error) {
        if (epoch !== this.generation || signal.aborted) return;
        this.commit({ load: { ...this.state.load, loading: false, error: error as Error } });
        throw error;
      }
    })();
    this.flight = work;
    void work.finally(() => { if (this.flight === work) this.flight = null; }).catch(() => {});
    return work;
  };

  getIndicators = (includeArtifacts = false): OfficialIndicator[] => includeArtifacts ? this.state.indicators : this.cached('indicators', () => this.state.indicators.filter(i => !this.isArtifactRow(i)));
  getAllIndicatorsRaw = () => this.state.indicators;
  isArtifactRow = (i: OfficialIndicator) => Boolean(i.isTableArtifact || ['No', '(1)', '(2)', '(3)', 'Kegiatan'].includes(i.no));
  getYears = () => this.cached('years', () => this.state.years.map(y => ({ ...y, isCurrent: y.year === this.state.year })));
  getPuskesmasList = () => this.state.centers;
  getSubKlasters = () => this.state.sections;
  getMasterIndicators = () => this.state.masterIndicators;
  getMasterSections = () => this.state.masterSections;
  private assertMasterAccess() {
    if (this.getCurrentUser().role === 'PIC') throw new ApiError(403, 'PIC tidak dapat mengelola data master.');
  }
  async fetchMasterCatalog() {
    this.assertMasterAccess();
    const epoch = this.generation;
    const [indicators, sections] = await Promise.all([
      this.read('/master/indicators', { includeArchived: true }),
      this.read('/master/sections', { includeArchived: true }),
    ]);
    if (epoch !== this.generation) return;
    this.commit({ masterIndicators: items(indicators).map(i => this.indicatorView(i) as MasterIndicator), masterSections: items(sections).map(s => ({ ...s, id: s.code })) as SubKlasterMaster[] });
  }
  async refreshCatalog() {
    const epoch = this.generation;
    if (this.flight) await this.flight;
    if (epoch !== this.generation) return;
    const [indicators, sections, years, centers, user] = await Promise.all([
      this.read('/master/indicators'), this.read('/master/sections'), this.read('/master/years'), this.read('/health-centers'), this.read('/auth/me'),
    ]);
    if (epoch !== this.generation) return;
    const availableYears = items(years);
    const year = availableYears.some(y => y.year === this.state.year) ? this.state.year : availableYears[0]?.year ?? new Date().getFullYear();
    const healthCenterId = availableYears.length && items(centers).some(c => c.id === this.state.healthCenterId && c.isActive !== false) ? this.state.healthCenterId : null;
    this.invalidation++;
    this.commit({
      sections: items(sections).filter(s => s.isActive !== false).map(s => ({ ...s, id: s.code })) as SubKlasterMaster[],
      indicators: items(indicators).filter(i => i.isActive !== false).map(i => this.indicatorView(i)),
      years: availableYears.map(y => this.yearView(y)), centers: items(centers).map(c => this.centerView(c)), user: this.userView(user), year, healthCenterId,
      ...(!healthCenterId ? { ...emptyScope(), load: { loading: false, error: null, scopeKey: `global:${year}` } } : {}),
    });
    if (user.role !== 'PIC') await this.fetchMasterCatalog();
    if (epoch !== this.generation) return;
    // Finish any older scope read before replacing it with the refreshed catalog scope.
    if (this.flight) await this.flight;
    if (epoch === this.generation && healthCenterId) await this.refreshScope();
  }
  private catalogMutation(path: string, method: string, body?: Wire) {
    this.assertMasterAccess();
    return this.trackWrite(epoch => {
      const work = this.writes.then(async () => {
        if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
        const result = await api.request<Wire>(path, { method, body, signal: this.controller.signal });
        if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
        await this.refreshCatalog();
        return result;
      });
      this.writes = work.catch(() => {});
      return work;
    });
  }
  getAuditLogs = () => this.state.audit;
  getPics = () => this.state.pics;
  getPicsByHealthCenter = (id?: string) => this.cached(`pics:${id}`, () => id ? this.state.pics.filter(p => p.healthCenterId === id) : this.state.pics);
  getPicById = (id: string) => this.state.pics.find(p => p.id === id);
  getAdminPuskesmasList = () => this.state.admins;
  getAdminPuskesmasById = (id: string) => this.state.admins.find(a => a.id === id);
  getAdminPuskesmasByHealthCenter = (id: string) => this.state.admins.find(a => a.healthCenterId === id);
  getAssignments = (year = this.state.year): Record<string, string> => year === this.state.year ? this.state.assignments : emptyMap;
  getAnnualTargets = (year = this.state.year): Record<string, IndicatorAnnualTarget> => year === this.state.year ? this.state.targets : emptyMap;
  getRecommendations = (year = this.state.year): DinkesRecommendation[] => year === this.state.year ? this.state.recommendations : emptyArray;
  getPicForIndicator = (id: string, year = this.state.year) => this.getPicById(this.getAssignments(year)[id]);
  getPeriodLock = (year: number, periodNumber: number, isQuarter = false): PeriodView => this.cached(`period:${year}:${periodNumber}:${isQuarter}`, () => (year === this.state.year ? this.state.periods.find(p => p.periodNumber === periodNumber && p.isQuarter === isQuarter) : undefined) ?? { periodKey: `${year}-${isQuarter ? 'Q' : 'M'}${periodNumber}`, year, periodNumber, isQuarter, status: 'DRAFT', revision: 0 });
  isPeriodLocked = (year: number, periodNumber: number, isQuarter = false): boolean => this.state.years.some(y => y.year === year && y.status === 'LOCKED') || (year === this.state.year && this.state.periods.some(p => ['SUBMITTED', 'VERIFIED'].includes(p.status) && (isQuarter ? (p.isQuarter || p.periodNumber <= periodNumber * 3) : p.isQuarter ? periodNumber <= p.periodNumber * 3 : p.periodNumber === periodNumber)));
  getMonthlyRecord = (id: string, month: number, year = this.state.year): RecordView => year === this.state.year ? this.state.months[month]?.[id] ?? missingRecord : missingRecord;
  getQuarterlyRecord = (id: string, quarter: 1 | 2 | 3 | 4, year = this.state.year): MonthlyRecord => this.cached(`quarter:${id}:${quarter}:${year}`, () => {
    const row = year === this.state.year ? this.state.sheets[quarter]?.indicators?.find((i: Wire) => i.indicatorId === id) : undefined;
    return row ? { ...row, isSubmitted: ['SUBMITTED', 'VERIFIED'].includes(this.getPeriodLock(year, quarter, true).status) } as MonthlyRecord : missingRecord;
  });
  getOfficialSheet7Data = (quarter: Quarter, year = this.state.year): Sheet7OfficialSummary => {
    const sheet = year === this.state.year ? this.state.sheets[quarter] : undefined;
    if (!sheet) throw new Error('Analitik belum dimuat untuk periode ini.');
    return sheet;
  };
  getAnnualTrendData = (year = this.state.year): AnnualTrendData => {
    if (year !== this.state.year || !this.state.trend) throw new Error('Tren tahunan belum dimuat.');
    return this.state.trend;
  };
  getAnnualIndicatorsTrend = (klaster = 0, year = this.state.year): AnnualIndicatorTrend[] => this.cached(`trends:${klaster}:${year}`, () => year !== this.state.year ? [] : klaster ? this.state.indicatorTrends.filter(i => i.indicator.klasterId === klaster) : this.state.indicatorTrends);
  getSubKlasterAggregation = (code: string, month: number, year = this.state.year) => this.cached(`section:${code}:${month}:${year}`, () => {
    const section = year === this.state.year ? this.state.trend?.subKlasters.find(s => s.code === code) : undefined;
    const records = this.getIndicators().filter(i => i.sectionCode === code || i.sectionCode.startsWith(`${code}.`)).map(i => this.getMonthlyRecord(i.id, month, year));
    return { averageScore: section?.monthlyScores[month - 1] ?? null, averageCapaian: null, childCount: section?.indicatorCount ?? 0, syncedCount: records.filter(r => r.syncStatus === 'SYNCED').length };
  });

  private mutate(path: string, method: string, body: Wire, reload: Reload = 'all'): Promise<Wire> {
    return this.trackWrite(epoch => {
      const work = this.writes.then(() => {
        if (epoch !== this.generation) throw new Error('Lingkup berubah sebelum penyimpanan dimulai.');
        return this.performMutation(path, method, body, reload);
      });
      this.writes = work.catch(() => {});
      return work;
    });
  }
  private async performMutation(path: string, method: string, body: Wire, reload: Reload) {
    const scope = this.scope(body.year ?? this.state.year);
    if (scope.year !== this.state.year) throw new Error('Pilih tahun tersebut sebelum menyimpan.');
    const epoch = this.generation;
    const signal = this.controller.signal;
    const result = await api.request<Wire>(path, { method, body: { ...body, healthCenterId: scope.healthCenterId }, signal });
    this.invalidation++;
    if (epoch !== this.generation) return result;
    if (reload === 'users' || path.endsWith('/reset-password')) {
      const user = await this.read('/auth/me', {}, signal);
      if (epoch !== this.generation) return result;
      this.commit({ user: this.userView(user) });
    }
    if (reload === 'all' || this.flight) { await this.refreshScope(); return result; }
    try {
      let patch: Partial<State>;
      if (reload === 'month') {
        const [month, periodsRaw, analytics] = await Promise.all([this.read('/records/monthly', { ...scope, month: body.month }, signal), this.read('/workflow/periods', scope, signal), this.analytics(scope, signal)]);
        const periods = periodsRaw.map((p: Wire) => this.periodView(p));
        patch = { ...analytics, periods, months: { ...this.state.months, [body.month]: this.monthView(month, periods) } };
      } else if (reload === 'workflow') {
        const [periodsRaw, targets, analytics] = await Promise.all([
          this.read('/workflow/periods', scope, signal),
          this.read(`/targets/annual/${scope.year}`, { healthCenterId: scope.healthCenterId }, signal),
          this.analytics(scope, signal),
        ]);
        const periods = periodsRaw.map((p: Wire) => this.periodView(p));
        const months = Object.fromEntries(Object.entries(this.state.months).map(([month, records]) => {
          const isSubmitted = this.monthSubmitted(Number(month), periods);
          return [month, Object.fromEntries(Object.entries(records).map(([id, record]) => [id, record.isSubmitted === isSubmitted ? record : { ...record, isSubmitted }]))];
        }));
        patch = { ...analytics, periods, targets: Object.fromEntries(items(targets).map(row => [row.indicatorId, row])), months };
      } else if (reload === 'users') {
        const role = this.getCurrentUser().role;
        const [pics, admins] = await Promise.all([
          role !== 'PIC' ? this.users('/users/pics', scope, signal) : Promise.resolve([]),
          role === 'DINKES_ADMIN' ? this.users('/users/admin-puskesmas', scope, signal) : Promise.resolve([]),
        ]);
        patch = { pics: this.rosterView(pics) as PicUser[], admins: this.rosterView(admins) as AdminPuskesmasUser[] };
      } else if (reload === 'targets') {
        const data = await this.read(`/targets/annual/${scope.year}`, { healthCenterId: scope.healthCenterId }, signal);
        patch = { targets: Object.fromEntries(items(data).map(row => [row.indicatorId, row])) };
      } else if (reload === 'assignments') {
        const data = await this.read('/pic-assignments', scope, signal);
        patch = { assignments: Object.fromEntries(data.map((row: Wire) => [row.indicatorId, row.picUserId])) };
      } else {
        patch = { recommendations: items(await this.read('/recommendations', scope, signal)).map(row => this.recommendationView(row)) };
      }
      if (epoch === this.generation) this.commit({ ...patch, load: { ...this.state.load, error: null } });
    } catch (error) {
      if (epoch === this.generation) this.commit({ load: { ...this.state.load, error: error as Error } });
      throw error;
    }
    return result;
  }
  saveRecord = (indicatorId: string, month: number, data: { pencapaianRiil: number; notes?: string; evidenceId?: string | null }, year = this.state.year) => this.mutate('/records/monthly', 'PUT', { year, month, records: [{ indicatorId, ...data }] }, 'month');
  updateMonthlyInput = (id: string, month: number, realisasi: number, notes?: string, evidenceId?: string, year = this.state.year) => this.saveRecord(id, month, { pencapaianRiil: realisasi, notes, evidenceId }, year);
  updateAnnualTarget = (indicatorId: string, targetPct: number, totalSasaran: number, year = this.state.year) => this.saveAnnualTargetsBulk([{ indicatorId, targetPct, totalSasaran }], year);
  saveAnnualTargetsBulk = (targets: { indicatorId: string; targetPct: number; totalSasaran: number }[], year = this.state.year) => {
    if (year !== this.state.year) throw new Error('Pilih tahun tersebut sebelum menyimpan.');
    return this.mutate(`/targets/annual/${year}/bulk`, 'PUT', { targets: targets.map(t => pick(t, ['indicatorId', 'targetPct', 'totalSasaran'])) }, 'targets');
  };
  lockAllTargets = (year = this.state.year) => {
    if (year !== this.state.year) throw new Error('Pilih tahun tersebut sebelum menyimpan.');
    return this.mutate(`/targets/annual/${year}/lock`, 'POST', {}, 'targets');
  };
  assignPic = (indicatorId: string, picId: string, year = this.state.year) => this.mutate('/pic-assignments/bulk', 'PUT', { year, picUserId: picId, indicatorIds: [indicatorId] }, 'assignments');
  bulkAssignPic = (sectionCode: string, picId: string, year = this.state.year) => this.mutate('/pic-assignments/bulk', 'PUT', { year, picUserId: picId, sectionCode }, 'assignments');
  private workflow(action: string, year: number, periodNumber: number, isQuarter: boolean, extra: Wire = {}) {
    return this.mutate(`/workflow/${action}`, 'POST', { year, periodNumber, isQuarter, expectedRevision: this.getPeriodLock(year, periodNumber, isQuarter).revision, ...extra }, 'workflow');
  }
  submitPeriod = (year: number, period: number, isQuarter: boolean, _actor?: string) => this.workflow('submit', year, period, isQuarter);
  verifyAndLockPeriod = (year: number, period: number, isQuarter: boolean, _actor?: string) => this.workflow('verify', year, period, isQuarter);
  requestRevisionPeriod = (year: number, period: number, isQuarter: boolean, note: string, _actor?: string, cascade = false) => this.workflow('revise', year, period, isQuarter, { revisionNote: note, cascadeDependencies: cascade });
  unlockPeriodForEdit = (year: number, period: number, isQuarter: boolean, _actor?: string, reason?: string, cascade = false) => this.workflow('reopen', year, period, isQuarter, { reason, cascadeDependencies: cascade });
  updateRecommendationRtl = (id: string, text: string, status: DinkesRecommendation['status']) => this.mutate(`/recommendations/${encodeURIComponent(id)}/action-plan`, 'PATCH', { actionPlanText: text, statusFollowUp: status }, 'recommendations');
  updateRTL = this.updateRecommendationRtl;
  addFeedback = (sectionCode: string, quarter: number, recommendationText: string) => this.mutate('/recommendations/feedback', 'POST', { year: this.state.year, sectionCode, quarter, recommendationText }, 'recommendations');

  uploadEvidence = (file: File, month: number) => this.trackWrite(async epoch => {
    const scope = this.scope();
    const signal = this.controller.signal;
    const signed = await api.request<Wire>('/storage/presigned-upload', { method: 'POST', body: { ...scope, month, filename: file.name, mimeType: file.type, fileSizeBytes: file.size }, signal });
    const response = await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.requiredHeaders, body: file, signal });
    if (!response.ok) throw new ApiError(response.status, 'Unggah bukti gagal.');
    const metadata = await api.request<Wire>(`/storage/uploads/${signed.uploadId}/finalize`, { method: 'POST', signal });
    if (epoch !== this.generation) throw new Error('Sesi berubah selama unggah bukti.');
    return { ...metadata, uploadId: signed.uploadId as string, evidenceId: signed.uploadId as string };
  });
  getEvidenceDownload = (uploadId: string) => this.read('/storage/presigned-download', { healthCenterId: this.scope().healthCenterId, uploadId });
  createExport = (format: 'xlsx' | 'excel' | 'pdf', quarter: Quarter) => api.request<Wire>(`/export/${format === 'pdf' ? 'pdf' : 'excel'}/sheet7`, { method: 'POST', body: { ...this.scope(), quarter }, signal: this.controller.signal });
  pollExport = (id: string) => this.read(`/export/jobs/${encodeURIComponent(id)}`, { healthCenterId: this.scope().healthCenterId });
  async fetchSupervision(quarter: Quarter = 'ANNUAL') {
    if (this.getCurrentUser().role !== 'DINKES_ADMIN') throw new ApiError(403, 'Hanya Dinkes dapat membandingkan Puskesmas.');
    const epoch = this.generation;
    const data = await this.read('/dashboard/summary', { ...this.scope(), quarter, compare: true });
    if (epoch === this.generation) this.commit({ centers: this.state.centers.map(center => {
      const summary = data.comparison.find((s: Wire) => s.healthCenterId === center.id);
      return summary ? { ...center, currentScore: summary.nilaiKinerjaPuskesmas, kategoriPKP: summary.kategoriPKP, klasterScores: summary.klasterScores, summary } : center;
    }) });
    return data;
  }
  private async createUser(kind: 'pics' | 'admin-puskesmas', data: Wire) {
    if (!data.username || !data.password) throw new Error('Username dan password eksplisit wajib diisi.');
    return this.mutate(`/users/${kind}`, 'POST', pick(data, ['username', 'password', 'name', 'nip', 'phone', 'email']), 'users');
  }
  addPic = (data: Wire) => this.createUser('pics', data);
  addAdminPuskesmas = (data: Wire) => this.createUser('admin-puskesmas', data);
  updatePic = (id: string, data: Partial<PicUser>) => this.mutate(`/users/${encodeURIComponent(id)}`, 'PATCH', pick(data, ['name', 'phone', 'email', 'status']), 'users');
  updateAdminPuskesmas = (id: string, data: Partial<AdminPuskesmasUser>) => this.updatePic(id, data);
  deletePic = (id: string) => this.updatePic(id, { status: 'INACTIVE' });
  deleteAdminPuskesmas = (id: string) => this.deletePic(id);
  toggleAdminPuskesmasStatus = (id: string) => {
    const admin = this.getAdminPuskesmasById(id);
    if (!admin) throw new Error('Admin tidak ditemukan.');
    return this.updatePic(id, { status: admin.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
  };
  addPuskesmas = (data: Wire) => this.trackWrite(async epoch => {
    if (this.getCurrentUser().role !== 'DINKES_ADMIN') throw new ApiError(403, 'Hanya Dinkes dapat membuat Puskesmas.');
    const signal = this.controller.signal;
    const result = await api.request<Wire>('/health-centers', { method: 'POST', body: { ...pick(data, ['code', 'name', 'address', 'headName', 'headNip', 'phone', 'email']), district: data.district ?? data.subdistrict }, signal });
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    const centers = await this.read('/health-centers');
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    this.commit({ centers: centers.map((c: Wire) => this.centerView(c)) });
    if (!this.state.healthCenterId && this.state.years.some(y => y.year === this.state.year)) {
      this.commit({ ...emptyScope(), healthCenterId: result.id, load: { loading: true, error: null, scopeKey: `${result.id}:${this.state.year}` } });
      await this.refreshScope();
    }
    await this.refreshCatalog();
    return result;
  });
  addYearPeriod = (year: number, cutoffDay: number, _description?: string) => this.trackWrite(async epoch => {
    this.assertMasterAccess();
    const hadYears = this.state.years.length > 0;
    const result = await api.request('/master/years', { method: 'POST', body: { year, cutoffDay }, signal: this.controller.signal });
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    const years = await this.read('/master/years');
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    this.commit({ years: years.map((y: Wire) => this.yearView(y)) });
    if (!hadYears) {
      const tenant = this.state.healthCenterId;
      this.commit({ ...emptyScope(), year, load: { loading: Boolean(tenant), error: null, scopeKey: tenant ? `${tenant}:${year}` : `global:${year}` } });
      if (tenant) await this.refreshScope();
    }
    await this.refreshCatalog();
    return result;
  });
  toggleYearLock = (year: number) => this.trackWrite(async epoch => {
    if (this.getCurrentUser().role !== 'DINKES_ADMIN') throw new ApiError(403, 'Hanya Dinkes dapat mengunci tahun.');
    const row = this.state.years.find(y => y.year === year);
    if (!row) throw new Error('Tahun tidak ditemukan.');
    await api.request(`/master/years/${year}`, { method: 'PATCH', body: { isLocked: row.status !== 'LOCKED' }, signal: this.controller.signal });
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    const years = await this.read('/master/years');
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    this.commit({ years: years.map((y: Wire) => this.yearView(y)) });
    await this.refreshCatalog();
  });
  changeUserPassword = (currentPassword: string, newPassword: string) => this.trackWrite(async epoch => {
    const result = await api.request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword }, signal: this.controller.signal });
    if (epoch !== this.generation) throw new Error('Sesi telah berubah.');
    api.clearSession();
    this.clear();
    return result;
  });
  private unsupported = (..._args: unknown[]): never => { throw new Error('Operasi ini tidak tersedia pada kontrak backend. Tidak ada data yang diubah.'); };
  addIndicator = (data: Wire) => this.catalogMutation('/master/indicators', 'POST', pick(data, ['id', 'klasterId', 'sectionCode', 'no', 'kegiatan', 'indikator', 'satuan', 'targetDisplay', 'targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault', 'polarity', 'formulaRaw', 'notes', 'isActive']));
  updateIndicator = (id: string, data: Wire) => this.catalogMutation(`/master/indicators/${encodeURIComponent(id)}`, 'PATCH', pick(data, ['klasterId', 'sectionCode', 'no', 'kegiatan', 'indikator', 'satuan', 'targetDisplay', 'targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault', 'polarity', 'formulaRaw', 'notes', 'isActive', 'expectedUpdatedAt']));
  deleteIndicator = (id: string) => this.catalogMutation(`/master/indicators/${encodeURIComponent(id)}`, 'DELETE');
  addSubKlaster = (data: Wire) => this.catalogMutation('/master/sections', 'POST', pick(data, ['code', 'name', 'klasterId', 'parentCode', 'order', 'isActive']));
  updateSubKlaster = (code: string, data: Wire) => this.catalogMutation(`/master/sections/${encodeURIComponent(code)}`, 'PATCH', pick(data, ['name', 'order', 'isActive']));
  deleteSubKlaster = (code: string) => this.catalogMutation(`/master/sections/${encodeURIComponent(code)}`, 'DELETE');
  updatePuskesmas = (id: string, data: Wire) => {
    const user = this.getCurrentUser();
    if (user.role !== 'DINKES_ADMIN' && (user.role !== 'ADMIN_PUSKESMAS' || user.healthCenterId !== id || data.isActive !== undefined)) throw new ApiError(403, 'Akses perubahan Puskesmas ditolak.');
    return this.catalogMutation(`/health-centers/${encodeURIComponent(id)}`, 'PATCH', pick(data, ['name', 'district', 'address', 'headName', 'headNip', 'phone', 'email', 'isActive']));
  };
  deletePuskesmas = (id: string) => {
    if (this.getCurrentUser().role !== 'DINKES_ADMIN') throw new ApiError(403, 'Hanya Dinkes dapat mengarsipkan Puskesmas.');
    return this.catalogMutation(`/health-centers/${encodeURIComponent(id)}`, 'DELETE');
  };
  updateYearCutoff = (year: number, cutoffDay: number) => this.catalogMutation(`/master/years/${year}`, 'PATCH', { cutoffDay });
  deleteYearPeriod = (year: number) => {
    if (this.getCurrentUser().role !== 'DINKES_ADMIN') throw new ApiError(403, 'Hanya Dinkes dapat menghapus tahun.');
    return this.catalogMutation(`/master/years/${year}`, 'DELETE');
  };
  resetUserPassword = (id: string, newPassword: string, reason: string) => {
    this.assertMasterAccess();
    if (newPassword.length < 12 || newPassword.length > 256 || !reason.trim()) throw new Error('Password minimal 12 karakter dan alasan wajib diisi.');
    return this.mutate(`/users/${encodeURIComponent(id)}/reset-password`, 'POST', { newPassword, reason: reason.trim() }, 'all');
  };
  rolloverTargets = this.unsupported;
  syncElementToProvinsi = this.unsupported;
  syncAllMonthElementsToProvinsi = this.unsupported;
  addAuditLog = this.unsupported;
  saveToStorage = this.unsupported;
  resetToDefaultData = this.unsupported;
  setCurrentUser = this.unsupported;
}

export const pkpStore = new ApiStore();
