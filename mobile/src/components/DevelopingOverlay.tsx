import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

/**
 * "Developing" overlay shown while the backend renders a shot.
 *
 * Turns unavoidable latency into part of the experience rather than dead time: the
 * frame sits under a darkroom wash while a bar sweeps across it. Purely presentational.
 */
export function DevelopingOverlay({ label = 'Developing' }: { label?: string }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    sweepLoop.start();
    pulseLoop.start();
    return () => { sweepLoop.stop(); pulseLoop.stop(); };
  }, [sweep, pulse]);

  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: ['-40%', '140%'] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={s.wrap} pointerEvents="none">
      <View style={s.wash} />
      <Animated.View style={[s.sweep, { transform: [{ translateY }] }]} />
      <Animated.View style={[s.badge, { opacity }]}>
        <View style={s.led} />
        <Text style={s.text}>{label}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  // Amber darkroom cast rather than plain black — reads as processing, not an error.
  wash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(24,14,4,0.55)' },
  sweep: {
    position: 'absolute', left: 0, right: 0, height: '28%',
    backgroundColor: 'rgba(255,176,60,0.10)',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,196,90,0.22)',
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(12,12,12,0.78)',
    borderWidth: 1, borderColor: 'rgba(255,214,10,0.28)',
  },
  led: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFD60A' },
  text: { color: '#FFD60A', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
});
