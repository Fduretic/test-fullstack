import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { HttpException } from '@nestjs/common';
import type { ExceptionFilter, ArgumentsHost } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.js';
import { database } from './database.js';
import { Storage } from './storage.js';

class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (error instanceof HttpException) {
      const body = error.getResponse();
      res.status(error.getStatus()).json(typeof body === 'string' ? { statusCode: error.getStatus(), message: body } : body);
    } else {
      console.error('Request failed:', error instanceof Error ? error.name : 'Unknown error');
      res.status(500).json({ statusCode: 500, message: 'Something went wrong. Please try again.' });
    }
  }
}

try {
  await database.initialize();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new SafeErrors());
  let uploading = false;
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'POST' && /^\/api\/albums\/[^/]+\/photos\/?$/.test(req.path)) {
      if (uploading) return res.status(429).setHeader('Retry-After', '2').json({ message: 'Another image is processing. Please retry in a moment.' });
      uploading = true;
      res.once('finish', () => { uploading = false; });
      res.once('close', () => { uploading = false; });
    }
    next();
  });
  await app.get(Storage).initialize();
  await app.listen(3000, '0.0.0.0');
  const stop = async () => { await app.close(); if (database.isInitialized) await database.destroy(); };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
} catch {
  console.error('API startup failed. Check database credentials, migrations and storage mount permissions (UID/GID 10001).');
  process.exitCode = 1;
  if (database.isInitialized) await database.destroy();
}
