import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Role } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AnalyticsService } from '../analytics/analytics.service';
import { Actor } from '../core/auth.decorators';
import { audit } from '../core/audit';
import { DbService } from '../core/db.service';
import { requireRoles, tenantFor } from '../core/tenant';
import { ExportDto } from './integrations.dto';
import { IntegrationService } from './integrations.service';

type Summary = Awaited<ReturnType<AnalyticsService['sheet7']>>;

@Injectable()
export class ExportService implements OnModuleInit, OnModuleDestroy {
  private readonly producerRedis: Redis;
  private readonly workerRedis: Redis;
  private readonly queue: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: DbService, private readonly analytics: AnalyticsService,
    private readonly storage: IntegrationService,
  ) {
    this.producerRedis = new Redis(storage.config.redisUrl, {
      maxRetriesPerRequest: null, enableOfflineQueue: false, connectTimeout: 3000, commandTimeout: 5000,
    });
    this.workerRedis = new Redis(storage.config.redisUrl, { maxRetriesPerRequest: null, connectTimeout: 3000 });
    this.producerRedis.on('error', () => {});
    this.workerRedis.on('error', () => {});
    this.queue = new Queue('export', { connection: this.producerRedis });
    this.queue.on('error', () => {});
  }

  async onModuleInit() {
    await this.queue.waitUntilReady();
    this.worker = new Worker('export', job => this.process(job), { connection: this.workerRedis, concurrency: 2 });
    this.worker.on('error', () => {});
    this.worker.on('failed', job => {
      if (job) void this.reconcileFailure(job).catch(() => {});
    });
    // Redis may have lost a queued item, or a process may have died between DB commit and enqueue.
    let cursor: string | undefined;
    for (;;) {
      const pending = await this.db.exportJob.findMany({
        where: { status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { id: 'asc' }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of pending) {
        const existing = await this.queue.getJob(row.id);
        if (!existing) await this.enqueue(row.id);
        else if (await existing.getState() === 'failed') {
          await this.db.exportJob.updateMany({ where: { id: row.id, status: { not: 'COMPLETED' } }, data: { status: 'FAILED', error: 'Export generation failed' } });
        }
      }
      if (pending.length < 100) break;
      cursor = pending[pending.length - 1]!.id;
    }
  }

  async onModuleDestroy() {
    try { await this.worker?.close(); }
    finally {
      try { await this.queue.close(); }
      finally {
        await Promise.allSettled([this.producerRedis.quit(), this.workerRedis.quit()]);
        this.producerRedis.disconnect();
        this.workerRedis.disconnect();
      }
    }
  }

  private enqueue(id: string) {
    return this.queue.add('sheet7', { exportJobId: id }, {
      jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400 }, removeOnFail: { age: 604800 },
    });
  }

  async create(actor: Actor, body: ExportDto, format: 'xlsx' | 'pdf') {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, body.healthCenterId);
    if (!await this.db.healthCenter.findUnique({ where: { id: healthCenterId }, select: { id: true } })) {
      throw new NotFoundException('Health center not found');
    }
    const row = await this.db.$transaction(async tx => {
      const created = await tx.exportJob.create({ data: {
        healthCenterId, userId: actor.id, year: body.year, quarter: body.quarter === 'ANNUAL' ? 0 : body.quarter,
        format, status: 'QUEUED',
      } });
      await audit(tx, actor, healthCenterId, 'EXPORT_QUEUED', { exportJobId: created.id, year: body.year, quarter: body.quarter, format });
      return created;
    });
    try { await this.enqueue(row.id); }
    catch {
      // Do not overwrite a worker that already started after an ambiguous enqueue timeout.
      await this.db.exportJob.updateMany({ where: { id: row.id, status: 'QUEUED' }, data: { status: 'FAILED', error: 'Export queue unavailable' } });
      throw new ServiceUnavailableException('Export queue unavailable');
    }
    return { jobId: row.id, status: 'QUEUED', healthCenterId, year: row.year, quarter: body.quarter, format };
  }

  async get(actor: Actor, id: string, requested?: string) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, requested);
    const row = await this.db.exportJob.findFirst({ where: { id, healthCenterId } });
    if (!row) throw new NotFoundException('Export job not found');
    const download = row.status === 'COMPLETED' && row.objectKey?.startsWith(`reports/${healthCenterId}/${row.id}/`)
      ? await this.storage.signDownload(this.storage.config.reportsBucket, row.objectKey, `sheet7-${row.year}-${row.quarter || 'ANNUAL'}.${row.format}`)
      : {};
    return { ...row, quarter: row.quarter === 0 ? 'ANNUAL' : row.quarter, ...download };
  }

  private async reconcileFailure(job: Job) {
    if (await job.getState() !== 'failed') return;
    await this.db.exportJob.updateMany({
      where: { id: job.id, status: { not: 'COMPLETED' } },
      data: { status: 'FAILED', error: 'Export generation failed' },
    });
  }

  private async process(job: Job) {
    // Only the UUID is trusted from Redis; all report inputs and scope are reloaded from the DB.
    if (!job.id || job.data.exportJobId !== job.id) throw new Error('Invalid export job');
    const row = await this.db.exportJob.findUnique({ where: { id: job.id } });
    if (!row || row.status === 'COMPLETED' || row.status === 'FAILED') return;
    try {
      if (!['xlsx', 'pdf'].includes(row.format) || row.quarter < 0 || row.quarter > 4) throw new Error('Invalid export inputs');
      const owner = await this.db.user.findUnique({ where: { id: row.userId } });
      if (!owner || owner.status !== 'ACTIVE' || (owner.role !== Role.ADMIN_PUSKESMAS && owner.role !== Role.DINKES_ADMIN) ||
          (owner.role !== Role.DINKES_ADMIN && owner.healthCenterId !== row.healthCenterId)) throw new Error('Export authorization revoked');
      await this.db.exportJob.update({ where: { id: row.id }, data: { status: 'RUNNING', error: null } });
      const summary = await this.analytics.sheet7(row.healthCenterId, row.year, row.quarter === 0 ? 'ANNUAL' : row.quarter);
      const generatedAt = new Date().toISOString();
      const content = row.format === 'xlsx' ? await this.excel(summary, generatedAt) : await this.pdf(summary, generatedAt);
      const objectKey = `reports/${row.healthCenterId}/${row.id}/sheet7.${row.format}`;
      await this.storage.internal.send(new PutObjectCommand({
        Bucket: this.storage.config.reportsBucket, Key: objectKey, Body: content, ContentLength: content.length,
        ContentType: row.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      }), { abortSignal: AbortSignal.timeout(10000) });
      await this.db.exportJob.update({ where: { id: row.id }, data: { status: 'COMPLETED', objectKey, error: null } });
    } catch {
      await this.db.exportJob.updateMany({ where: { id: row.id, status: { not: 'COMPLETED' } }, data: {
        status: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) ? 'FAILED' : 'RUNNING', error: 'Export generation failed',
      } });
      throw new Error('Export generation failed');
    }
  }

  private lines(summary: Summary, generatedAt: string): string[] {
    return [
      'Sheet 7 - Penilaian Kinerja Puskesmas',
      `${summary.isOfficial ? 'VERIFIED' : 'PROVISIONAL'} | ${summary.puskesmasName} (${summary.puskesmasCode})`,
      `${summary.year} | ${summary.periodLabel} | Generated at: ${generatedAt}`,
      `Source: ${summary.source} | Status: ${summary.status} | Complete: ${summary.isComplete}`,
      `Scoring: ${summary.scoringVersion} | Basis: ${summary.basis}`,
      `Overall score: ${summary.nilaiKinerjaPuskesmas ?? 'N/A'} | Category: ${summary.kategoriPKP}`,
      `Indicators: ${summary.totalIndikator} | Completion: ${summary.completionRate ?? 'N/A'}%`,
      'Inputs evaluated at generation time, not enqueue time. Verified reports use the official period snapshot.',
      'Provisional reports are not official. No signatures or approvals are implied.',
    ];
  }

  private async excel(summary: Summary, generatedAt: string): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SIPKP';
    const sheet = workbook.addWorksheet('Sheet 7');
    sheet.columns = [{ width: 20 }, { width: 90 }, { width: 20 }, { width: 20 }];
    for (const line of this.lines(summary, generatedAt)) { const row = sheet.addRow([line]); sheet.mergeCells(row.number, 1, row.number, 4); }
    sheet.addRow([]);
    sheet.addRow(['Code', 'Section / Cluster', 'Score', 'Complete']).font = { bold: true };
    for (const row of summary.rows) sheet.addRow([
      row.no, row.name, 'nilaiKlaster' in row ? row.nilaiKlaster : row.nilaiKelompok,
      'isComplete' in row ? String(row.isComplete) : '',
    ]);
    const indicators = workbook.addWorksheet('Indicators');
    indicators.addRow(['Indicator', 'Description', 'Achievement', 'Population', 'Target', 'Achievement %', 'Score', 'Status']);
    for (const item of summary.indicators) indicators.addRow([
      item.indicatorId, item.indicator.indikator, item.pencapaianRiil, item.totalSasaran,
      item.targetSasaran, item.capaianRiilPct, item.nilaiKinerja, item.status,
    ]);
    indicators.columns.forEach(column => { column.width = 24; });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private pdf(summary: Summary, generatedAt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      for (const line of this.lines(summary, generatedAt)) doc.fontSize(10).text(line).moveDown(0.4);
      doc.moveDown();
      for (const row of summary.rows) {
        const score = 'nilaiKlaster' in row ? row.nilaiKlaster : row.nilaiKelompok;
        doc.font(row.isKlasterHead ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(`${row.no}  ${row.name}: ${score ?? 'N/A'}`);
      }
      doc.end();
    });
  }
}
