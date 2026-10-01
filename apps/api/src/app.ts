import {
  Module, Controller, Get, Post, Patch, Delete, Body, Param, Res, UploadedFile,
  UseInterceptors, ParseUUIDPipe, BadRequestException, NotFoundException,
  ServiceUnavailableException, HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { database } from './database.js';
import { Storage } from './storage.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const selectAlbums = `SELECT a.*, (SELECT count(*)::int FROM photos p WHERE p.album_id = a.id) AS photo_count,
  (SELECT p.id FROM photos p WHERE p.album_id = a.id ORDER BY position LIMIT 1) AS cover_id FROM albums a`;
const publicPhoto = (p: Record<string, unknown>) => ({
  id: p.id, albumId: p.album_id, name: p.original_name, mime: p.mime, size: p.size,
  width: p.width, height: p.height, createdAt: p.created_at,
  thumbnailUrl: `api/photos/${p.id}/thumbnail`, originalUrl: `api/photos/${p.id}/original`,
});
const publicAlbum = (a: Record<string, unknown>) => ({
  id: a.id, name: a.name, description: a.description, createdAt: a.created_at, updatedAt: a.updated_at,
  photoCount: a.photo_count, coverUrl: a.cover_id ? `api/photos/${a.cover_id}/thumbnail` : null,
});

function albumInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('An album name is required.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(k => !['name', 'description'].includes(k))) throw new BadRequestException('Unexpected album field.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120) throw new BadRequestException('Name must contain 1–120 characters.');
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 2000)) throw new BadRequestException('Description must be 2,000 characters or fewer.');
  return { name: input.name.trim(), description: (input.description as string | undefined)?.trim() ?? '' };
}

async function lockAlbum(manager: EntityManager, id: string) {
  const rows = await manager.query('SELECT id FROM albums WHERE id=$1 FOR UPDATE', [id]);
  if (!rows.length) throw new NotFoundException('Album not found.');
}

@Controller()
class AppController {
  constructor(private readonly storage: Storage) {}

  @Get('health')
  async health() {
    try { await database.query('SELECT id FROM albums LIMIT 1'); }
    catch { throw new ServiceUnavailableException('Database is not ready.'); }
    await this.storage.probe();
    return { status: 'ok' };
  }

  @Get('albums')
  async albums() { return (await database.query(`${selectAlbums} ORDER BY a.created_at DESC, a.id`)).map(publicAlbum); }

  @Get('albums/:id')
  async album(@Param('id', uuid) id: string) {
    const rows = await database.query(`${selectAlbums} WHERE a.id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Album not found.');
    const photos = await database.query('SELECT * FROM photos WHERE album_id=$1 ORDER BY position', [id]);
    return { ...publicAlbum(rows[0]), photos: photos.map(publicPhoto) };
  }

  @Post('albums')
  async create(@Body() body: unknown) {
    const input = albumInput(body), id = randomUUID();
    await database.query('INSERT INTO albums(id,name,description) VALUES($1,$2,$3)', [id, input.name, input.description]);
    return this.album(id);
  }

  @Patch('albums/:id')
  async update(@Param('id', uuid) id: string, @Body() body: unknown) {
    const input = albumInput(body);
    await database.transaction(async manager => {
      await lockAlbum(manager, id);
      await manager.query('UPDATE albums SET name=$2,description=$3,updated_at=now() WHERE id=$1', [id, input.name, input.description]);
    });
    return this.album(id);
  }

  @Delete('albums/:id')
  @HttpCode(204)
  async deleteAlbum(@Param('id', uuid) id: string) {
    await database.transaction(async manager => {
      await lockAlbum(manager, id);
      const photos = await manager.query('SELECT * FROM photos WHERE album_id=$1', [id]);
      for (const p of photos) {
        await this.storage.remove(p.original_path);
        await this.storage.remove(p.thumbnail_path);
      }
      await manager.query('DELETE FROM albums WHERE id=$1', [id]);
    });
  }

  @Post('albums/:id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }))
  async upload(@Param('id', uuid) albumId: string, @UploadedFile() file: Express.Multer.File) {
    const id = randomUUID();
    let saved: Awaited<ReturnType<Storage['save']>> | undefined;
    try {
      return await database.transaction(async manager => {
        await lockAlbum(manager, albumId);
        saved = await this.storage.save(file, id);
        const name = file.originalname.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'Image';
        const rows = await manager.query(`INSERT INTO photos(id,album_id,original_name,mime,size,width,height,original_path,thumbnail_path)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [id, albumId, name, file.mimetype, file.size, saved.width, saved.height, saved.originalPath, saved.thumbnailPath]);
        await manager.query('UPDATE albums SET updated_at=now() WHERE id=$1', [albumId]);
        return publicPhoto(rows[0]);
      });
    } catch (error) {
      if (saved) await Promise.all([this.storage.remove(saved.originalPath), this.storage.remove(saved.thumbnailPath)]);
      throw error;
    }
  }

  @Delete('photos/:id')
  @HttpCode(204)
  async deletePhoto(@Param('id', uuid) id: string) {
    await database.transaction(async manager => {
      const rows = await manager.query('SELECT * FROM photos WHERE id=$1', [id]);
      if (!rows.length) throw new NotFoundException('Photo not found.');
      const p = rows[0];
      await lockAlbum(manager, p.album_id);
      await this.storage.remove(p.original_path);
      await this.storage.remove(p.thumbnail_path);
      await manager.query('DELETE FROM photos WHERE id=$1', [id]);
      await manager.query('UPDATE albums SET updated_at=now() WHERE id=$1', [p.album_id]);
    });
  }

  @Get('photos/:id/:variant')
  async image(@Param('id', uuid) id: string, @Param('variant') variant: string, @Res() res: Response) {
    if (!['original', 'thumbnail'].includes(variant)) throw new NotFoundException('Image not found.');
    const rows = await database.query('SELECT * FROM photos WHERE id=$1', [id]);
    if (!rows.length) throw new NotFoundException('Image not found.');
    const p = rows[0];
    let path: string;
    try { path = await this.storage.checkFile(variant === 'original' ? p.original_path : p.thumbnail_path); }
    catch { throw new NotFoundException('Image file not found.'); }
    res.setHeader('Content-Type', variant === 'original' ? p.mime : 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path);
  }
}

@Module({ controllers: [AppController], providers: [Storage] })
export class AppModule {}
