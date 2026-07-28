import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { FILTERS } from '../filters';
import type { Settings } from '../settings';

type Props = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
};

const FRAME_OPTIONS: { value: Settings['frame']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'print', label: 'Print' },
];

/** Discrete steps keep this dependency-free — no slider library needed. */
const LEVELS: { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 0.25, label: 'Subtle' },
  { value: 0.5, label: 'Medium' },
  { value: 0.75, label: 'Strong' },
  { value: 1, label: 'Max' },
];

const CHARACTER_LEVELS: { value: number; label: string }[] = [
  { value: 0, label: 'Off' },
  { value: 0.5, label: 'Light' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: 'Heavy' },
  { value: 1.5, label: 'Extreme' },
];

export function SettingsScreen({ settings, onChange, onClose }: Props) {
  const tap = () => { if (settings.haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const set = (patch: Partial<Settings>) => { tap(); onChange(patch); };

  const Segmented = <T,>({
    options, value, onSelect,
  }: { options: { value: T; label: string }[]; value: T; onSelect: (v: T) => void }) => (
    <View style={s.seg}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <Pressable key={String(o.label)} onPress={() => onSelect(o.value)} style={[s.segItem, active && s.segItemOn]}>
            <Text style={[s.segT, active && s.segTOn]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={s.bg}>
      <StatusBar style="light" />
      <View style={s.top}>
        <Text style={s.title}>Settings</Text>
        <Pressable onPress={onClose} style={s.done}><Text style={s.doneT}>Done</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.section}>Camera</Text>
        <View style={s.card}>
          <Text style={s.label}>Default camera</Text>
          <Text style={s.hint}>Selected each time the app opens</Text>
          <View style={s.chipWrap}>
            <Pressable onPress={() => set({ defaultCamera: 'auto' })} style={[s.chip, settings.defaultCamera === 'auto' && s.chipOn]}>
              <View style={[s.dot, { backgroundColor: '#22c55e' }]} />
              <Text style={[s.chipT, settings.defaultCamera === 'auto' && s.chipTOn]}>Auto</Text>
            </Pressable>
            {FILTERS.filter(f => f.id !== 'original').map(f => (
              <Pressable key={f.id} onPress={() => set({ defaultCamera: f.id })} style={[s.chip, settings.defaultCamera === f.id && s.chipOn]}>
                <View style={[s.dot, { backgroundColor: f.dot }]} />
                <Text style={[s.chipT, settings.defaultCamera === f.id && s.chipTOn]}>{f.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={s.section}>Look</Text>
        <View style={s.card}>
          <Text style={s.label}>Camera character</Text>
          <Text style={s.hint}>Grain, vignette, highlight bloom and lens softness. Off leaves colour only.</Text>
          <Segmented options={CHARACTER_LEVELS} value={settings.characterStrength} onSelect={v => set({ characterStrength: v })} />
        </View>

        <Text style={s.section}>Effects</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.label}>Date stamp</Text>
              <Text style={s.hint}>Orange LED date in the corner</Text>
            </View>
            <Switch
              value={settings.dateStamp}
              onValueChange={v => set({ dateStamp: v })}
              trackColor={{ true: '#FFD60A', false: '#3a3a3c' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.label}>Frame</Text>
          <Text style={s.hint}>Printed border around the photo</Text>
          <Segmented options={FRAME_OPTIONS} value={settings.frame} onSelect={v => set({ frame: v })} />
        </View>

        <View style={s.card}>
          <Text style={s.label}>Light leak</Text>
          <Text style={s.hint}>Warm light bleeding in from an edge</Text>
          <Segmented options={LEVELS} value={settings.lightLeak} onSelect={v => set({ lightLeak: v })} />
        </View>

        <View style={s.card}>
          <Text style={s.label}>Dust &amp; scratches</Text>
          <Text style={s.hint}>Specks and hairline marks, like a scanned print</Text>
          <Segmented options={LEVELS} value={settings.dust} onSelect={v => set({ dust: v })} />
        </View>

        <Text style={s.section}>Developing</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.label}>Develop on device</Text>
              <Text style={s.hint}>
                Instant and works offline. The look is a close approximation — the server
                adds an adaptive colour match plus halation and lens softness.
              </Text>
            </View>
            <Switch value={settings.onDeviceLook} onValueChange={v => set({ onDeviceLook: v })}
              trackColor={{ true: '#FFD60A', false: '#3a3a3c' }} thumbColor="#fff" />
          </View>
        </View>

        <Text style={s.section}>Saving</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.label}>Auto-save</Text>
              <Text style={s.hint}>Write the developed photo to Photos automatically</Text>
            </View>
            <Switch value={settings.autoSave} onValueChange={v => set({ autoSave: v })}
              trackColor={{ true: '#FFD60A', false: '#3a3a3c' }} thumbColor="#fff" />
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.label}>Keep original</Text>
              <Text style={s.hint}>Also save the untouched frame</Text>
            </View>
            <Switch value={settings.saveOriginal} onValueChange={v => set({ saveOriginal: v })}
              trackColor={{ true: '#FFD60A', false: '#3a3a3c' }} thumbColor="#fff" />
          </View>
        </View>

        <Text style={s.section}>Interface</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={s.rowText}><Text style={s.label}>Haptics</Text></View>
            <Switch value={settings.haptics} onValueChange={v => onChange({ haptics: v })}
              trackColor={{ true: '#FFD60A', false: '#3a3a3c' }} thumbColor="#fff" />
          </View>
          <View style={s.divider} />
          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.label}>Grid</Text>
              <Text style={s.hint}>Show rule-of-thirds guides</Text>
            </View>
            <Switch value={settings.grid} onValueChange={v => set({ grid: v })}
              trackColor={{ true: '#FFD60A', false: '#3a3a3c' }} thumbColor="#fff" />
          </View>
        </View>

        <Text style={s.footer}>
          Effects are applied when the photo is developed. Re-developing the same shot with the
          same settings always produces the same result.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0c0c0c' },
  top: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 26, fontWeight: '700' },
  done: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  doneT: { color: '#FFD60A', fontSize: 13, fontWeight: '600' },

  body: { paddingHorizontal: 16, paddingBottom: 48 },
  section: { color: '#636366', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8, paddingHorizontal: 4 },
  card: { backgroundColor: '#1c1c1e', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  label: { color: '#fff', fontSize: 14, fontWeight: '600' },
  hint: { color: '#8e8e93', fontSize: 11, lineHeight: 15, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 12 },

  seg: { flexDirection: 'row', marginTop: 10, backgroundColor: '#0c0c0c', borderRadius: 10, padding: 3, gap: 2 },
  segItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  segItemOn: { backgroundColor: '#3a3a3c' },
  segT: { color: '#8e8e93', fontSize: 11, fontWeight: '600' },
  segTOn: { color: '#FFD60A' },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 14, backgroundColor: '#0c0c0c', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  chipOn: { borderColor: '#FFD60A', backgroundColor: '#2c2c2e' },
  chipT: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  chipTOn: { color: '#FFD60A' },
  dot: { width: 7, height: 7, borderRadius: 4 },

  footer: { color: '#636366', fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 18, paddingHorizontal: 12 },
});
