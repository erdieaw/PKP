import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { getConfig } from '../config';

const challengeMessage = 'Verifikasi keamanan gagal. Silakan ulangi verifikasi dan coba masuk kembali.';
const unavailableMessage = 'Layanan verifikasi keamanan sedang tidak tersedia. Silakan coba lagi nanti.';

@Injectable()
export class TurnstileService {
  private readonly config = getConfig().turnstile;

  loginConfig() {
    return { turnstileEnabled: Boolean(this.config.siteKey), turnstileSiteKey: this.config.siteKey || null };
  }

  async verify(token: string | undefined) {
    if (!this.config.siteKey) return;
    if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
      throw new UnprocessableEntityException(challengeMessage);
    }

    let result: unknown;
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: this.config.secretKey, response: token }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error();
      result = await response.json();
    } catch {
      throw new ServiceUnavailableException(unavailableMessage);
    }

    if (!result || typeof result !== 'object' || Array.isArray(result) ||
        !('success' in result) || typeof result.success !== 'boolean') {
      throw new ServiceUnavailableException(unavailableMessage);
    }
    const errors = 'error-codes' in result ? result['error-codes'] : [];
    if (!Array.isArray(errors) || errors.some(code => typeof code !== 'string') ||
        errors.some(code => ['internal-error', 'invalid-input-secret', 'missing-input-secret'].includes(code))) {
      throw new ServiceUnavailableException(unavailableMessage);
    }
    if (!result.success) throw new UnprocessableEntityException(challengeMessage);
    if (!('hostname' in result) || typeof result.hostname !== 'string' ||
        !('action' in result) || typeof result.action !== 'string') {
      throw new ServiceUnavailableException(unavailableMessage);
    }
    if (result.hostname !== this.config.hostname || result.action !== 'login') {
      throw new UnprocessableEntityException(challengeMessage);
    }
  }
}
