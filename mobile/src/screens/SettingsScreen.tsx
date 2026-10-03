import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CameraPicker } from '../components/CameraPicker';
import { IconButton, Notice, theme, ui, useScreenInsets } from '../components/ui';
import type { Settings } from '../settings';

type Props = { settings: Settings; onChange: (patch: Partial<Settings>) => void; onClose: () => void; error?: string; cloudEnabled: boolean; rollCount: number };
function Toggle({ title, hint, value, onChange }: { title: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return <View style={s.row}><View style={s.rowText}><Text style={s.label}>{title}</Text><Text style={s.hint}>{hint}</Text></View><Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ true: theme.accent, false: theme.line }} thumbColor="#f5f1e8" /></View>;
}
function Choices<T extends string | number>({ options, value, onSelect }: { options: { value: T; label: string }[]; value: T; onSelect: (value: T) => void }) {
  return <View style={s.choices}>{options.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: option.value === value }}
    onPress={() => onSelect(option.value)} style={[s.choice, option.value === value && s.choiceActive]}><Text style={[s.choiceText, option.value === value && { color: theme.bg }]}>{option.label}</Text></Pressable>)}</View>;
}
export function SettingsScreen({ settings, onChange, onClose, error = '', cloudEnabled, rollCount }: Props) {
  const insets = useScreenInsets();
  const set = (patch: Partial<Settings>) => {
    if (settings.haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onChange(patch);
  };
  return <View style={[ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={ui.header}><View><Text style={ui.eyebrow}>MAKE IT YOURS</Text><Text style={ui.title}>Settings</Text></View><IconButton icon="close" label="Close settings" onPress={onClose} /></View>
    <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
      <Notice text={error} error />
      <Text style={s.section}>YOUR CAMERA</Text>
      <View style={s.card}><Text style={s.label}>Favourite starting point</Text><Text style={s.hint}>We remember the camera you choose while shooting.</Text>
        <View style={{ marginHorizontal: -16 }}><CameraPicker active={settings.defaultCamera} onSelect={defaultCamera => set({ defaultCamera })} showAuto={cloudEnabled} showOriginal /></View>
      </View>
      <Text style={s.section}>PHOTO CHARACTER</Text>
      <View style={s.card}><Text style={s.label}>Texture by default</Text><Text style={s.hint}>Controls grain, corner falloff and highlight softness. You can fine-tune each photo later.</Text>
        <Choices options={[{ value: 0, label: 'Clean' }, { value: .5, label: 'Subtle' }, { value: 1, label: 'Standard' }, { value: 1.5, label: 'Strong' }]} value={settings.characterStrength} onSelect={characterStrength => set({ characterStrength })} />
        <View style={s.divider} /><Toggle title="Date stamp" hint="An amber date on new photos. Uses the date added to Film Roll and works offline." value={settings.dateStamp} onChange={dateStamp => set({ dateStamp })} />
      </View>
      <Text style={s.section}>SAVE YOUR MOMENTS</Text>
      <View style={s.card}><Toggle title="Auto-save to Photos" hint="Save the finished photo or clip after capture." value={settings.autoSave} onChange={autoSave => set({ autoSave })} />
        <View style={s.divider} /><Toggle title="Save originals to Photos" hint="Save a separate untouched copy, too. Film Roll always keeps your original." value={settings.saveOriginal} onChange={saveOriginal => set({ saveOriginal })} /></View>
      <View style={s.storage}><Text style={s.storageNumber}>{rollCount}</Text><View style={{ flex: 1 }}><Text style={s.label}>Items in Film Roll</Text><Text style={s.hint}>Kept until you delete them. Save a copy to Photos before uninstalling VibeCam.</Text></View></View>
      <Text style={s.section}>SHOOTING</Text>
      <View style={s.card}><Toggle title="Composition grid" hint="Rule-of-thirds guides when the camera opens." value={settings.grid} onChange={grid => set({ grid })} /><View style={s.divider} /><Toggle title="Haptic feedback" hint="A small click you can feel." value={settings.haptics} onChange={haptics => set({ haptics })} /></View>
      <View style={s.card}><Text style={s.label}>Short films, your colour</Text><Text style={s.hint}>Record up to 15 seconds at 720p in the installed iPhone app. Camera colour is applied after recording; photo texture and date stamps apply to photos only.</Text></View>
      {cloudEnabled && <><Text style={s.section}>CLOUD DEVELOPMENT</Text><View style={s.card}>
        <Toggle title="Develop on device" hint="Prefer the offline camera renderer." value={settings.onDeviceLook} onChange={onDeviceLook => set({ onDeviceLook })} />
        <Text style={s.label}>Frame</Text><Choices options={[{ value: 'none', label: 'None' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'print', label: 'Print' }]} value={settings.frame} onSelect={frame => set({ frame: frame as Settings['frame'] })} />
        <Text style={s.label}>Light leak</Text><Choices options={[{ value: 0, label: 'Off' }, { value: .25, label: 'Subtle' }, { value: .5, label: 'Medium' }, { value: 1, label: 'Strong' }]} value={settings.lightLeak} onSelect={lightLeak => set({ lightLeak })} />
        <Text style={s.label}>Dust</Text><Choices options={[{ value: 0, label: 'Off' }, { value: .25, label: 'Subtle' }, { value: .5, label: 'Medium' }, { value: 1, label: 'Strong' }]} value={settings.dust} onSelect={dust => set({ dust })} />
      </View></>}
      <View style={s.about}><Text style={s.aboutBrand}>vibecam</Text><Text style={s.aboutText}>A pocket full of possibilities.</Text><Text style={s.aboutNote}>Camera looks are inspired interpretations of colour and texture. Your iPhone's lens, sensor, light and flash still shape the image.</Text><Text style={s.version}>1.0 · {cloudEnabled ? 'Cloud development enabled' : 'No account. No uploads.'}</Text></View>
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 24 }, section: { color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, marginTop: 22, marginBottom: 10 },
  card: { padding: 16, backgroundColor: theme.surface, borderRadius: 18, marginBottom: 12, borderWidth: 1, borderColor: '#353a3050' },
  label: { color: theme.text, fontSize: 15, fontWeight: '600', marginBottom: 4 }, hint: { color: theme.muted, fontSize: 12, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }, rowText: { flex: 1 }, divider: { height: 1, backgroundColor: theme.line, marginVertical: 15 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14, marginBottom: 8 }, choice: { minHeight: 44, paddingHorizontal: 11, backgroundColor: theme.bg, borderRadius: 11, flexGrow: 1, justifyContent: 'center', alignItems: 'center' }, choiceActive: { backgroundColor: theme.accent },
  choiceText: { color: theme.muted, fontSize: 12, fontWeight: '600' }, storage: { flexDirection: 'row', padding: 16, gap: 16, alignItems: 'center', borderWidth: 1, borderColor: theme.line, borderRadius: 18 },
  storageNumber: { color: theme.accent, fontSize: 32, fontWeight: '300' }, about: { paddingTop: 30, paddingHorizontal: 12, alignItems: 'center', gap: 8 },
  aboutBrand: { color: theme.text, fontSize: 27, fontWeight: '700', letterSpacing: -1 }, aboutText: { color: theme.muted, fontSize: 13 },
  aboutNote: { color: theme.dim, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 8 }, version: { color: theme.dim, fontSize: 10, marginTop: 8 },
});
