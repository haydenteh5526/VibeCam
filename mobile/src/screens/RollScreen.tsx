import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLayoutWidth } from '../components/DeviceFrame';
import { groupByDay, type RollEntry } from '../roll';

const COLS = 3;
const GAP = 3;

type Props = {
  roll: RollEntry[];
  onOpen: (entry: RollEntry) => void;
  onBack: () => void;
};

function dayLabel(day: string): string {
  if (day === 'unknown') return 'Undated';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSameDay(date, today)) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The app's own roll of developed shots — separate from the device photo library. */
export function RollScreen({ roll, onOpen, onBack }: Props) {
  const groups = groupByDay(roll);
  // Tiles size against the phone frame so the grid matches the device on web.
  const W = useLayoutWidth();
  const tileSize = { width: (W - GAP * (COLS + 1)) / COLS, height: (W - GAP * (COLS + 1)) / COLS };

  return (
    <View style={s.bg}>
      <StatusBar style="light" />
      <View style={s.top}>
        <View>
          <Text style={s.title}>Film Roll</Text>
          <Text style={s.count}>{roll.length === 0 ? 'No shots yet' : `${roll.length} shot${roll.length === 1 ? '' : 's'}`}</Text>
        </View>
        <Pressable onPress={onBack} style={s.pill}><Text style={s.pillT}>Camera</Text></Pressable>
      </View>

      {roll.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon} />
          <Text style={s.emptyT}>Shots you develop appear here</Text>
          <Text style={s.emptyH}>Tap any shot to re-develop it with a different camera</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {groups.map(group => (
            <View key={group.day} style={s.group}>
              <Text style={s.day}>{dayLabel(group.day)}</Text>
              <View style={s.grid}>
                {group.items.map(item => (
                  <Pressable key={item.uri} onPress={() => onOpen(item)} style={[s.tile, tileSize]}>
                    <Image source={{ uri: item.uri }} style={s.thumb} />
                    <View style={s.tag}><Text style={s.tagT} numberOfLines={1}>{item.cameraName}</Text></View>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0c0c0c' },
  top: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  count: { color: '#636366', fontSize: 11, marginTop: 2 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  pillT: { color: '#FFD60A', fontSize: 13, fontWeight: '600' },

  body: { paddingHorizontal: GAP, paddingBottom: 40 },
  group: { marginBottom: 18 },
  day: { color: '#8e8e93', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 6, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 8, overflow: 'hidden', backgroundColor: '#1c1c1e' },
  thumb: { width: '100%', height: '100%' },
  tag: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 5, paddingVertical: 3 },
  tagT: { color: '#fff', fontSize: 8, fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 80, paddingHorizontal: 40 },
  emptyIcon: { width: 54, height: 42, borderRadius: 8, borderWidth: 2, borderColor: '#2c2c2e', marginBottom: 6 },
  emptyT: { color: '#8e8e93', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  emptyH: { color: '#636366', fontSize: 11, textAlign: 'center', lineHeight: 16 },
});

