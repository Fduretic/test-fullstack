// Local-only integration harness. It emulates the mount supplied by VPS Admin;
// test volumes, loopback ports and resource constraints never enter production Compose.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const exec = promisify(execFile);
await mkdir('.local', { recursive: true });
const projects = ['albumchecka', 'albumcheckb'];
let credentials;
try { credentials = JSON.parse(await readFile('.local/credentials.json', 'utf8')); }
catch { credentials = { password: randomBytes(24).toString('hex') }; await writeFile('.local/credentials.json', JSON.stringify(credentials), { mode: 0o600 }); }
const env = { ...process.env, POSTGRES_PASSWORD: credentials.password };
const reports = [];
function report(message) { reports.push(message); console.log(`PASS ${message}`); }
async function docker(args, options = {}) {
  try { return (await exec('docker', args, { env, timeout: 240_000, maxBuffer: 8 * 1024 * 1024, ...options })).stdout.trim(); }
  catch (error) {
    const safe = String(error.stderr || error.message).replaceAll(credentials.password, '[redacted]');
    throw new Error(`docker ${args.slice(0, 3).join(' ')} failed: ${safe}`);
  }
}
const override = `services:
  api:
    image: fullstack-with-storage-api:latest
    volumes:
      - test_uploads:/app/uploads
  web:
    image: fullstack-with-storage-web:latest
    ports:
      - "127.0.0.1:0:80"
volumes:
  test_uploads:
`;
await writeFile('.local/compose.test.yaml', override);
const compose = (project, args) => docker(['compose', '-p', project, '-f', 'compose.yaml', '-f', '.local/compose.test.yaml', ...args], { env: { ...env, APP_BASE_PATH: project === projects[0] ? '/gallery/' : '/' } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(base, path, options = {}, expected = 200) {
  const response = await fetch(new URL(path, base), options);
  const body = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  return body;
}
const json = (body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function upload(buffer, type = 'image/png', name = 'memory.png') {
  const form = new FormData(); form.set('file', new Blob([buffer], { type }), name);
  return { method: 'POST', body: form };
}
function pngChunk(type, data) {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
async function ready(url) {
  for (let attempt = 0; attempt < 45; attempt++) {
    try { if ((await fetch(new URL('api/health', url))).ok) return; } catch {}
    await sleep(1000);
  }
  throw new Error(`Readiness timed out: ${url}`);
}
const runtime = {};
try {
  const validated = JSON.parse(await compose(projects[0], ['config', '--format', 'json']));
  assert.ok(validated.services.web);
  report('Compose configuration resolves successfully with representative environment values');
  for (const project of projects) {
    console.log(`Starting isolated project ${project}…`);
    await compose(project, ['up', '-d', 'database']);
    for (let i = 0; i < 30; i++) {
      try { await compose(project, ['exec', '-T', 'database', 'pg_isready', '-U', 'app', '-d', 'app']); break; } catch { await sleep(1000); }
    }
    const migration = await compose(project, ['run', '--rm', '--no-deps', 'api', 'node', 'apps/api/dist/migrate.js']);
    report(`${project}: migration completed (${migration.split('\n').at(-1)})`);
    const repeated = await compose(project, ['run', '--rm', '--no-deps', 'api', 'node', 'apps/api/dist/migrate.js']);
    assert.match(repeated, /0 applied/);
    report(`${project}: existing schema migration is repeatable`);
    // The manifest's injected mount must be writable by the numeric application user.
    await compose(project, ['run', '--rm', '--no-deps', '--user', '0:0', 'api', 'node', '-e', "require('fs').chownSync('/app/uploads',10001,10001)"]);
    await compose(project, ['up', '-d', '--no-build', '--wait', '--wait-timeout', '120']);
    const port = (await compose(project, ['port', 'web', '80'])).split(':').at(-1);
    const origin = `http://127.0.0.1:${port}/`;
    const base = project === projects[0] ? origin + 'gallery/' : origin;
    runtime[project] = { origin, base };
    const ids = (await compose(project, ['ps', '-q'])).split('\n').filter(Boolean);
    await docker(['update', '--memory', '768m', '--memory-swap', '768m', '--cpus', '2', '--pids-limit', '256', ...ids]);
    await ready(base);
    await compose(project, ['exec', '-T', 'api', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1))"]);
    await compose(project, ['exec', '-T', 'web', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1/health']);
    report(`${project}: all three service probes pass inside their containers; resource limits applied`);
  }
  await writeFile('.local/runtime.json', JSON.stringify(runtime, null, 2));
  const { base, origin } = runtime[projects[0]];
  const second = runtime[projects[1]].base;
  const home = await (await fetch(base)).text();
  assert.ok(home.includes('<base href="/gallery/">'));
  const deep = await (await fetch(base + 'albums/new')).text(); assert.ok(deep.includes('<app-root>'));
  const script = home.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(base + script)).status, 200);
  assert.equal((await fetch(origin + script)).status, 200);
  await request(origin, 'api/health');
  report('Prefix-preserving and prefix-stripping proxies both resolve frontend assets and relative API URLs');
  const album = await request(base, 'api/albums', json({ name: 'Deployment verification', description: 'Persistence and isolation test' }), 201);
  await request(base, `api/albums/${album.id}`, json({ name: 'Verified album', description: 'Updated successfully' }, 'PATCH'));
  const buffer = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#77a6b6' } }).png().toBuffer();
  const photo = await request(base, `api/albums/${album.id}/photos`, upload(buffer), 201);
  assert.equal(photo.width, 1200); assert.equal(photo.height, 800);
  const thumb = await fetch(new URL(photo.thumbnailUrl, base));
  assert.equal(thumb.headers.get('content-type'), 'image/webp');
  const metadata = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
  assert.ok(metadata.width <= 480 && metadata.height <= 480);
  const original = await fetch(new URL(photo.originalUrl, base));
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), buffer);
  const loaded = await request(base, `api/albums/${album.id}`);
  assert.equal(loaded.photos.length, 1); assert.equal(loaded.coverUrl, photo.thumbnailUrl);
  report('Album CRUD, original upload bytes, generated thumbnail dimensions and automatic cover verified');
  const existingMigration = await compose(projects[0], ['run', '--rm', '--no-deps', 'api', 'node', 'apps/api/dist/migrate.js']);
  assert.match(existingMigration, /0 applied/);
  assert.equal((await request(base, `api/albums/${album.id}`)).photoCount, 1);
  report('Migration rerun preserves an existing album and its uploaded photo');
  await request(base, 'api/albums', json({ name: ' ' }), 400);
  await request(base, 'api/albums', json({ name: 'x'.repeat(121) }), 400);
  await request(base, 'api/albums/not-a-uuid', {}, 400);
  await request(base, `api/albums/${album.id}/photos`, upload(Buffer.from('not an image')), 400);
  await request(base, `api/albums/${album.id}/photos`, upload(buffer, 'image/jpeg'), 400);
  const animation = await sharp(Buffer.concat([Buffer.alloc(300, 70), Buffer.alloc(300, 180)]), { raw: { width: 10, height: 20, pageHeight: 10, channels: 3 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animation, { animated: true }).metadata()).pages, 2);
  await request(base, `api/albums/${album.id}/photos`, upload(animation, 'image/webp', 'animated.webp'), 400);
  const animationControl = Buffer.alloc(8); animationControl.writeUInt32BE(1);
  const frameControl = Buffer.alloc(26); frameControl.writeUInt32BE(1200, 4); frameControl.writeUInt32BE(800, 8); frameControl.writeUInt16BE(1, 20); frameControl.writeUInt16BE(10, 22);
  const apng = Buffer.concat([buffer.subarray(0, 33), pngChunk('acTL', animationControl), pngChunk('fcTL', frameControl), buffer.subarray(33)]);
  await request(base, `api/albums/${album.id}/photos`, upload(apng), 400);
  await request(base, `api/albums/${album.id}/photos`, upload(Buffer.alloc(10 * 1024 * 1024 + 1)), 413);
  const oversizedPixels = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#77a6b6' } }).png().toBuffer();
  await request(base, `api/albums/${album.id}/photos`, upload(oversizedPixels), 400);
  await request(base, 'api/albums/00000000-0000-4000-8000-000000000000/photos', upload(buffer), 404);
  assert.equal((await request(base, `api/albums/${album.id}`)).photoCount, 1);
  const diskCount = await compose(projects[0], ['exec', '-T', 'api', 'node', '-e', "const fs=require('fs'); console.log(fs.readdirSync('/app/uploads/originals').filter(x=>!x.startsWith('.')).length)"]);
  const expectedCount = (await request(base, 'api/albums')).reduce((sum, a) => sum + a.photoCount, 0);
  assert.equal(Number(diskCount), expectedCount);
  report('Invalid input, spoofed MIME, oversized bytes/pixels and missing albums rejected without partial files');
  await compose(projects[0], ['exec', '-T', 'api', 'node', '--input-type=module', '-e', "import {Storage} from './apps/api/dist/storage.js'; const storage=new Storage(); await storage.initialize(); for(const p of ['../outside','/etc/passwd','originals/../../outside']) { let blocked=false; try {storage.path(p)} catch {blocked=true} if(!blocked)process.exit(1); }"]);
  await compose(projects[0], ['exec', '-T', '--user', '0:0', 'api', 'node', '-e', "require('fs').chmodSync('/app/uploads/originals',0o500)"]);
  try {
    await request(base, 'api/health', {}, 503);
    await request(base, `api/albums/${album.id}/photos`, upload(buffer), 500);
    await request(base, `api/photos/${photo.id}`, { method: 'DELETE' }, 500);
    assert.equal((await request(base, `api/albums/${album.id}`)).photoCount, 1);
  } finally {
    await compose(projects[0], ['exec', '-T', '--user', '0:0', 'api', 'node', '-e', "require('fs').chmodSync('/app/uploads/originals',0o755)"]);
  }
  await request(base, 'api/health');
  report('Path traversal is blocked; read-only mount fails readiness and failed file operations preserve database records');
  const otherAlbums = await request(second, 'api/albums');
  assert.ok(!otherAlbums.some(a => a.id === album.id));
  await request(second, photo.originalUrl, {}, 404);
  report('Two Compose project names isolate database records and uploaded images');
  await compose(projects[0], ['up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '120']);
  // Docker may allocate a new ephemeral loopback port after recreation.
  const newPort = (await compose(projects[0], ['port', 'web', '80'])).split(':').at(-1);
  const newBase = `http://127.0.0.1:${newPort}/gallery/`;
  runtime[projects[0]] = { origin: `http://127.0.0.1:${newPort}/`, base: newBase };
  await writeFile('.local/runtime.json', JSON.stringify(runtime, null, 2));
  await ready(newBase);
  assert.equal((await request(newBase, `api/albums/${album.id}`)).photos[0].id, photo.id);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(photo.originalUrl, newBase))).arrayBuffer()), buffer);
  report('Database records and original image bytes survive recreation of every service');
  await compose(projects[0], ['up', '-d', '--no-build', '--force-recreate', '--no-deps', '--wait', 'api']);
  await ready(newBase);
  report('Running Nginx resolves a recreated API container without restarting the web service');
  const ids = (await compose(projects[0], ['ps', '-q'])).split('\n').filter(Boolean);
  await docker(['update', '--memory', '768m', '--memory-swap', '768m', '--cpus', '2', '--pids-limit', '256', ...ids]);
  const loadImage = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#d0efb1' } }).jpeg().toBuffer();
  const samples = []; let sampling = true;
  const apiId = await compose(projects[0], ['ps', '-q', 'api']);
  const sampler = (async () => { while (sampling) { samples.push(await docker(['stats', '--no-stream', '--format', '{{.MemUsage}} / CPU {{.CPUPerc}} / PIDs {{.PIDs}}', apiId])); await sleep(100); } })();
  for (let i = 0; i < 3; i++) {
    const large = await request(newBase, `api/albums/${album.id}/photos`, upload(loadImage, 'image/jpeg', `large-${i}.jpg`), 201);
    await request(newBase, `api/photos/${large.id}`, { method: 'DELETE' }, 204);
  }
  sampling = false; await sampler;
  const inspect = JSON.parse(await docker(['inspect', apiId]))[0];
  assert.equal(inspect.State.OOMKilled, false); assert.equal(inspect.HostConfig.Memory, 805306368);
  const peakBytes = Number(await compose(projects[0], ['exec', '-T', 'api', 'node', '-e', "console.log(require('fs').readFileSync('/sys/fs/cgroup/memory.peak','utf8').trim())"]));
  assert.ok(peakBytes < 768 * 1024 * 1024);
  report(`36 MP uploads pass under 768 MB / 2 CPUs / 256 PIDs; peak ${(peakBytes / 1024 / 1024).toFixed(1)} MiB; samples: ${samples.join('; ')}`);
  await request(newBase, `api/photos/${photo.id}`, { method: 'DELETE' }, 204);
  assert.equal((await request(newBase, `api/albums/${album.id}`)).coverUrl, null);
  await request(newBase, photo.originalUrl, {}, 404);
  await request(newBase, `api/albums/${album.id}`, { method: 'DELETE' }, 204);
  report('Photo and album deletion remove files and correctly update the cover');
  await writeFile('.local/verification.json', JSON.stringify({ at: new Date().toISOString(), reports, runtime }, null, 2));
  console.log(`\nLocal preview: ${runtime[projects[0]].base}\nTest instances remain running. Cleanup instructions are in README.md.`);
} catch (error) {
  await writeFile('.local/verification-failure.txt', String(error));
  console.error(error.message); process.exitCode = 1;
}
