import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { VideoPreview } from '../components/VideoPreview';
import { DevelopingOverlay } from '../components/DevelopingOverlay';
import { CameraPicker } from '../components/CameraPicker';
import { Button, Icon, IconButton, Notice, theme, ui, useScreenInsets } from '../components/ui';
import { useLayoutHeight, useLayoutWidth } from '../components/DeviceFrame';
import { FILTERS, type FilterId } from '../filters';
import { DEFAULT_RECIPE, normalizeRecipe, sameRecipe, type PhotoRecipe } from '../photoRecipe';
import type { SelectedFile } from '../types';
import type { GradeState } from '../../App';

type Props = {
  file: SelectedFile; captured: string | null; original: string | null; backendReady: boolean; cloudEnabled: boolean;
  grade: GradeState; saved: boolean; busy: boolean; canDevelop: boolean; selectedCamera: string; cameraName: string;
  error: string; notice: string; favorite: boolean; recipe?: PhotoRecipe; takenAt: number; closeLabel: string;
  onVibe: (vibe: string) => void; onRegrade: (camera: FilterId | 'auto', recipe?: PhotoRecipe) => void;
  onClose: () => void; onSave: () => void; onShare: () => void; onUpload: () => void; onDelete: () => void; onFavorite: () => void;
};
function Adjustment({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  return <View style={s.adjustment}>
    <View style={{ flex: 1 }}><Text style={s.adjustmentName}>{label}</Text><Text style={s.adjustmentValue}>{display}</Text></View>
    <IconButton icon="remove" label={'Decrease ' + label.toLowerCase()} disabled={value <= min} onPress={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))} />
    <IconButton icon="add" label={'Increase ' + label.toLowerCase()} disabled={value >= max} onPress={() => onChange(Math.min(max, Math.round((value + step) * 100) / 100))} />
  </View>;
}
export function PreviewScreen({ file, captured, original, backendReady, cloudEnabled, grade, saved, busy, canDevelop,
  selectedCamera, cameraName, error, notice, favorite, recipe, takenAt, closeLabel, onVibe, onRegrade, onClose, onSave, onShare, onUpload, onDelete, onFavorite }: Props) {
  const insets = useScreenInsets();
  const width = useLayoutWidth(), height = useLayoutHeight();
  const video = file.mimeType.startsWith('video/');
  const [tab, setTab] = useState<'looks' | 'adjust'>('looks');
  const [showOriginal, setShowOriginal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [vibe, setVibe] = useState('');
  const [draft, setDraft] = useState(() => normalizeRecipe(recipe));
  const { amount, exposure, warmth, character, dateStamp } = normalizeRecipe(recipe);
  // Metadata commits normalize to a new object. Reset only for a different source
  // or changed applied values so favouriting/saving cannot erase pending edits.
  useEffect(() => { setDraft({ amount, exposure, warmth, character, dateStamp }); },
    [original, amount, exposure, warmth, character, dateStamp]);
  const look = FILTERS.find(preset => preset.id === selectedCamera);
  const displayName = look?.name ?? cameraName;
  const dirty = !sameRecipe(draft, normalizeRecipe(recipe));
  const canAdjust = !video && !!look && look.id !== 'original' && canDevelop && !!original;
  const update = (patch: Partial<PhotoRecipe>) => setDraft(value => ({ ...value, ...patch }));
  const select = (id: FilterId | 'auto') => {
    setShowOriginal(false);
    onRegrade(id, video ? undefined : draft);
  };
  return <View style={[ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={ui.header}>
      <Pressable accessibilityRole="button" onPress={onClose} disabled={busy} style={[s.back, busy && ui.disabled]}><Icon name="arrow-back" size={20} /><Text style={s.backText}>{closeLabel}</Text></Pressable>
      <View style={ui.row}>
        <IconButton icon={favorite ? 'heart' : 'heart-outline'} label={favorite ? 'Remove from favourites' : 'Add to favourites'} active={favorite} onPress={onFavorite} disabled={busy} />
        <IconButton icon="trash-outline" label="Delete this item" onPress={() => setConfirmDelete(true)} disabled={busy} />
      </View>
    </View>
    <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
      <View style={[s.media, { height: Math.min((width - 32) * 4 / 3, height * .46) }]}>
        {video && (showOriginal ? original : captured) ? <VideoPreview uri={(showOriginal ? original : captured)!} /> :
          captured ? <Image accessibilityRole="image" accessibilityLabel={showOriginal ? 'Original photo' : displayName + ' developed photo'} source={{ uri: (showOriginal ? original : captured)! }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        {grade.kind === 'grading' && <DevelopingOverlay label={video ? 'Developing your clip' : 'Developing your photo'} />}
        {showOriginal && <View style={s.originalBadge}><Text style={s.originalText}>ORIGINAL</Text></View>}
      </View>
      <View style={s.mediaFooter}>
        <View><Text style={s.model}>{displayName}</Text><Text style={s.date}>{new Date(takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {video ? 'Video' : 'Photo'}</Text></View>
        {original && original !== captured ? <Pressable accessibilityRole="button" accessibilityLabel={showOriginal ? 'Show edited version' : 'Compare with original'} accessibilityState={{ selected: showOriginal }}
          onPress={() => setShowOriginal(value => !value)} style={s.compare}><Icon name="copy-outline" size={16} /><Text style={s.compareText}>{showOriginal ? 'Show edit' : 'Compare'}</Text></Pressable> : null}
      </View>
      <Notice text={error} error /><Notice text={notice} />
      {!original && <Notice text="The original is unavailable, so this item cannot be restyled. You can still save and share it." />}
      <View style={s.tabs}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: tab === 'looks' }} onPress={() => setTab('looks')} style={[s.tab, tab === 'looks' && s.tabActive]}><Text style={[s.tabText, tab === 'looks' && { color: theme.text }]}>Camera looks</Text></Pressable>
        {!video && <Pressable accessibilityRole="button" accessibilityState={{ selected: tab === 'adjust' }} onPress={() => setTab('adjust')} style={[s.tab, tab === 'adjust' && s.tabActive]}><Text style={[s.tabText, tab === 'adjust' && { color: theme.text }]}>Fine-tune</Text></Pressable>}
      </View>
      {tab === 'looks' || video ? <>
        <View style={{ marginHorizontal: -16 }}><CameraPicker active={selectedCamera} onSelect={select} showOriginal showAuto={cloudEnabled} disabled={busy || !original || !canDevelop} /></View>
        {look ? <View style={s.description}><Text style={s.descriptionTitle}>{look.tagline}</Text><Text style={ui.body}>{look.description}</Text><Text style={s.bestFor}>{look.bestFor}</Text></View> :
          <View style={s.description}><Text style={s.descriptionTitle}>{displayName}</Text><Text style={ui.body}>Your custom developed look. Save or share this version, or choose a camera to start again from the original.</Text></View>}
      </> : canAdjust ? <View style={s.adjustments} pointerEvents={busy ? 'none' : 'auto'}>
        <Text style={s.editNote}>{dirty ? 'Apply to see your changes. Your original stays untouched.' : 'Start with the camera look, then make it yours.'}</Text>
        <Adjustment label="Look strength" value={draft.amount} display={Math.round(draft.amount * 100) + '%'} min={0} max={1} step={.1} onChange={amount => update({ amount })} />
        <Adjustment label="Exposure" value={draft.exposure} display={(draft.exposure > 0 ? '+' : '') + draft.exposure.toFixed(2) + ' EV'} min={-1.5} max={1.5} step={.25} onChange={exposure => update({ exposure })} />
        <Adjustment label="Warmth" value={draft.warmth} display={draft.warmth === 0 ? 'Neutral' : (draft.warmth > 0 ? '+' : '') + Math.round(draft.warmth * 100)} min={-1} max={1} step={.1} onChange={warmth => update({ warmth })} />
        <Adjustment label="Camera texture" value={draft.character} display={Math.round(draft.character * 100) + '%'} min={0} max={1.5} step={.25} onChange={character => update({ character })} />
        <View style={s.adjustment}><View style={{ flex: 1 }}><Text style={s.adjustmentName}>Date stamp</Text><Text style={s.date}>The date added to your Film Roll</Text></View><Switch accessibilityLabel="Photo date stamp" value={draft.dateStamp} onValueChange={dateStamp => update({ dateStamp })} trackColor={{ true: theme.accent, false: theme.line }} /></View>
        <View style={[ui.row, { marginTop: 12 }]}><Button label="Reset" onPress={() => setDraft({ ...DEFAULT_RECIPE })} disabled={busy} /><Button label={busy ? 'Developing…' : 'Apply changes'} primary onPress={() => { if (look) select(look.id); }} disabled={!dirty || busy} style={{ flex: 1 }} /></View>
      </View> : <Notice text={!original ? 'The original is unavailable. You can still save or share this edit.' : !look ? 'Fine-tuning is available for the six camera looks. Choose one to start again from your original; save this custom version first if you want to keep it.' : 'Choose a camera look to fine-tune this photo.'} />}
      {cloudEnabled && backendReady && original && !video && <View style={s.cloud}>
        <TextInput accessibilityLabel="Describe an AI look" placeholder="Describe a look…" placeholderTextColor={theme.dim} style={s.input} value={vibe} onChangeText={setVibe} editable={!busy} maxLength={300} />
        <Button label="Develop with AI" disabled={busy || !vibe.trim()} onPress={() => onVibe(vibe.trim())} />
      </View>}
      <Text style={s.footnote}>Your original is kept in Film Roll. Camera looks are inspired interpretations.</Text>
    </ScrollView>
    <View style={s.export}>
      <View style={s.savedState}><Icon name={saved ? 'checkmark-circle' : 'shield-checkmark-outline'} size={15} color={saved ? theme.green : theme.muted} /><Text style={s.savedText}>{saved ? Platform.OS === 'web' ? 'Download started' : 'Saved to Photos' : 'Kept in Film Roll'}</Text></View>
      <View style={ui.row}><Button label={Platform.OS === 'web' ? saved ? 'Download again' : 'Download' : saved ? 'Saved' : video ? 'Save video' : 'Save photo'} icon={saved ? 'checkmark' : 'download-outline'} primary onPress={onSave} disabled={busy || (saved && Platform.OS !== 'web')} style={{ flex: 1 }} /><Button label="Share" icon="share-outline" onPress={onShare} disabled={busy} style={{ flex: 1 }} /></View>
      {cloudEnabled && <Button label="Upload" onPress={onUpload} disabled={busy || !backendReady} />}
    </View>
    {confirmDelete && <View style={s.modal} accessibilityViewIsModal>
      <View style={s.dialog}><Text style={s.dialogTitle}>Delete from Film Roll?</Text><Text style={ui.body}>This removes the {video ? 'clip' : 'photo'} and its original. Copies already saved to Photos stay there.</Text><Button label="Keep it" onPress={() => setConfirmDelete(false)} disabled={busy} primary /><Button label="Delete item" icon="trash-outline" danger onPress={() => { setConfirmDelete(false); onDelete(); }} disabled={busy} /></View>
    </View>}
  </View>;
}
const s = StyleSheet.create({
  back: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8 }, backText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  scroll: { paddingHorizontal: 16, paddingBottom: 16 }, media: { backgroundColor: '#080a07', borderRadius: 18, overflow: 'hidden' },
  mediaFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 16 },
  model: { color: theme.text, fontSize: 19, fontWeight: '600' }, date: { color: theme.muted, fontSize: 11, marginTop: 4 },
  compare: { minHeight: 44, borderRadius: 22, paddingHorizontal: 12, backgroundColor: theme.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
  compareText: { color: theme.text, fontSize: 12 }, originalBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 8, backgroundColor: '#10110fc0', padding: 8 },
  originalText: { color: '#fff', fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderBottomColor: theme.line }, tab: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: theme.accent }, tabText: { fontSize: 13, fontWeight: '700', color: theme.muted },
  description: { paddingHorizontal: 4, paddingVertical: 12, gap: 5 }, descriptionTitle: { color: theme.text, fontSize: 15, fontWeight: '600' }, bestFor: { color: theme.accent, fontSize: 12, marginTop: 5 },
  adjustments: { paddingVertical: 12 }, editNote: { color: theme.muted, fontSize: 12, lineHeight: 18, paddingBottom: 8 },
  adjustment: { minHeight: 63, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: theme.line, paddingVertical: 7 },
  adjustmentName: { color: theme.text, fontSize: 14, fontWeight: '500' }, adjustmentValue: { color: theme.accent, fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] },
  cloud: { gap: 8, paddingVertical: 12 }, input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 12, minHeight: 48, paddingHorizontal: 12 },
  footnote: { color: theme.dim, fontSize: 11, textAlign: 'center', lineHeight: 16, paddingHorizontal: 16, marginVertical: 12 },
  export: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.line, gap: 8, backgroundColor: theme.bg },
  savedState: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 }, savedText: { color: theme.muted, fontSize: 11 },
  modal: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000a0', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: theme.surface, padding: 22, borderRadius: 24, gap: 16 }, dialogTitle: { color: theme.text, fontSize: 22, fontWeight: '700' },
});
