import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const compose = YAML.parse(readFileSync('compose.yaml', 'utf8'));
const manifest = YAML.parse(readFileSync('vps-admin.yaml', 'utf8'));

test('production Compose uses only allowed contract keys and internal builds', () => {
  const allowed = new Set('image build command entrypoint working_dir environment depends_on healthcheck restart init read_only tmpfs user volumes stop_grace_period expose'.split(' '));
  assert.deepEqual(Object.keys(compose.services).sort(), ['api', 'database', 'web']);
  for (const key of Object.keys(compose)) assert.ok(['services', 'volumes', 'name', 'version'].includes(key));
  for (const [name, service] of Object.entries(compose.services)) {
    assert.ok(service.image || service.build, name);
    assert.ok(service.healthcheck?.test, name);
    for (const key of Object.keys(service)) assert.ok(allowed.has(key), `${name}.${key}`);
    if (service.build) {
      for (const key of Object.keys(service.build)) assert.ok(['context', 'dockerfile', 'args', 'target'].includes(key));
      assert.equal(service.build.context, '.');
      assert.ok(resolve(service.build.dockerfile).startsWith(process.cwd() + '/'));
    }
    for (const value of Object.values(service.environment ?? {})) assert.match(value, /^\$\{[A-Z_]+(?::-[^}]*)?\}$/);
  }
});

test('manifest preserves platform routing, storage and database ownership', () => {
  assert.deepEqual(manifest.public, { service: 'web', port: 80 });
  assert.deepEqual(manifest.routing, { pathPrefix: true });
  assert.deepEqual(manifest.storage, [{ name: 'uploads', service: 'api', path: '/app/uploads' }]);
  assert.deepEqual(manifest.database, { service: 'database', name: 'app', user: 'app', passwordEnv: 'POSTGRES_PASSWORD' });
  assert.equal(manifest.migration.service, 'api');
  assert.deepEqual(manifest.migration.command, ['node', 'apps/api/dist/migrate.js']);
  assert.deepEqual(manifest.schedules, []);
  assert.deepEqual(manifest.services, []);
  assert.equal(compose.services.api.user, '10001:10001');
  assert.ok(!JSON.stringify(compose.services.api.volumes ?? []).includes('/app/uploads'));
  assert.deepEqual(Object.keys(compose.volumes), ['postgres_data']);
  assert.equal(compose.volumes.postgres_data, null);
  const known = new Set(['version', 'compose', 'public', 'routing', 'services', 'technologies', 'environment', 'storage', 'database', 'migration', 'schedules']);
  for (const key of Object.keys(manifest)) assert.ok(known.has(key));
  const declared = new Set(manifest.environment.map(e => e.key));
  for (const service of Object.values(compose.services)) {
    for (const value of Object.values(service.environment ?? {})) assert.ok(declared.has(value.match(/^\$\{([A-Z_]+)/)[1]));
  }
});

test('dependencies and production base images are pinned', () => {
  for (const path of ['package.json', 'apps/api/package.json', 'apps/web/package.json']) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(version, /^\d+\.\d+\.\d+$/);
  }
  for (const path of ['apps/api/Dockerfile', 'apps/web/Dockerfile']) {
    for (const match of readFileSync(path, 'utf8').matchAll(/^FROM (\S+)/gm)) assert.match(match[1], /:\d+\.\d+\.\d+/);
  }
  assert.ok(readFileSync('package-lock.json', 'utf8').length > 1000);
});
