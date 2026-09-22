import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { onAllow: () => void; onRoll: () => void; onImport: () => void; canAskAgain: boolean; busy: boolean; error: string };

export function PermissionScreen({ onAllow, onRoll, onImport, canAskAgain, busy, error }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fade, slide]);

  return (
    <View style={s.bg}><StatusBar style="light" />
      <Animated.View style={[s.card, { opacity: fade, transform: [{ translateY: slide }] }]}>
        <View style={s.iconWrap}><View style={s.iconCircle}><Text style={s.iconT}>◉</Text></View></View>
        <Text style={s.h}>Camera Access</Text>
        <Text style={s.p}>{canAskAgain ? 'Allow camera access to take photos and short videos with your favourite compact camera looks.' : 'Camera access is off. Enable it in your device or browser settings to shoot photos and videos. Your Film Roll is still available.'}</Text>
        <Pressable accessibilityRole="button" style={({ pressed }) => [s.btn, pressed && s.btnPressed]} onPress={onAllow}>
          <Text style={s.btnT}>{canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onImport} disabled={busy} style={{ padding: 16 }}><Text style={{ color: '#FFD60A' }}>Import a photo</Text></Pressable>
        <Text style={s.footnote}>JPEG or PNG from Files</Text>
        <Pressable accessibilityRole="button" onPress={onRoll} disabled={busy} style={{ padding: 16 }}><Text style={{ color: '#a1a1aa' }}>Open Film Roll</Text></Pressable>
        {error ? <Text accessibilityRole="alert" style={{ color: '#ff9b9b' }}>{error}</Text> : null}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: '#18181b', borderRadius: 16, borderWidth: 1, borderColor: '#27272a', padding: 32, alignItems: 'center' },
  iconWrap: { marginBottom: 20 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  iconT: { fontSize: 20, color: '#a1a1aa' },
  h: { color: '#fafafa', fontSize: 18, fontWeight: '600', letterSpacing: -0.3, marginBottom: 8 },
  p: { color: '#a1a1aa', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  btn: { width: '100%', backgroundColor: '#fafafa', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  btnPressed: { opacity: 0.85 },
  btnT: { color: '#09090b', fontSize: 14, fontWeight: '600' },
  footnote: { color: '#52525b', fontSize: 12, marginTop: 12 },
});
