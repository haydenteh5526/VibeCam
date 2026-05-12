import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { progress: number };

export function UploadingScreen({ progress }: Props) {
  return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.mid}>
        <Text style={s.pct}>{Math.round(progress * 100)}%</Text>
        <View style={s.bar}><View style={[s.fill, { width: `${progress * 100}%` }]} /></View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  mid: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  pct: { fontSize: 44, fontWeight: '200', color: '#fff', marginBottom: 16 },
  bar: { width: '60%', height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#fff' },
});
