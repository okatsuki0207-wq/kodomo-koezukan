import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_GUIDE_DISMISSED_KEY,
  detectInstallPlatform,
  isIosSafari,
  isStandaloneDisplay,
  loadInstallGuideDismissed,
  persistInstallGuideDismissed,
} from '../src/lib/installGuide.ts';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('platform detection separates ios, android, and other readers', () => {
  assert.equal(detectInstallPlatform(IPHONE_SAFARI), 'ios');
  assert.equal(detectInstallPlatform(IPHONE_CHROME), 'ios');
  assert.equal(detectInstallPlatform(ANDROID_CHROME), 'android');
  assert.equal(detectInstallPlatform(DESKTOP), 'other');
});

test('ios safari detection excludes other ios browsers that cannot add from their menus', () => {
  assert.equal(isIosSafari(IPHONE_SAFARI), true);
  assert.equal(isIosSafari(IPHONE_CHROME), false);
  assert.equal(isIosSafari(ANDROID_CHROME), false);
});

test('standalone display accepts either the media query or the ios flag', () => {
  assert.equal(isStandaloneDisplay(true, undefined), true);
  assert.equal(isStandaloneDisplay(false, true), true);
  assert.equal(isStandaloneDisplay(false, false), false);
  assert.equal(isStandaloneDisplay(false, undefined), false);
});

test('the first-launch guide dismissal persists under its own key', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  assert.equal(loadInstallGuideDismissed(storage), false);
  persistInstallGuideDismissed(storage);
  assert.equal(values.get(INSTALL_GUIDE_DISMISSED_KEY), '1');
  assert.equal(loadInstallGuideDismissed(storage), true);
});
