import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

type Props = { onAllow: () => void };

export function PermissionScreen({ onAllow }: Props) {
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
        <Text style={s.p}>VibeCam needs permission to use your camera for capturing photos and video.</Text>
        <Pressable style={({ pressed }) => [s.btn, pressed && s.btnPressed]} onPress={onAllow}>
          <Text style={s.btnT}>Continue</Text>
        </Pressable>
        <Text style={s.footnote}>You can change this later in Settings</Text>
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
