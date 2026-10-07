import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FILTERS, getLook, type FilterId } from '../filters';
import { LOOK_SAMPLES } from '../look/samples';
import type { PhotoRecipe } from '../photoRecipe';
import type { PreviewStatus } from '../look/usePhotoSurface';
import { PhotoLookPreview } from './PhotoLookPreview';
import { useLayoutHeight, useLayoutWidth } from './DeviceFrame';
import { Button, Icon, IconButton, theme, ui, useScreenInsets } from './ui';

type Photo = { uri: string; recipe: PhotoRecipe; seed: number; takenAt: number };
type Props = { active: string; photo?: Photo; video?: boolean; showAuto?: boolean; onClose: () => void; onSelect: (id: FilterId | 'auto') => void };

/** Browsing is local. Only Use look updates the camera or the editor's draft. */
export function LookBrowser({ active, photo, video, showAuto = false, onClose, onSelect }: Props) {
  const insets = useScreenInsets();
  const width = useLayoutWidth(), height = useLayoutHeight();
  const [browse, setBrowse] = useState<FilterId>(getLook(active).id);
  const [comparison, setComparison] = useState(!!photo);
  const [pair, setPair] = useState({ a: getLook(active).id, b: getLook(active).id === 'original' ? 'g7x' as FilterId : 'original' as FilterId });
  const [side, setSide] = useState<'a' | 'b'>('a');
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('loading');
  const [retry, setRetry] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scroll = useRef<ScrollView>(null);
  const camera = comparison ? pair[side] : browse;
  const look = getLook(camera);
  const rendered = !photo || previewStatus === 'ready';
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  const select = (id: FilterId) => {
    if (id !== camera) setPreviewStatus('loading');
    if (comparison) setPair(value => ({ ...value, [side]: id })); else setBrowse(id);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };
  const changeView = (compare: boolean) => {
    if (compare === comparison) return;
    if (compare) {
      setPair({ a: browse, b: browse === 'original' ? 'g7x' : 'original' });
      setSide('a');
    } else setBrowse(camera);
    setComparison(compare);
  };
  return <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <View style={s.backdrop}>
      <View style={[s.sheet, { width, height, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={s.header}>
          <View style={{ flex: 1 }}><Text style={ui.eyebrow}>FIND YOUR LOOK</Text><Text style={s.title}>Camera collection</Text></View>
          <IconButton icon="close" label="Close look browser" onPress={onClose} />
        </View>
        <View style={s.tabs}>
          {[false, true].map(compare => <Pressable key={String(compare)} accessibilityRole="button" accessibilityLabel={compare ? 'Compare two looks' : 'Browse camera looks'}
            accessibilityState={{ selected: comparison === compare }} onPress={() => changeView(compare)} style={[s.tab, comparison === compare && s.activeTab]}>
            <Icon name={compare ? 'copy-outline' : 'grid-outline'} size={16} color={comparison === compare ? theme.accent : theme.muted} />
            <Text style={[s.tabText, comparison === compare && { color: theme.accent }]}>{compare ? 'Compare A / B' : 'Browse looks'}</Text>
          </Pressable>)}
        </View>
        {video && <Text style={s.videoNote}>Photo samples · video uses colour only</Text>}
        <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={s.content}>
          {comparison && <View style={s.pair}>
            {(['a', 'b'] as const).map(slot => <Pressable key={slot} accessibilityRole="button" accessibilityLabel={`View ${slot.toUpperCase()}: ${getLook(pair[slot]).name}`}
              accessibilityState={{ selected: side === slot }} onPress={() => { if (pair[slot] !== camera) setPreviewStatus('loading'); setSide(slot); }} style={[s.choice, side === slot && s.chosen]}>
              <Text style={[s.letter, side === slot && { color: theme.accent }]}>{slot.toUpperCase()}</Text><Text style={s.choiceName}>{getLook(pair[slot]).name}</Text>
            </Pressable>)}
          </View>}
          <View style={s.hero} onLayout={event => setSize(event.nativeEvent.layout)} accessible accessibilityRole="image"
            accessibilityLabel={photo ? rendered ? `${look.name} preview of your photo` : 'Original photo while look preview is unavailable' : `${look.name} on the sample scene`}>
            <Image source={photo ? { uri: photo.uri } : LOOK_SAMPLES[camera]} style={s.fillImage} resizeMode="contain" accessible={false} />
            {photo && foreground && <PhotoLookPreview key={retry} uri={photo.uri} width={size.width} height={size.height}
              options={{ camera, recipe: photo.recipe, characterStrength: photo.recipe.character, seed: photo.seed, takenAt: photo.takenAt }}
              onStatus={setPreviewStatus} hidden={camera === 'original' || previewStatus !== 'ready'} />}
            <View pointerEvents="none" style={s.badge}><Text style={s.badgeText}>{photo ? 'YOUR PHOTO' : 'SAMPLE SCENE'}{comparison ? ` · ${side.toUpperCase()}` : ''}</Text></View>
            {!rendered && previewStatus === 'loading' && <View style={s.loading}><ActivityIndicator color={theme.accent} /><Text style={s.loadingText}>Preparing look…</Text></View>}
          </View>
          {photo && !rendered && previewStatus === 'unavailable' ? <View style={s.failure}><Text style={s.hint}>Original shown. Look preview unavailable.</Text><Button label="Retry preview" onPress={() => { setPreviewStatus('loading'); setRetry(value => value + 1); }} /></View> : null}
          <View style={s.description}>
            <View style={ui.row}><Text style={s.lookName}>{look.name}</Text><Text style={s.tagline}>{look.tagline}</Text></View>
            <Text style={s.descriptionText}>{look.description}</Text><Text style={s.bestFor}>{look.bestFor}</Text>
          </View>
          <View style={s.section}>
            <Text style={s.sectionTitle}>{comparison ? `CHOOSE LOOK ${side.toUpperCase()}` : 'SEVEN WAYS TO SEE IT'}</Text>
            <Text style={s.hint}>{comparison ? 'Tap A or B above to switch the full photo.' : photo ? 'Preview on your photo. Cards show the sample scene.' : 'Same scene. Every camera’s character.'}</Text>
          </View>
          <View style={s.grid}>
            {FILTERS.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Preview ${item.name}, ${item.tagline}`}
              accessibilityState={{ selected: item.id === camera }} onPress={() => select(item.id)} style={[s.card, { width: (width - 50) / 2 }, item.id === camera && s.selectedCard]}>
              <View style={s.thumbnail}><Image source={LOOK_SAMPLES[item.id]} style={s.fillImage} accessible={false} /></View>
              <View style={s.cardText}><Text style={s.cardName}>{item.name}</Text><Text style={s.cardTagline}>{item.tagline}</Text></View>
              {item.id === camera && <View style={s.check}><Icon name="checkmark" size={14} color={theme.bg} /></View>}
            </Pressable>)}
          </View>
          {showAuto && <Button label="Use automatic selection" icon="sparkles-outline" onPress={() => onSelect('auto')} />}
          <Text style={s.footnote}>{video ? 'Photo samples shown. Video uses each look’s colour, without photo texture.' : 'Camera-inspired looks · illustrative sample scene'}</Text>
        </ScrollView>
        <View style={s.footer}>
          <Text style={s.hint}>{photo ? 'Returns to your edit. Apply when you’re ready.' : 'Choose a look and get back to shooting.'}</Text>
          <Button label={`Use ${look.name}`} primary icon="checkmark" onPress={() => onSelect(camera)} />
        </View>
      </View>
    </View>
  </Modal>;
}
const s = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000b' },
  sheet: { backgroundColor: theme.bg }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  title: { color: theme.text, fontSize: 25, fontWeight: '700', letterSpacing: -.8, marginTop: 5 },
  tabs: { flexDirection: 'row', gap: 6, padding: 4, marginHorizontal: 20, backgroundColor: theme.surface, borderRadius: 14, marginVertical: 10 },
  tab: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  activeTab: { backgroundColor: '#393324' }, tabText: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  content: { paddingHorizontal: 20, paddingBottom: 20 }, pair: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  choice: { flex: 1, flexDirection: 'row', gap: 10, minHeight: 48, padding: 10, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: theme.line },
  chosen: { borderColor: theme.accent, backgroundColor: '#28251b' }, letter: { fontSize: 18, fontWeight: '700', color: theme.muted }, choiceName: { fontSize: 13, color: theme.text, flexShrink: 1 },
  hero: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#080a07', borderRadius: 17, overflow: 'hidden' },
  fillImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  badge: { position: 'absolute', top: 12, left: 12, borderRadius: 6, backgroundColor: '#10110fcf', paddingHorizontal: 9, paddingVertical: 6 },
  badgeText: { color: '#fff', fontSize: 9, letterSpacing: 1.3, fontWeight: '700' },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#10110f80', alignItems: 'center', justifyContent: 'center', gap: 10 }, loadingText: { color: '#fff', fontSize: 12 },
  description: { gap: 8, marginVertical: 16 }, lookName: { color: theme.text, fontWeight: '700', fontSize: 19 },
  tagline: { color: theme.accent, fontSize: 12, flexShrink: 1 }, descriptionText: { color: theme.muted, fontSize: 13, lineHeight: 19 }, bestFor: { color: theme.muted, fontSize: 11 },
  section: { gap: 7, marginTop: 8, marginBottom: 14 }, sectionTitle: { fontSize: 10, color: theme.muted, fontWeight: '700', letterSpacing: 1.4 },
  hint: { color: theme.muted, fontSize: 11, lineHeight: 16 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  videoNote: { color: theme.muted, fontSize: 11, paddingHorizontal: 20, paddingBottom: 10 },
  card: { backgroundColor: theme.surface, borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: theme.line },
  selectedCard: { borderColor: theme.accent }, thumbnail: { width: '100%', aspectRatio: 4 / 3 }, cardText: { padding: 10, gap: 4 },
  cardName: { color: theme.text, fontSize: 13, fontWeight: '600' }, cardTagline: { color: theme.muted, fontSize: 10 },
  check: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  footnote: { color: theme.muted, fontSize: 10, lineHeight: 16, marginTop: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 8, borderTopWidth: 1, borderColor: theme.line }, failure: { gap: 8, paddingTop: 10 },
});
