import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { hash: string | null; onGallery: () => void; onNew: () => void };

export function DoneScreen({ hash, onGallery, onNew }: Props) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [scale, fade]);

  return (
    <View style={s.bg}><StatusBar style="light" />
      <Animated.View style={[s.card, { opacity: fade, transform: [{ scale }] }]}>
        <View style={s.check}><Text style={s.checkT}>✓</Text></View>
        <Text style={s.title}>Upload Complete</Text>
        <Text style={s.sub}>Your file has been securely uploaded</Text>
        {hash && <View style={s.hashWrap}><Text style={s.hash}>{hash.slice(0, 20)}</Text></View>}
        <View style={s.row}>
          <Pressable style={({ pressed }) => [s.btnO, pressed && s.pressed]} onPress={onGallery}><Text style={s.btnOT}>View Uploads</Text></Pressable>
          <Pressable style={({ pressed }) => [s.btnS, pressed && s.pressed]} onPress={onNew}><Text style={s.btnST}>New Capture</Text></Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: '#18181b', borderRadius: 16, borderWidth: 1, borderColor: '#27272a', padding: 32, alignItems: 'center' },
  check: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(34,197,94,0.1)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  checkT: { fontSize: 22, color: '#22c55e' },
  title: { color: '#fafafa', fontSize: 17, fontWeight: '600', letterSpacing: -0.3, marginBottom: 4 },
  sub: { color: '#71717a', fontSize: 13, marginBottom: 16 },
  hashWrap: { backgroundColor: '#27272a', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginBottom: 20 },
  hash: { color: '#a1a1aa', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  row: { flexDirection: 'row', gap: 8, width: '100%' },
  btnO: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#27272a', alignItems: 'center' },
  btnOT: { color: '#fafafa', fontSize: 13, fontWeight: '500' },
  btnS: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#fafafa', alignItems: 'center' },
  btnST: { color: '#09090b', fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.8 },
});
