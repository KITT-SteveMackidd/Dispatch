import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const major = value => Number(String(value || '').match(/^(?:\^|~)?(\d+)\./)?.[1]);

export function compatibilityErrors({ deviceSdk, installedExpo, declaredExpo, publishedSdk, manifestSdk }) {
  const errors = [];
  if (!Number.isInteger(deviceSdk) || deviceSdk < 1) errors.push('The confirmed iPhone Expo Go SDK is missing.');
  if (major(installedExpo) !== deviceSdk) errors.push(`Installed Expo ${installedExpo} does not match the confirmed iPhone SDK ${deviceSdk}.`);
  if (major(declaredExpo) !== deviceSdk) errors.push(`package.json Expo ${declaredExpo} does not match the confirmed iPhone SDK ${deviceSdk}.`);
  if (major(publishedSdk) > deviceSdk) errors.push(`Expo Go now advertises SDK ${publishedSdk}. Confirm the phone version and update the compatibility target before handoff.`);
  if (manifestSdk !== undefined && major(manifestSdk) !== deviceSdk) errors.push(`The running server serves SDK ${manifestSdk || 'unknown'}, not the confirmed iPhone SDK ${deviceSdk}. Stop the stale Metro instance and restart this checkout.`);
  return errors;
}

async function main() {
  const policy = JSON.parse(readFileSync(path.join(root, 'config/expo-go-compatibility.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const installedExpo = require('expo/package.json').version;
  const baseline = compatibilityErrors({ deviceSdk: policy.iosSdkMajor, installedExpo, declaredExpo: pkg.dependencies.expo });
  if (baseline.length) throw new Error(baseline.join('\n'));
  const expoRequire = createRequire(require.resolve('expo/package.json'));
  const { exp } = expoRequire('@expo/config').getConfig(root);
  if (major(exp.sdkVersion) !== policy.iosSdkMajor) throw new Error(`Resolved app configuration uses SDK ${exp.sdkVersion}, not the confirmed iPhone SDK ${policy.iosSdkMajor}.`);
  const versionsResponse = await fetch('https://exp.host/--/api/v2/versions', { signal: AbortSignal.timeout(15000) });
  if (!versionsResponse.ok) throw new Error('Expo compatibility metadata is unavailable; do not claim the phone build is verified.');
  const payload = await versionsResponse.json();
  const versions = payload.data || payload;
  if (!Number.isFinite(major(versions.expoGoSdkVersion)) || !versions.sdkVersions?.[`${policy.iosSdkMajor}.0.0`]?.iosClientUrl) {
    throw new Error('Expo did not confirm an iOS client for the recorded device SDK.');
  }
  let manifestSdk;
  let bundleUrl;
  const urlIndex = process.argv.indexOf('--url');
  if (urlIndex >= 0) {
    const url = new URL(process.argv[urlIndex + 1]);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Verify only a local Metro URL.');
    const response = await fetch(url, { headers: { 'expo-platform': 'ios', accept: 'application/expo+json,application/json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Local iOS manifest returned HTTP ${response.status}.`);
    const manifest = await response.json();
    manifestSdk = manifest.extra?.expoClient?.sdkVersion || manifest.sdkVersion || '';
    const servedRoot = manifest.extra?.expoGo?.developer?.projectRoot;
    if (typeof servedRoot !== 'string' || path.resolve(servedRoot).toLowerCase() !== path.resolve(root).toLowerCase()) {
      throw new Error('Metro is not serving this checkout, or its project root could not be verified.');
    }
    const launchAsset = new URL(manifest.launchAsset?.url || '', url);
    if (!launchAsset.pathname.endsWith('.bundle') || launchAsset.searchParams.get('platform') !== 'ios') throw new Error('The manifest does not identify an iOS launch bundle.');
    // Fetch from the checked local server even when Metro advertises its LAN address.
    bundleUrl = new URL(launchAsset.pathname + launchAsset.search, url);
  }
  const errors = compatibilityErrors({ deviceSdk: policy.iosSdkMajor, installedExpo, declaredExpo: pkg.dependencies.expo, publishedSdk: versions.expoGoSdkVersion, manifestSdk });
  if (errors.length) throw new Error(errors.join('\n'));
  if (bundleUrl) {
    const bundle = await fetch(bundleUrl, { signal: AbortSignal.timeout(180000) });
    if (!bundle.ok || !bundle.headers.get('content-type')?.includes('javascript')) throw new Error(`The iOS bundle did not compile successfully (HTTP ${bundle.status}). Check Metro output.`);
    const bytes = (await bundle.arrayBuffer()).byteLength;
    if (!bytes) throw new Error('The iOS bundle is empty.');
    console.log(`Local iOS bundle passed: HTTP ${bundle.status}, ${bytes} bytes.`);
  }
  console.log(`Expo Go compatibility passed: confirmed iPhone SDK ${policy.iosSdkMajor}; installed Expo ${installedExpo}${manifestSdk ? `; served iOS SDK ${manifestSdk}` : ''}.`);
  if (major(versions.expoGoSdkVersion) < policy.iosSdkMajor) console.log('Expo public metadata lags the confirmed phone; the newer device requirement remains authoritative.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Expo Go compatibility blocked: ${error.message}`); process.exitCode = 1; });
}
