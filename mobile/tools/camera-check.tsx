import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Linking } from 'react-native';
import { CameraScreen } from '../src/screens/CameraScreen';
import { DeviceFrame } from '../src/components/DeviceFrame';
import { DEFAULT_SETTINGS, normalize } from '../src/settingsCore';
import { device } from './camera-device';

let restart: () => void;
let reset: () => void;
const captures: string[] = [];
function Check() {
  const [generation, setGeneration] = useState(0);
  const [settings, setSettings] = useState(() => normalize(JSON.parse(localStorage.getItem('camera-check-settings') ?? '{}')));
  restart = () => setGeneration(n => n + 1);
  reset = () => { setSettings(DEFAULT_SETTINGS); restart(); };
  return <SafeAreaProvider><DeviceFrame><CameraScreen key={generation} settings={settings}
    onVideoSoundChange={videoSound => setSettings(s => {
      const next = { ...s, videoSound }; localStorage.setItem('camera-check-settings', JSON.stringify(next)); return next;
    })} onCameraChange={defaultCamera => setSettings(s => ({ ...s, defaultCamera }))}
    onCapture={async () => {}} onCaptureVideo={async uri => { captures.push(uri); }} videoAvailable
    onGallery={() => {}} onSettings={() => {}} onDismissError={() => {}} lastThumb={null} backendReady={false} cloudEnabled={false} />
  </DeviceFrame></SafeAreaProvider>;
}
createRoot(document.getElementById('root')!).render(<Check />);

declare global {
  interface Window { runCameraChecks: () => Promise<string[]>; cameraDevice: typeof device; }
}
window.cameraDevice = device;
Linking.openSettings = async () => { device.settingsOpened++; };
const delay = (ms = 80) => new Promise(resolve => setTimeout(resolve, ms));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="button"]'))
  .find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label);
const disabled = (el: HTMLElement | undefined) => !el || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled');
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 80; i++) { if (condition()) return; await delay(25); }
  throw new Error('Timed out waiting for the camera UI');
};
const click = async (label: string) => {
  const el = button(label); assert(el && !disabled(el), `Expected enabled ${label}`); el!.click(); await delay();
};
const ready = () => waitFor(() => !disabled(button('Record video')));
const setForeground = (active: boolean) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: active ? 'visible' : 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
};
window.runCameraChecks = async () => {
  device.controlled = true;
  const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  try {
    const results: string[] = [];
    localStorage.setItem('camera-check-settings', JSON.stringify(DEFAULT_SETTINGS));
    device.setPermission({ granted: false, canAskAgain: true });
    device.requests = 0; device.stops = 0; device.records = []; captures.length = 0;
    reset(); await delay();
    await click('VIDEO'); await ready();
    assert(device.requests === 0, 'Entering video must not request microphone access');
    await click('Record video');
    assert(device.records.at(-1) === true, 'Unpermitted recording must be muted');
    assert(disabled(button('Enable video sound')), 'Sound control must be locked while recording');
    await click('Stop recording');
    assert(disabled(button('Finishing clip')), 'Finishing must not allow another recording');
    button('Finishing clip')?.click(); await delay();
    assert(device.records.length === 1 && device.stops === 1, 'Rapid stop taps must not start/stop twice');
    device.finish(); await ready();
    assert(captures.length === 1, 'Finished clip must be delivered exactly once');
    results.push('Silent capture without permission; controls locked; stop/finish delivered once');

    await click('Enable video sound');
    assert(disabled(button('Record video')) && disabled(button('PHOTO')), 'Permission request must lock shutter/mode');
    button('Enable video sound')?.click(); await delay();
    assert(device.requests === 1, 'Rapid sound taps must not request twice');
    device.answer({ granted: true, canAskAgain: true }); await ready();
    assert(button('Mute video sound'), 'Grant must enable sound');
    await click('Record video');
    assert(device.records.at(-1) === false, 'Granted sound recording must unmute the native camera');
    const recordingInstance = device.instance;
    device.setPermission({ granted: false, canAskAgain: true }); await delay();
    assert(device.instance === recordingInstance, 'A late permission update must not replace a recording camera');
    assert(document.querySelector('[data-testid="device-audio"]')?.textContent === 'Microphone connected', 'Audio must stay fixed for the clip');
    device.finish(); await ready();
    results.push('Permission requests serialized; granted audio recorded; clip survives late permission changes');

    device.setPermission({ granted: true, canAskAgain: true }); await delay(); await ready();
    await click('Mute video sound'); await ready();
    await click('PHOTO'); await click('VIDEO'); await ready();
    assert(button('Enable video sound'), 'Explicit mute must survive mode changes');
    restart(); await delay(); await click('VIDEO'); await ready();
    assert(button('Enable video sound'), 'Explicit mute must survive returning to the camera');
    assert(JSON.parse(localStorage.getItem('camera-check-settings')!).videoSound === false, 'Mute choice must be persisted');
    await click('Record video');
    assert(device.records.at(-1) === true, 'Granted permission must not override explicit mute');
    device.failRecording(); await ready();
    assert(document.body.textContent?.includes('Simulated recording failure'), 'Recording failure must be explained');
    results.push('Explicit mute retained across modes/remount; failed recording releases controls');

    device.setPermission({ granted: false, canAskAgain: true }); await delay();
    await click('Enable video sound'); device.answer({ granted: false, canAskAgain: false }); await ready();
    assert(button('Open Settings to enable video sound'), 'Permanent denial must offer Settings');
    await click('Record video'); assert(device.records.at(-1) === true, 'Denial must still allow silent video');
    device.finish(); await ready();
    results.push('Permission denial explains recovery and still permits silent clips');

    await click('Open Settings to enable video sound');
    assert(device.settingsOpened > 0, 'Blocked permission must open system Settings');
    setForeground(false); await delay();
    assert(!document.querySelector('[data-testid="device-audio"]'), 'Camera must release on background');
    device.setSystemPermission({ granted: true, canAskAgain: true });
    setForeground(true); await delay(); await ready();
    assert(button('Mute video sound') && device.refreshes > 0, 'Returning from Settings must refresh permission');
    await click('Record video');
    const stopsBefore = device.stops;
    setForeground(false); await delay();
    assert(device.stops === stopsBefore + 1, 'Background must stop the current recording once');
    device.finish(); await delay(); setForeground(true); await delay(); await ready();
    results.push('System Settings recovery refreshes permission; background releases camera and stops recording');

    device.setPermission({ granted: false, canAskAgain: true }); await delay();
    await click('Enable video sound'); device.rejectPermission(); await ready();
    assert(document.body.textContent?.includes('Could not enable the microphone'), 'Permission failure must permit retry');
    await click('Enable video sound'); device.answer({ granted: true, canAskAgain: true }); await ready();
    assert(button('Mute video sound'), 'Retry must recover sound');
    results.push('Permission error releases locks and retry succeeds');
    return results;
  } finally {
    device.controlled = false;
    if (visibility) Object.defineProperty(document, 'visibilityState', visibility);
    else Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  }
};

const run = document.getElementById('run') as HTMLButtonElement;
run.onclick = async () => {
  run.disabled = true; run.textContent = 'Checking…';
  try {
    const results = await window.runCameraChecks();
    document.getElementById('results')!.textContent = results.map(r => 'PASS · ' + r).join('\n\n');
  } catch (error) {
    document.getElementById('results')!.textContent = String(error);
  } finally {
    run.disabled = false; run.textContent = 'Run checks';
    (document.getElementById('report') as HTMLDialogElement).showModal();
  }
};
