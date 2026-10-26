const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

function discover(projectId) {
  const script = `
    const path = require('node:path');
    const loader = require(path.join(path.dirname(require.resolve('firebase-functions/params')), '../runtime/loader.js'));
    loader.loadStack(process.cwd()).then(stack => {
      process.stdout.write(JSON.stringify({
        parameters: (stack.params || []).map(param => param.name),
        secretBindings: Object.values(stack.endpoints).flatMap(endpoint => endpoint.secretEnvironmentVariables || []).map(binding => binding.key),
        endpointCount: Object.keys(stack.endpoints).length,
        endpointRegions: Object.fromEntries(Object.entries(stack.endpoints).map(([name, endpoint]) => [name, endpoint.region])),
      }));
    }).catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId },
    encoding: 'utf8', timeout: 20_000,
  }));
}

test('Firebase deployment manifest for customer beta declares no RevenueCat parameters or secret bindings', () => {
  const manifest = discover('dispatch-customer-beta');
  assert.ok(manifest.endpointCount > 0);
  assert.deepEqual(manifest.parameters.filter(name => name.startsWith('REVENUECAT_')), []);
  assert.deepEqual(manifest.secretBindings.filter(name => name.startsWith('REVENUECAT_')), []);
  for (const [name, regions] of Object.entries(manifest.endpointRegions)) {
    assert.deepEqual(regions, ['northamerica-northeast1'], `${name} must use the customer backend region`);
  }
});

for (const projectId of ['dispatch-billing-qa', 'dispatch-eb63a']) {
  test(`Firebase deployment manifest retains all RevenueCat credentials for ${projectId}`, () => {
    const manifest = discover(projectId);
    assert.deepEqual(manifest.parameters.filter(name => name.startsWith('REVENUECAT_')).sort(), [
      'REVENUECAT_ALLOWED_APP_IDS', 'REVENUECAT_EXPECTED_ENVIRONMENT', 'REVENUECAT_PROJECT_ID',
      'REVENUECAT_SECRET_API_KEY', 'REVENUECAT_V2_SECRET_API_KEY',
      'REVENUECAT_WEBHOOK_AUTHORIZATION', 'REVENUECAT_WEBHOOK_SIGNING_SECRET',
    ]);
    assert.ok(manifest.secretBindings.includes('REVENUECAT_SECRET_API_KEY'));
    assert.ok(manifest.secretBindings.includes('REVENUECAT_V2_SECRET_API_KEY'));
    for (const [name, regions] of Object.entries(manifest.endpointRegions)) {
      assert.deepEqual(regions, ['us-central1'], `${name} must retain its existing region`);
    }
  });
}
