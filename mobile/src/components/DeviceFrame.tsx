import React from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

/**
 * iPhone-shaped viewport for browser development.
 *
 * On a desktop browser the app would otherwise stretch across the full window, which
 * looks nothing like the phone and makes layout work misleading. This constrains it to
 * iPhone 12 Pro Max logical dimensions (428 x 926 points) inside a bezel, so what you see
 * on the laptop matches what you'd see on the device.
 *
 * On native it renders children untouched — no wrapper, no cost.
 */

/** iPhone 12 Pro Max logical size in points (CSS pixels for react-native-web). */
export const PHONE_WIDTH = 428;
export const PHONE_HEIGHT = 926;

const isWeb = Platform.OS === 'web';

/**
 * Width the app's layout should size against.
 *
 * Inside the web frame this is the frame's width, not the browser window's, so
 * viewfinder and grid maths stay phone-accurate. Screens must use this rather than
 * `Dimensions.get('window')`, which reports the whole browser window.
 */
export function useLayoutWidth(): number {
  const { width } = useWindowDimensions();
  return isWeb ? Math.min(width, PHONE_WIDTH) : width;
}

export function DeviceFrame({ children }: { children: React.ReactNode }) {
  const { height: windowHeight } = useWindowDimensions();

  if (!isWeb) return <>{children}</>;

  // Leave a little breathing room, and never exceed the real device height.
  const frameHeight = Math.min(PHONE_HEIGHT, Math.max(480, windowHeight - 48));

  return (
    <View style={s.page}>
      <View style={[s.bezel, { width: PHONE_WIDTH + 16, height: frameHeight + 16 }]}>
        <View style={[s.screen, { width: PHONE_WIDTH, height: frameHeight }]}>
          {children}
          {/* Dynamic-Island-style cutout, purely so the framing reads as a phone. */}
          <View style={s.island} pointerEvents="none" />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#141416' },
  bezel: {
    backgroundColor: '#000',
    borderRadius: 56,
    padding: 8,
    borderWidth: 2,
    borderColor: '#2a2a2e',
    // Subtle lift so the frame reads as a device sitting on the page.
    ...(Platform.OS === 'web' ? { boxShadow: '0 24px 60px rgba(0,0,0,0.55)' } as object : null),
  },
  screen: { borderRadius: 48, overflow: 'hidden', backgroundColor: '#0c0c0c' },
  island: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    width: 116,
    height: 30,
    borderRadius: 16,
    backgroundColor: '#000',
  },
});
