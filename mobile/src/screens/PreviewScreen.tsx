import React, { useCallback, useEffect, useState } from 'react';
import { AppState, BackHandler, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { VideoPreview } from '../components/VideoPreview';
import { DevelopingOverlay } from '../components/DevelopingOverlay';
import { CameraPicker } from '../components/CameraPicker';
import { LookBrowser } from '../components/LookBrowser';
import { PhotoLookPreview } from '../components/PhotoLookPreview';
import { Button, Icon, IconButton, Notice, theme, ui, useModalBackground, useScreenInsets } from '../components/ui';
import { useLayoutHeight } from '../components/DeviceFrame';
import { FILTERS, type FilterId } from '../filters';
import { DEFAULT_RECIPE, normalizeRecipe, type PhotoRecipe } from '../photoRecipe';
import { hasPhotoChanges } from '../photoEdit';
import type { PreviewStatus } from '../look/usePhotoSurface';
import type { SelectedFile } from '../types';
import type { GradeState } from '../../App';

type Props = {
  file: SelectedFile; captured: string | null; original: string | null; backendReady: boolean; cloudEnabled: boolean;
  grade: GradeState; saved: boolean; busy: boolean; canDevelop: boolean; selectedCamera: string; cameraName: string;
  error: string; notice: string; favorite: boolean; recipe?: PhotoRecipe; takenAt: number; seed: number; closeLabel: string;
  onVibe: (vibe: string) => void; onRegrade: (camera: FilterId | 'auto', recipe?: PhotoRecipe) => void;
  onClose: () => void; onSave: () => void; onShare: () => void; onUpload: () => void; onDelete: () => void; onFavorite: () => void;
};
const ADJUSTMENTS = [
  { id: 'amount', label: 'Look', title: 'Look strength', min: 0, max: 1, step: .1 },
  { id: 'exposure', label: 'Light', title: 'Exposure', min: -1.5, max: 1.5, step: .25 },
  { id: 'warmth', label: 'Warmth', title: 'Warmth', min: -1, max: 1, step: .1 },
  { id: 'character', label: 'Texture', title: 'Camera texture', min: 0, max: 1.5, step: .25 },
] as const;
type AdjustmentId = typeof ADJUSTMENTS[number]['id'] | 'dateStamp';
function adjustmentValue(id: AdjustmentId, value: number) {
  if (id === 'exposure') return (value > 0 ? '+' : '') + value.toFixed(2) + ' EV';
  if (id === 'warmth') return value === 0 ? 'Neutral' : (value > 0 ? '+' : '') + Math.round(value * 100);
  return Math.round(value * 100) + '%';
}

export function PreviewScreen({ file, captured, original, backendReady, cloudEnabled, grade, saved, busy, canDevelop,
  selectedCamera, cameraName, error, notice, favorite, recipe, takenAt, seed, closeLabel, onVibe, onRegrade, onClose, onSave, onShare, onUpload, onDelete, onFavorite }: Props) {
  const insets = useScreenInsets();
  const compact = useLayoutHeight() < 760;
  const video = file.mimeType.startsWith('video/');
  const [tab, setTab] = useState<'looks' | 'adjust'>('looks');
  const [adjustment, setAdjustment] = useState<AdjustmentId>('amount');
  const [showOriginal, setShowOriginal] = useState(false);
  const [lookBrowser, setLookBrowser] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'leave' | null>(null);
  const background = useModalBackground(lookBrowser || !!dialog);
  const [vibe, setVibe] = useState('');
  const [draft, setDraft] = useState(() => normalizeRecipe(recipe));
  const [draftCamera, setDraftCamera] = useState(selectedCamera);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('loading');
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const { amount, exposure, warmth, character, dateStamp } = normalizeRecipe(recipe);
  // Save/favourite commits create new recipe objects. Only applied values reset a draft.
  useEffect(() => {
    setDraft({ amount, exposure, warmth, character, dateStamp });
    setDraftCamera(selectedCamera);
  }, [original, selectedCamera, amount, exposure, warmth, character, dateStamp]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  const camera = video ? selectedCamera : draftCamera;
  const look = FILTERS.find(preset => preset.id === camera);
  const displayName = look?.name ?? cameraName;
  const dirty = !video && hasPhotoChanges(draftCamera, draft, selectedCamera, { amount, exposure, warmth, character, dateStamp });
  const canAdjust = !video && !!look && look.id !== 'original' && canDevelop && !!original;
  const showPreview = dirty && camera !== 'original' && !!look && !!original && !busy && foreground && !lookBrowser;
  const close = useCallback(() => {
    if (!busy) { if (dirty) setDialog('leave'); else onClose(); }
  }, [busy, dirty, onClose]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [close]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const update = (patch: Partial<PhotoRecipe>) => {
    setShowOriginal(false); setDraft(value => ({ ...value, ...patch }));
  };
  const discard = () => {
    setDraft({ amount, exposure, warmth, character, dateStamp }); setDraftCamera(selectedCamera); setShowOriginal(false);
  };
  const select = (id: FilterId | 'auto') => {
    setShowOriginal(false);
    if (video || id === 'auto') { onRegrade(id, video ? undefined : draft); return; }
    if (id !== draftCamera) setPreviewStatus('loading');
    setDraftCamera(id);
  };
  const control = ADJUSTMENTS.find(item => item.id === adjustment);
  const mediaUri = showOriginal || (dirty && camera === 'original') ? original : captured;
  const previewReady = showPreview && previewStatus === 'ready';
  const badge = showOriginal ? 'ORIGINAL' : dirty ? camera === 'original' || previewReady ? 'UNAPPLIED PREVIEW' : 'LAST APPLIED EDIT' : '';
  return <><View ref={background} accessibilityElementsHidden={lookBrowser || !!dialog} importantForAccessibility={lookBrowser || dialog ? 'no-hide-descendants' : 'auto'} aria-hidden={lookBrowser || !!dialog}
    style={[ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={[ui.header, s.header]}>
      <Pressable accessibilityRole="button" onPress={close} disabled={busy} style={[s.back, busy && ui.disabled]}><Icon name="arrow-back" size={20} /><Text style={s.backText}>{closeLabel}</Text></Pressable>
      <View style={ui.row}>
        <IconButton icon={favorite ? 'heart' : 'heart-outline'} label={favorite ? 'Remove from favourites' : 'Add to favourites'} active={favorite} onPress={onFavorite} disabled={busy} />
        <IconButton icon="trash-outline" label="Delete this item" onPress={() => setDialog('delete')} disabled={busy} />
      </View>
    </View>
    <View style={s.photoArea}>
      <View style={s.media} onLayout={event => setMediaSize(event.nativeEvent.layout)} accessible={!video} accessibilityRole={video ? undefined : 'image'}
        accessibilityLabel={video ? undefined : showOriginal || (dirty && camera === 'original') ? 'Original photo' : previewReady ? 'Unapplied preview of ' + displayName : cameraName + ' applied photo'}>
        {video && mediaUri ? <VideoPreview uri={mediaUri} paused={lookBrowser || !!dialog} /> : mediaUri ? <Image source={{ uri: mediaUri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        {showPreview && <PhotoLookPreview uri={original!} width={mediaSize.width} height={mediaSize.height}
          options={{ camera, recipe: draft, seed, characterStrength: draft.character, takenAt }} onStatus={setPreviewStatus}
          hidden={showOriginal || previewStatus !== 'ready'} />}
        {grade.kind === 'grading' && <DevelopingOverlay label={video ? 'Developing your clip' : 'Applying at full quality'} />}
        {badge ? <View pointerEvents="none" style={s.originalBadge}><Text style={s.originalText}>{badge}</Text></View> : null}
      </View>
      <View style={s.mediaFooter}>
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={s.model}>{displayName}</Text><Text style={s.date}>{new Date(takenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {video ? 'Video' : 'Photo'}</Text></View>
        {original && (dirty || original !== captured) ? <Pressable accessibilityRole="button" accessibilityLabel={showOriginal ? 'Show edited version' : 'Compare with original'} accessibilityState={{ selected: showOriginal }}
          onPress={() => setShowOriginal(value => !value)} style={s.compare}><Icon name="copy-outline" size={16} /><Text style={s.compareText}>{showOriginal ? 'Show edit' : 'Compare'}</Text></Pressable> : null}
      </View>
    </View>
    <View style={s.tabs}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: tab === 'looks' }} onPress={() => setTab('looks')} style={[s.tab, tab === 'looks' && s.tabActive]}><Text style={[s.tabText, tab === 'looks' && { color: theme.text }]}>Camera looks</Text></Pressable>
      {!video && <Pressable accessibilityRole="button" accessibilityState={{ selected: tab === 'adjust' }} onPress={() => setTab('adjust')} style={[s.tab, tab === 'adjust' && s.tabActive]}><Text style={[s.tabText, tab === 'adjust' && { color: theme.text }]}>Fine-tune</Text></Pressable>}
    </View>
    <ScrollView style={[s.tools, { height: compact ? 145 : 180 }]} contentContainerStyle={s.toolContent} showsVerticalScrollIndicator>
      <Notice text={error} error /><Notice text={notice} />
      {showPreview && previewStatus === 'unavailable' && <Notice text="Preview unavailable. The last applied edit is shown. Apply to render your changes at full quality." />}
      {!original && <Notice text="The original is unavailable. You can still save and share this item." />}
      {tab === 'looks' || video ? <>
        <View style={{ marginHorizontal: -16 }}><CameraPicker active={camera} onSelect={select} showOriginal showAuto={cloudEnabled} disabled={busy || !original || !canDevelop} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel={video ? 'Explore camera looks' : 'Compare looks on your photo'} disabled={busy || !original || !canDevelop}
          onPress={() => setLookBrowser(true)} style={[s.explore, (busy || !original || !canDevelop) && ui.disabled]}>
          <Icon name="copy-outline" size={17} color={theme.accent} /><Text style={s.exploreText}>{video ? 'Explore camera looks' : 'Compare looks on your photo'}</Text><Icon name="chevron-forward" size={14} color={theme.accent} />
        </Pressable>
      </> : canAdjust ? <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.adjustmentTabs}>
          {[...ADJUSTMENTS, { id: 'dateStamp' as const, label: 'Date' }].map(item => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={item.label + ' adjustment'} accessibilityState={{ selected: adjustment === item.id }} onPress={() => setAdjustment(item.id)} style={[s.adjustmentTab, adjustment === item.id && s.adjustmentActive]}>
            <Text style={[s.adjustmentLabel, adjustment === item.id && { color: theme.accent }]}>{item.label}</Text>
          </Pressable>)}
        </ScrollView>
        <View style={s.adjustment}>
          <View style={{ flex: 1 }}><Text style={s.adjustmentName}>{control?.title ?? 'Date stamp'}</Text><Text accessibilityLiveRegion="polite" style={s.adjustmentValue}>{control ? adjustmentValue(control.id, draft[control.id]) : 'The date added to your Film Roll'}</Text></View>
          {control ? <>
            <IconButton icon="remove" label={'Decrease ' + control.title.toLowerCase()} disabled={busy || draft[control.id] <= control.min}
              onPress={() => update({ [control.id]: Math.max(control.min, Math.round((draft[control.id] - control.step) * 100) / 100) })} />
            <IconButton icon="add" label={'Increase ' + control.title.toLowerCase()} disabled={busy || draft[control.id] >= control.max}
              onPress={() => update({ [control.id]: Math.min(control.max, Math.round((draft[control.id] + control.step) * 100) / 100) })} />
          </> : <Switch accessibilityLabel="Photo date stamp" value={draft.dateStamp} disabled={busy} onValueChange={dateStamp => update({ dateStamp })} trackColor={{ true: theme.accent, false: theme.line }} />}
        </View>
        <View style={s.editFooter}><Text style={s.editNote}>Adjustments preview on your photo.</Text><Pressable accessibilityRole="button" accessibilityLabel="Reset adjustments" disabled={busy} onPress={() => { setDraft({ ...DEFAULT_RECIPE }); setShowOriginal(false); }} style={s.reset}><Text style={s.resetText}>Reset</Text></Pressable></View>
      </View> : <Notice text={!original ? 'The original is unavailable.' : !look ? 'Choose a camera look to fine-tune this photo. Save this custom version first if you want to keep it.' : 'Choose a camera look to fine-tune this photo.'} />}
      {cloudEnabled && backendReady && original && !video && <View style={s.cloud}>
        <TextInput accessibilityLabel="Describe an AI look" placeholder="Describe a look…" placeholderTextColor={theme.dim} style={s.input} value={vibe} onChangeText={setVibe} editable={!busy && !dirty} maxLength={300} />
        <Button label="Develop with AI" disabled={busy || dirty || !vibe.trim()} onPress={() => onVibe(vibe.trim())} />
      </View>}
    </ScrollView>
    <View style={s.export}>
      {dirty ? <>
        <Text accessibilityLiveRegion="polite" style={s.savedText}>{busy ? 'Applying your edit…' : showPreview && previewStatus === 'loading' ? 'Preparing preview…' : 'Apply your changes, then save or share.'}</Text>
        <View style={ui.row}><Button label="Discard" onPress={discard} disabled={busy} style={{ flex: 1 }} /><Button label="Apply changes" icon="checkmark" primary onPress={() => { setShowOriginal(false); onRegrade(draftCamera as FilterId, draft); }} disabled={busy} style={{ flex: 1.5 }} /></View>
      </> : <>
        <View style={s.savedState}><Icon name={saved ? 'checkmark-circle' : 'shield-checkmark-outline'} size={15} color={saved ? theme.green : theme.muted} /><Text style={s.savedText}>{saved ? Platform.OS === 'web' ? 'Download started' : 'Saved to Photos' : 'Kept in Film Roll · original preserved'}</Text></View>
        <View style={ui.row}><Button label={Platform.OS === 'web' ? saved ? 'Download again' : 'Download' : saved ? 'Saved' : video ? 'Save video' : 'Save photo'} icon={saved ? 'checkmark' : 'download-outline'} primary onPress={onSave} disabled={busy || (saved && Platform.OS !== 'web')} style={{ flex: 1 }} /><Button label="Share" icon="share-outline" onPress={onShare} disabled={busy} style={{ flex: 1 }} /></View>
        {cloudEnabled && <Button label="Upload" onPress={onUpload} disabled={busy || !backendReady} />}
      </>}
    </View>
  </View>
    {lookBrowser && <LookBrowser active={camera} video={video} showAuto={cloudEnabled} photo={!video && original ? { uri: original, recipe: draft, seed, takenAt } : undefined}
      onClose={() => setLookBrowser(false)} onSelect={id => { select(id); setLookBrowser(false); }} />}
    {dialog && <Modal transparent animationType="fade" onRequestClose={() => setDialog(null)}><View style={s.modal} accessibilityViewIsModal>
      <View style={s.dialog}><Text style={s.dialogTitle}>{dialog === 'leave' ? 'Discard your changes?' : 'Delete from Film Roll?'}</Text>
        <Text style={ui.body}>{dialog === 'leave' ? 'Your last applied edit and original are safe in Film Roll. These preview changes have not been applied.' : 'This removes the item and its original. Copies already saved to Photos stay there.'}</Text>
        <Button label={dialog === 'leave' ? 'Keep editing' : 'Keep it'} onPress={() => setDialog(null)} disabled={busy} primary />
        <Button label={dialog === 'leave' ? 'Discard and leave' : 'Delete item'} danger onPress={() => { setDialog(null); if (dialog === 'leave') onClose(); else onDelete(); }} disabled={busy} />
      </View>
    </View></Modal>}
  </>;
}
const s = StyleSheet.create({
  explore: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, exploreText: { color: theme.accent, fontSize: 12, fontWeight: '600' },
  header: { paddingVertical: 4 }, back: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8 }, backText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  photoArea: { flex: 1, minHeight: 150, paddingHorizontal: 16 }, media: { flex: 1, backgroundColor: '#080a07', borderRadius: 18, overflow: 'hidden' },
  mediaFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9 },
  model: { color: theme.text, fontSize: 19, fontWeight: '600' }, date: { color: theme.muted, fontSize: 11, marginTop: 4 },
  compare: { minHeight: 44, borderRadius: 22, paddingHorizontal: 12, backgroundColor: theme.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
  compareText: { color: theme.text, fontSize: 12 }, originalBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 8, backgroundColor: '#10110fe0', padding: 8 },
  originalText: { color: '#fff', fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 4, marginHorizontal: 16, borderBottomWidth: 1, borderBottomColor: theme.line }, tab: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: theme.accent }, tabText: { fontSize: 13, fontWeight: '700', color: theme.muted },
  tools: { flexGrow: 0, flexShrink: 0 }, toolContent: { paddingHorizontal: 16, paddingBottom: 8 },
  adjustmentTabs: { gap: 4, paddingTop: 8 }, adjustmentTab: { minHeight: 44, minWidth: 56, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  adjustmentActive: { backgroundColor: theme.surface }, adjustmentLabel: { fontSize: 12, color: theme.muted, fontWeight: '600' },
  editFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, editNote: { color: theme.muted, fontSize: 11, lineHeight: 16 },
  reset: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, resetText: { color: theme.accent, fontSize: 12 },
  adjustment: { minHeight: 63, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  adjustmentName: { color: theme.text, fontSize: 14, fontWeight: '500' }, adjustmentValue: { color: theme.accent, fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] },
  cloud: { gap: 8, paddingVertical: 12 }, input: { backgroundColor: theme.surface, color: theme.text, borderRadius: 12, minHeight: 48, paddingHorizontal: 12 },
  export: { paddingHorizontal: 16, paddingBottom: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.line, gap: 8, backgroundColor: theme.bg },
  savedState: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5 }, savedText: { color: theme.muted, fontSize: 11, textAlign: 'center' },
  modal: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000a0', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: theme.surface, padding: 22, borderRadius: 24, gap: 16 }, dialogTitle: { color: theme.text, fontSize: 22, fontWeight: '700' },
});
