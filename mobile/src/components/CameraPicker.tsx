import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FILTERS, type FilterId } from '../filters';

type Props = {
  active: FilterId | 'auto';
  onSelect: (id: FilterId | 'auto') => void;
};

/**
 * Camera picker styled as a row of camera bodies rather than filter chips.
 *
 * The framing matters: these are emulations of specific cameras, and presenting them as
 * little devices (badge, body, lens, status LED) sets the expectation of a camera look
 * instead of a filter. Drawn with views — no image assets to ship or scale.
 */
export function CameraPicker({ active, onSelect }: Props) {
  const cameras = FILTERS.filter(f => f.id !== 'original');

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      style={s.strip}
    >
      <Pressable onPress={() => onSelect('auto')} style={[s.card, active === 'auto' && s.cardOn]}>
        <View style={[s.body, active === 'auto' && s.bodyOn]}>
          <View style={[s.lens, { borderColor: '#22c55e' }]}>
            <Text style={s.autoGlyph}>A</Text>
          </View>
          <View style={s.strap} />
        </View>
        <Text style={[s.name, active === 'auto' && s.nameOn]} numberOfLines={1}>Auto</Text>
        {active === 'auto' && <View style={[s.led, { backgroundColor: '#22c55e' }]} />}
      </Pressable>

      {cameras.map(cam => {
        const on = active === cam.id;
        return (
          <Pressable key={cam.id} onPress={() => onSelect(cam.id)} style={[s.card, on && s.cardOn]}>
            <View style={[s.body, on && s.bodyOn]}>
              <View style={[s.lens, { borderColor: cam.dot }]}>
                <View style={[s.glass, { backgroundColor: cam.dot }]} />
              </View>
              <View style={s.strap} />
              <View style={s.viewfinder} />
            </View>
            <Text style={[s.name, on && s.nameOn]} numberOfLines={1}>{cam.name}</Text>
            {on && <View style={[s.led, { backgroundColor: cam.dot }]} />}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  strip: { maxHeight: 96 },
  row: { paddingHorizontal: 12, gap: 10, alignItems: 'flex-end', paddingBottom: 4 },
  card: { width: 68, alignItems: 'center', gap: 5, paddingTop: 6 },
  cardOn: {},

  // A stylised compact camera body.
  body: {
    width: 60, height: 44, borderRadius: 9,
    backgroundColor: '#1c1c1e',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center', justifyContent: 'center',
  },
  bodyOn: { backgroundColor: '#2c2c2e', borderColor: 'rgba(255,214,10,0.5)' },
  lens: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#0c0c0c',
  },
  glass: { width: 9, height: 9, borderRadius: 5, opacity: 0.9 },
  autoGlyph: { color: '#22c55e', fontSize: 11, fontWeight: '800' },
  // Grip ridge on the right of the body.
  strap: { position: 'absolute', right: 5, top: 8, bottom: 8, width: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.06)' },
  // Optical viewfinder bump, top-left.
  viewfinder: { position: 'absolute', left: 6, top: 6, width: 10, height: 5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.10)' },

  name: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  nameOn: { color: '#fff' },
  led: { width: 5, height: 5, borderRadius: 3 },
});
