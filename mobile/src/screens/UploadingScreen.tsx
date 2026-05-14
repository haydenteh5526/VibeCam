import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { progress: number };

export function UploadingScreen({ progress }: Props) {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.4, duration: 800, useNativeDriver: true }),
    ])).start();
  }, [pulse]);

  return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.card}>
        <Animated.View style={[s.ring, { opacity: pulse }]}>
          <Text style={s.pct}>{Math.round(progress * 100)}</Text>
          <Text style={s.pctSign}>%</Text>
        </Animated.View>
        <View style={s.bar}><View style={[s.fill, { width: `${progress * 100}%` }]} /></View>
        <Text style={s.label}>Uploading your file…</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: '#18181b', borderRadius: 16, borderWidth: 1, borderColor: '#27272a', padding: 32, alignItems: 'center' },
  ring: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 24 },
  pct: { fontSize: 48, fontWeight: '200', color: '#fafafa' },
  pctSign: { fontSize: 18, fontWeight: '300', color: '#71717a', marginLeft: 2 },
  bar: { width: '100%', height: 4, backgroundColor: '#27272a', borderRadius: 2, overflow: 'hidden', marginBottom: 16 },
  fill: { height: '100%', backgroundColor: '#fafafa', borderRadius: 2 },
  label: { color: '#71717a', fontSize: 13 },
});
