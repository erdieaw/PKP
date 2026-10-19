import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { getConfig } from '../config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  constructor() {
    this.client = new Redis(getConfig().redisUrl, {
      lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 3000,
      commandTimeout: 3000,
    });
    this.client.on('error', () => { /* Requests fail closed through the rate-limit guard. */ });
  }
  async onModuleInit() { await this.client.connect(); }
  async onModuleDestroy() {
    try { await this.client.quit(); } finally { this.client.disconnect(); }
  }
}
