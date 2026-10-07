import React, { useEffect, useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FILTERS, type FilterId } from '../filters';
import { LOOK_SAMPLES } from '../look/samples';
import { Icon, theme } from './ui';

export function CameraBody({ color, accent, small = false }: { color: string; accent: string; small?: boolean }) {
  return <View accessible={false} style={[s.body, { backgroundColor: color }, small && { transform: [{ scale: 0.8 }] }]}>
    <View style={s.flash} /><View style={s.grip} /><View style={[s.lens, { borderColor: accent }]}><View style={s.glass}><View style={s.glint} /></View></View>
    <View style={[s.led, { backgroundColor: accent }]} />
  </View>;
}
export function CameraPicker({ active, onSelect, showAuto = false, showOriginal = false, disabled = false }: {
  active: string; onSelect: (id: FilterId | 'auto') => void; showAuto?: boolean; showOriginal?: boolean; disabled?: boolean;
}) {
  const scroll = useRef<ScrollView>(null);
  const cameras = FILTERS.filter(f => showOriginal || f.id !== 'original');
  const index = cameras.findIndex(f => f.id === active) + (showAuto ? 1 : 0);
  useEffect(() => { scroll.current?.scrollTo({ x: Math.max(0, index * 112 - 100), animated: true }); }, [index]);
  return <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} style={s.strip} contentContainerStyle={s.row}>
    {showAuto && <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel="Automatic camera selection" onPress={() => onSelect('auto')} style={[s.card, active === 'auto' && s.selected]}><Icon name="sparkles-outline" color={theme.accent} /><Text style={s.name}>Auto</Text></Pressable>}
    {cameras.map(camera => <Pressable key={camera.id} disabled={disabled} onPress={() => onSelect(camera.id)} accessibilityRole="button"
      accessibilityLabel={`${camera.name}, ${camera.tagline}`} accessibilityState={{ selected: camera.id === active, disabled }}
      style={({ pressed }) => [s.card, camera.id === active && s.selected, pressed && { opacity: 0.7 }]}>
      <Image source={LOOK_SAMPLES[camera.id]} style={s.sample} accessible={false} />
      <Text numberOfLines={1} style={[s.name, camera.id === active && { color: theme.accent }]}>{camera.name}</Text>
      <View style={[s.marker, camera.id === active && { backgroundColor: theme.accent }]} />
    </Pressable>)}
  </ScrollView>;
}
const s = StyleSheet.create({
  strip: { flexGrow: 0, flexShrink: 0 }, row: { paddingHorizontal: 18, gap: 8, paddingVertical: 6 },
  card: { width: 104, minHeight: 102, borderRadius: 13, borderWidth: 1, borderColor: 'transparent', padding: 4, alignItems: 'center', justifyContent: 'center' },
  sample: { width: 94, height: 66, borderRadius: 9, marginBottom: 4 },
  selected: { backgroundColor: theme.surface, borderColor: theme.line },
  name: { color: theme.muted, fontWeight: '600', fontSize: 12, marginTop: 2 }, marker: { width: 16, height: 2, marginTop: 6, borderRadius: 1 },
  body: { width: 64, height: 41, borderRadius: 8, borderWidth: 1, borderColor: '#ffffff25', justifyContent: 'center', alignItems: 'center' },
  lens: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#aaa', backgroundColor: '#161815', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  glass: { width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: '#454e49', backgroundColor: '#0c1717' },
  glint: { width: 5, height: 5, backgroundColor: '#ffffff50', borderRadius: 3, margin: 2 },
  flash: { position: 'absolute', top: 5, left: 6, width: 12, height: 5, borderRadius: 1, backgroundColor: '#dedfd380' },
  grip: { position: 'absolute', left: 4, bottom: 5, width: 6, height: 20, borderRadius: 2, backgroundColor: '#00000040' },
  led: { position: 'absolute', right: 5, top: 6, width: 3, height: 3, borderRadius: 2 },
});
