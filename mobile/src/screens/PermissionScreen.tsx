import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { onAllow: () => void };

export function PermissionScreen({ onAllow }: Props) {
  return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.mid}>
        <Text style={s.h}>Allow Camera</Text>
        <Text style={s.p}>VibeCam needs camera access to take photos and record video.</Text>
        <Pressable style={s.btn} onPress={onAllow}><Text style={s.btnT}>Allow</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  mid: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  h: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 10 },
  p: { color: 'rgba(255,255,255,0.55)', fontSize: 15, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  btn: { backgroundColor: '#fff', paddingVertical: 13, paddingHorizontal: 36, borderRadius: 24 },
  btnT: { color: '#000', fontSize: 16, fontWeight: '600' },
});
