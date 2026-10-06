import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text } from 'react-native';

type Permission = { granted: boolean; canAskAgain: boolean };
let permission: Permission = { granted: false, canAskAgain: true };
let systemPermission = permission;
const subscribers = new Set<() => void>();
const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
let answer: ((p: Permission) => void) | undefined;
let rejectAnswer: ((e: Error) => void) | undefined;
let finish: (() => void) | undefined;
let rejectRecording: (() => void) | undefined;
let nextId = 0;
export const device = {
  requests: 0, stops: 0, records: [] as boolean[], instance: 0, settingsOpened: 0, refreshes: 0,
  controlled: false,
  setPermission(p: Permission) { permission = p; systemPermission = p; subscribers.forEach(f => f()); },
  setSystemPermission(p: Permission) { systemPermission = p; },
  answer(p: Permission) { device.setPermission(p); answer?.(p); answer = undefined; rejectAnswer = undefined; },
  rejectPermission() { rejectAnswer?.(new Error('Simulated permission error')); answer = undefined; rejectAnswer = undefined; },
  finish() { finish?.(); },
  failRecording() { rejectRecording?.(); },
};
const request = () => {
  device.requests++;
  if (!device.controlled) {
    const granted = { granted: true, canAskAgain: true };
    device.setPermission(granted); return Promise.resolve(granted);
  }
  return new Promise<Permission>((resolve, reject) => { answer = resolve; rejectAnswer = reject; });
};
const refresh = async () => { device.refreshes++; device.setPermission(systemPermission); return permission; };
export const useMicrophonePermissions = () => [useSyncExternalStore(subscribe, () => permission), request, refresh] as const;
export const ImpactFeedbackStyle = { Light: 'light' };
export const impactAsync = async () => {};
export const supportsLiveColour = false;
export const LiveLookPreview = ({ onStatus }: { onStatus: (status: 'unavailable') => void }) => {
  useEffect(() => { onStatus('unavailable'); }, [onStatus]);
  return null;
};

type CameraHandle = {
  getAvailableLensesAsync: () => Promise<string[]>;
  recordAsync: () => Promise<{ uri: string }>;
  stopRecording: () => void;
};
export const CameraView = forwardRef<CameraHandle, { mute: boolean; onCameraReady: () => void; style: object }>(function CameraView(props, ref) {
  const [id] = useState(() => ++nextId);
  const mute = useRef(props.mute); mute.current = props.mute;
  const automaticStop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    device.instance = id;
    const timer = setTimeout(props.onCameraReady, 50);
    return () => { clearTimeout(timer); if (automaticStop.current) clearTimeout(automaticStop.current); };
  }, []);
  useImperativeHandle(ref, () => ({
    getAvailableLensesAsync: async () => ['builtInWideAngleCamera', 'builtInTelephotoCamera'],
    recordAsync: () => new Promise((resolve, reject) => {
      device.records.push(mute.current);
      const clear = () => { clearTimeout(automaticStop.current); finish = undefined; rejectRecording = undefined; };
      finish = () => { clear(); resolve({ uri: 'simulated://clip.mov' }); };
      rejectRecording = () => { clear(); reject(new Error('Simulated recording failure. Please try again.')); };
      automaticStop.current = setTimeout(() => finish?.(), 15000);
    }),
    // Hold completion until device.finish() so finishing/duplicate taps can be exercised.
    stopRecording: () => { device.stops++; if (!device.controlled) setTimeout(() => finish?.(), 500); },
  }), []);
  return <View style={[props.style, { backgroundColor: '#37423a', alignItems: 'center', justifyContent: 'center' }]}>
    <View style={{ width: '70%', height: '45%', borderRadius: 24, backgroundColor: '#647965', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#f5f1e8', fontSize: 20 }}>Camera rehearsal</Text>
      <Text style={{ color: '#f5f1e8', marginTop: 12 }}>No photo or video is recorded</Text>
    </View>
    <Text testID="device-audio" style={{ marginTop: 16, color: '#fff' }}>{props.mute ? 'Microphone disconnected' : 'Microphone connected'}</Text>
  </View>;
});
