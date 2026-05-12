import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { hash: string | null; onGallery: () => void; onNew: () => void };

export function DoneScreen({ hash, onGallery, onNew }: Props) {
  return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.mid}>
        <View style={s.circle}><Text style={s.mark}>✓</Text></View>
        <Text style={s.title}>Done</Text>
        {hash && <Text style={s.hash}>{hash.slice(0, 16)}</Text>}
        <View style={s.row}>
          <Pressable style={s.btnO} onPress={onGallery}><Text style={s.btnOT}>Uploads</Text></Pressable>
          <Pressable style={s.btnW} onPress={onNew}><Text style={s.btnWT}>New</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  mid: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  circle: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: '#30D158', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  mark: { fontSize: 28, color: '#30D158' },
  title: { fontSize: 20, fontWeight: '500', color: '#fff', marginBottom: 6 },
  hash: { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 28 },
  row: { flexDirection: 'row', gap: 12 },
  btnO: { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)' },
  btnOT: { color: '#fff', fontSize: 15, fontWeight: '500' },
  btnW: { paddingVertical: 11, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#fff' },
  btnWT: { color: '#000', fontSize: 15, fontWeight: '600' },
});
