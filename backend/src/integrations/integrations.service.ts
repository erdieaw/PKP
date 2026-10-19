import {
  BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Role, Upload } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config';
import { Actor } from '../core/auth.decorators';
import { audit } from '../core/audit';
import { DbService } from '../core/db.service';
import { assertWritable, lockYear } from '../core/period';
import { RedisService } from '../core/redis.service';
import { requireRoles, tenantFor } from '../core/tenant';
import { DownloadDto, UploadDto } from './integrations.dto';
import { matchesMagic, UPLOAD_TTL_SECONDS, validateUpload } from './storage.validation';

@Injectable()
export class IntegrationService implements OnModuleDestroy {
  readonly config = getConfig();
  readonly internal: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly db: DbService, private readonly redis: RedisService) {
    const options = {
      region: 'us-east-1', forcePathStyle: true, maxAttempts: 1,
      credentials: { accessKeyId: this.config.minioAccessKey, secretAccessKey: this.config.minioSecretKey },
      requestHandler: { connectionTimeout: 2000, socketTimeout: 5000 },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...options, endpoint: this.config.minioEndpoint });
    this.publicClient = new S3Client({ ...options, endpoint: this.config.minioPublicEndpoint });
  }

  onModuleDestroy() { this.internal.destroy(); this.publicClient.destroy(); }

  private authorizeUpload(actor: Actor, upload: Upload, healthCenterId?: string) {
    const tenant = tenantFor(actor, healthCenterId);
    if (tenant !== upload.healthCenterId || (actor.role === Role.PIC && upload.userId !== actor.id)) {
      throw new NotFoundException('Upload not found');
    }
  }

  async presignedUpload(actor: Actor, body: UploadDto) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const healthCenterId = tenantFor(actor, body.healthCenterId);
    const filename = validateUpload(body.filename, body.mimeType, body.fileSizeBytes);
    const uploadId = randomUUID();
    const objectKey = `staging/${healthCenterId}/${body.year}/${body.month}/${uploadId}/${filename}`;
    const uploadUrl = await getSignedUrl(this.publicClient, new PutObjectCommand({
      Bucket: this.config.evidenceBucket, Key: objectKey, ContentType: body.mimeType,
      ContentLength: body.fileSizeBytes, Metadata: { 'upload-id': uploadId },
    }), { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(['content-length', 'content-type']) });
    await this.db.$transaction(async tx => {
      await lockYear(tx, body.year);
      await assertWritable(tx, healthCenterId, body.year, body.month);
      await tx.upload.create({ data: {
        id: uploadId, healthCenterId, userId: actor.id, year: body.year, month: body.month,
        filename, mimeType: body.mimeType, sizeBytes: body.fileSizeBytes, objectKey,
        status: 'PENDING', expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
      } });
      await audit(tx, actor, healthCenterId, 'UPLOAD_PENDING', { uploadId, objectKey, sizeBytes: body.fileSizeBytes });
    });
    return { uploadId, objectKey, uploadUrl, expiresInSeconds: UPLOAD_TTL_SECONDS, requiredHeaders: { 'Content-Type': body.mimeType } };
  }

  async finalize(actor: Actor, id: string) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.PIC);
    const upload = await this.db.upload.findUnique({ where: { id } });
    if (!upload) throw new NotFoundException('Upload not found');
    this.authorizeUpload(actor, upload);
    // READY and ATTACHED retries never touch the object again, even after the period locks.
    if (upload.status !== 'PENDING') return upload;
    await this.db.$transaction(async tx => {
      await lockYear(tx, upload.year);
      await assertWritable(tx, upload.healthCenterId, upload.year, upload.month);
      if (upload.expiresAt <= new Date()) throw new ConflictException('Upload has expired');
    });
    const bucket = this.config.evidenceBucket;
    const finalKey = `evidence/${upload.healthCenterId}/${upload.year}/${upload.month}/${randomUUID()}/${upload.filename}`;
    let committed = false;
    try {
      const head = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: upload.objectKey }), { abortSignal: AbortSignal.timeout(5000) });
      if (!head.ETag) throw new BadRequestException('Object has no ETag');
      await this.internal.send(new CopyObjectCommand({
        Bucket: bucket, Key: finalKey,
        CopySource: `${bucket}/${upload.objectKey.split('/').map(encodeURIComponent).join('/')}`,
        CopySourceIfMatch: head.ETag,
      }), { abortSignal: AbortSignal.timeout(5000) });
      // Validate the immutable copy, not a staging object that its presigned PUT can still replace.
      const finalHead = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: finalKey }), { abortSignal: AbortSignal.timeout(5000) });
      if (finalHead.ContentLength !== upload.sizeBytes || finalHead.ContentType !== upload.mimeType ||
          finalHead.Metadata?.['upload-id'] !== upload.id || !finalHead.ETag) {
        throw new BadRequestException('Uploaded size, content type or upload metadata does not match');
      }
      const prefix = await this.internal.send(new GetObjectCommand({
        Bucket: bucket, Key: finalKey, Range: 'bytes=0-7', IfMatch: finalHead.ETag,
      }), { abortSignal: AbortSignal.timeout(5000) });
      if (!prefix.Body || !matchesMagic(upload.mimeType, await prefix.Body.transformToByteArray())) {
        throw new BadRequestException('File signature does not match the declared type');
      }
      const result = await this.db.$transaction(async tx => {
        await lockYear(tx, upload.year);
        const current = await tx.upload.findUniqueOrThrow({ where: { id } });
        if (current.status !== 'PENDING') return current;
        await assertWritable(tx, upload.healthCenterId, upload.year, upload.month);
        if (current.expiresAt <= new Date()) throw new ConflictException('Upload has expired');
        const ready = await tx.upload.update({ where: { id }, data: { status: 'READY', objectKey: finalKey, etag: finalHead.ETag } });
        await audit(tx, actor, upload.healthCenterId, 'UPLOAD_READY', { uploadId: id, objectKey: finalKey });
        return ready;
      });
      committed = result.objectKey === finalKey;
      await this.deleteQuietly(bucket, upload.objectKey);
      return result;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException('Upload verification unavailable; retry finalization');
    } finally {
      if (!committed) await this.deleteQuietly(bucket, finalKey);
    }
  }

  private async deleteQuietly(bucket: string, key: string) {
    try { await this.internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); }
    catch { /* Unreferenced private objects can be cleaned up by a storage lifecycle rule. */ }
  }

  async presignedDownload(actor: Actor, query: DownloadDto) {
    if (Boolean(query.uploadId) === Boolean(query.objectKey)) throw new BadRequestException('Specify exactly one of uploadId or objectKey');
    const upload = await this.db.upload.findUnique({ where: query.uploadId ? { id: query.uploadId } : { objectKey: query.objectKey! } });
    if (!upload) throw new NotFoundException('Upload not found');
    this.authorizeUpload(actor, upload, query.healthCenterId);
    if (!['READY', 'ATTACHED'].includes(upload.status) || !upload.objectKey.startsWith(`evidence/${upload.healthCenterId}/`)) {
      throw new ConflictException('Upload is not ready');
    }
    return { uploadId: upload.id, objectKey: upload.objectKey, ...await this.signDownload(this.config.evidenceBucket, upload.objectKey, upload.filename) };
  }

  async signDownload(bucket: string, objectKey: string, filename: string) {
    const downloadUrl = await getSignedUrl(this.publicClient, new GetObjectCommand({
      Bucket: bucket, Key: objectKey, ResponseContentDisposition: `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
    }), { expiresIn: UPLOAD_TTL_SECONDS });
    return { downloadUrl, expiresInSeconds: UPLOAD_TTL_SECONDS };
  }

  async ready() {
    try {
      await Promise.all([
        this.db.$queryRaw`SELECT 1`, this.redis.client.ping(),
        ...[this.config.evidenceBucket, this.config.reportsBucket].map(Bucket => this.internal.send(new HeadBucketCommand({ Bucket }), { abortSignal: AbortSignal.timeout(3000) })),
      ]);
      return { status: 'ready' };
    } catch { throw new ServiceUnavailableException({ status: 'not_ready' }); }
  }

  bridgeStatus(actor: Actor, requested?: string) {
    requireRoles(actor, Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN);
    const healthCenterId = tenantFor(actor, requested);
    return { healthCenterId, status: 'CONFIGURATION_REQUIRED', enabled: false, reason: 'Official provincial contract not provided' };
  }

  bridgeSync(actor: Actor, requested?: string): never {
    const status = this.bridgeStatus(actor, requested);
    throw new ServiceUnavailableException({ ...status, message: status.reason });
  }
}
