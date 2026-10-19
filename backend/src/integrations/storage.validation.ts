import { BadRequestException } from '@nestjs/common';
import { posix } from 'node:path';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TTL_SECONDS = 300;
const types: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function validateUpload(filename: string, mimeType: string, sizeBytes: number): string {
  if (typeof filename !== 'string' || typeof mimeType !== 'string' ||
      !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw new BadRequestException('File must be between 1 byte and 10 MiB');
  }
  const safe = posix.basename(filename.replace(/\\/g, '/')).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180);
  const extension = /\.([a-z0-9]+)$/i.exec(safe)?.[1]?.toLowerCase();
  if (!safe || !extension || types[extension] !== mimeType) {
    throw new BadRequestException('Allowed file types: PDF, PNG, JPEG, XLSX; extension and MIME type must match');
  }
  return safe;
}

// Signature checks reject disguised files; they are not malware scanning or full format validation.
export function matchesMagic(mimeType: string, prefix: Uint8Array): boolean {
  const bytes = Buffer.from(prefix);
  switch (mimeType) {
    case 'application/pdf': return bytes.subarray(0, 5).equals(Buffer.from('%PDF-'));
    case 'image/png': return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'image/jpeg': return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case types.xlsx: return bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
    default: return false;
  }
}
