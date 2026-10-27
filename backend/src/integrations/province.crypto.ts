import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export function provinceKey(): Buffer {
  const value = process.env.PROVINCE_CREDENTIAL_KEY ?? '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new ServiceUnavailableException('Province credential encryption is not configured');
  }
  return key;
}

export function encryptProvincePassword(password: string, tenant: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', provinceKey(), iv);
  cipher.setAAD(Buffer.from(tenant));
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptProvincePassword(value: string, tenant: string): string {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error();
    if ([iv, tag, ciphertext].some(part => Buffer.from(part, 'base64').toString('base64') !== part)
      || Buffer.from(iv, 'base64').length !== 12 || Buffer.from(tag, 'base64').length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', provinceKey(), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(tenant));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException('Province credentials cannot be decrypted');
  }
}
