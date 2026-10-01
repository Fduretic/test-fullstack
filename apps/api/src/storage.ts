import { Injectable, BadRequestException, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { mkdir, realpath, writeFile, unlink, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, sep, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

sharp.cache(false);
sharp.concurrency(1);

function isAnimatedPng(buffer: Buffer): boolean {
  // libvips may expose only the first frame of APNG, so check its chunk table too.
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) break;
    if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}

@Injectable()
export class Storage {
  private root = '';
  private processing = false;

  async initialize() {
    const configured = process.env.STORAGE_PATH;
    if (!configured || !isAbsolute(configured)) throw new Error('STORAGE_PATH must be an absolute directory.');
    await mkdir(configured, { recursive: true });
    this.root = await realpath(configured);
    for (const directory of ['originals', 'thumbnails']) {
      await mkdir(resolve(this.root, directory), { recursive: true });
      if (await realpath(resolve(this.root, directory)) !== resolve(this.root, directory)) {
        throw new Error('Storage subdirectories must not be symlinks.');
      }
    }
    await this.probe();
  }

  path(relative: string) {
    const full = resolve(this.root, relative);
    if (!this.root || isAbsolute(relative) || !full.startsWith(this.root + sep)) {
      throw new BadRequestException('Invalid file path.');
    }
    return full;
  }

  async probe() {
    try {
      for (const dir of ['originals', 'thumbnails']) {
        const file = this.path(`${dir}/.probe-${randomUUID()}`);
        await writeFile(file, '', { flag: 'wx', mode: 0o600 });
        await unlink(file);
      }
    } catch { throw new ServiceUnavailableException('Photo storage is unavailable.'); }
  }

  async checkFile(relative: string) {
    const path = this.path(relative);
    const actual = await realpath(path);
    if (actual !== path || !actual.startsWith(this.root + sep)) throw new BadRequestException('Invalid file path.');
    await access(actual, constants.R_OK);
    return actual;
  }

  async remove(relative: string) {
    try { await unlink(this.path(relative)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  async save(file: Express.Multer.File, id: string) {
    // Keep decoding serial even if a client disconnects while Sharp is still running.
    if (this.processing) throw new HttpException('Another image is processing. Please retry in a moment.', 429);
    this.processing = true;
    try { return await this.saveFile(file, id); }
    finally { this.processing = false; }
  }

  private async saveFile(file: Express.Multer.File, id: string) {
    if (!file || !file.buffer.length) throw new BadRequestException('Choose a JPEG, PNG or WebP image.');
    if (file.size > 10 * 1024 * 1024) throw new BadRequestException('Images must be 10 MB or smaller.');
    let metadata: Metadata;
    let thumbnail: Buffer;
    try {
      metadata = await sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'warning', animated: true }).metadata();
      const formats: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      const expected = formats[metadata.format ?? ''];
      if (!expected || expected !== file.mimetype || (metadata.pages ?? 1) !== 1 || isAnimatedPng(file.buffer) || !metadata.width || !metadata.height) {
        throw new Error('Unsupported image');
      }
      thumbnail = await sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'warning' })
        .rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new BadRequestException('Use a valid, non-animated JPEG, PNG or WebP image up to 40 megapixels.');
    }
    const originalPath = `originals/${id}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`;
    const thumbnailPath = `thumbnails/${id}.webp`;
    try {
      await writeFile(this.path(originalPath), file.buffer, { flag: 'wx', mode: 0o640 });
      await writeFile(this.path(thumbnailPath), thumbnail, { flag: 'wx', mode: 0o640 });
    } catch (error) {
      await Promise.all([this.remove(originalPath), this.remove(thumbnailPath)]);
      throw error;
    }
    const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    return { originalPath, thumbnailPath, width: rotated ? metadata.height! : metadata.width!, height: rotated ? metadata.width! : metadata.height! };
  }
}
