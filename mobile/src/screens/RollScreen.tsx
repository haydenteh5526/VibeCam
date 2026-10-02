import React, { useMemo, useState } from 'react';
import { FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLayoutWidth } from '../components/DeviceFrame';
import { Button, Icon, IconButton, Notice, theme, ui, useScreenInsets } from '../components/ui';
import { groupByDay, type RollEntry } from '../roll';

type Props = {
  roll: RollEntry[]; onOpen: (entry: RollEntry) => void; onBack: () => void; onImport: () => void;
  onSettings: () => void; busy: boolean; error: string;
  onDeleteMany: (uris: string[]) => Promise<boolean>;
};
type Row = { kind: 'day'; key: string; day: string } | { kind: 'photos'; key: string; items: RollEntry[] };
const filters = [{ id: 'all', name: 'All' }, { id: 'favorites', name: 'Favourites' }, { id: 'photo', name: 'Photos' }, { id: 'video', name: 'Videos' }] as const;
function dayLabel(day: string) {
  if (day === 'unknown') return 'Undated';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  return date.getTime() === today.getTime() ? 'Today' : date.getTime() === yesterday.getTime() ? 'Yesterday' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
export function RollScreen({ roll, onOpen, onBack, onImport, onSettings, busy, error, onDeleteMany }: Props) {
  const insets = useScreenInsets(), width = useLayoutWidth();
  const [filter, setFilter] = useState<string>('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const visible = useMemo(() => roll.filter(entry => filter === 'all' || (filter === 'favorites' ? entry.favorite : (entry.mediaType ?? 'photo') === filter)), [roll, filter]);
  const rows = useMemo<Row[]>(() => groupByDay(visible).flatMap(group => {
    const out: Row[] = [{ kind: 'day', key: group.day, day: group.day }];
    for (let i = 0; i < group.items.length; i += 3) out.push({ kind: 'photos', key: group.day + '-' + i, items: group.items.slice(i, i + 3) });
    return out;
  }), [visible]);
  const tileWidth = (width - 40 - 12) / 3;
  const toggle = (uri: string) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(uri)) next.delete(uri); else next.add(uri);
    return next;
  });
  const cancel = () => { setSelecting(false); setSelected(new Set()); setConfirm(false); };
  return <View style={[ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={ui.header}>
      <View><Text style={ui.eyebrow}>YOUR MOMENTS</Text><Text style={ui.title}>Film Roll</Text></View>
      <View style={ui.row}><IconButton icon="options-outline" label="Open settings" onPress={onSettings} disabled={busy} /><IconButton icon="camera-outline" label="Back to camera" onPress={onBack} disabled={busy} /></View>
    </View>
    <View style={s.summary}><Text style={ui.body}>{roll.length} {roll.length === 1 ? 'memory' : 'memories'} · stored {Platform.OS === 'web' ? 'in this browser' : 'on this iPhone'}</Text><Pressable accessibilityRole="button" onPress={() => selecting ? cancel() : setSelecting(true)} disabled={busy || !visible.length} style={s.selectButton}><Text style={s.selectText}>{selecting ? 'Cancel' : 'Select'}</Text></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filters}>
      {filters.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: filter === item.id }} disabled={busy}
        onPress={() => { setFilter(item.id); cancel(); }} style={[s.filter, filter === item.id && s.filterActive]}>
        {item.id === 'favorites' && <Icon name="heart-outline" size={15} color={filter === item.id ? theme.bg : theme.muted} />}
        <Text style={[s.filterText, filter === item.id && { color: theme.bg }]}>{item.name}</Text>
      </Pressable>)}
    </ScrollView>
    {error ? <View style={{ paddingHorizontal: 20 }}><Notice text={error} error /></View> : null}
    <FlatList data={rows} keyExtractor={item => item.key} initialNumToRender={10} windowSize={5}
      contentContainerStyle={[s.list, rows.length === 0 && { flexGrow: 1 }]} showsVerticalScrollIndicator={false}
      extraData={selected}
      ListEmptyComponent={<View style={s.empty}>
        <View style={s.emptyIcon}><Icon name={filter === 'favorites' ? 'heart-outline' : 'images-outline'} color={theme.accent} size={35} /></View>
        <Text style={s.emptyTitle}>{filter === 'favorites' ? 'Keep your favourites close.' : filter === 'video' ? 'Your short films live here.' : 'Make a little memory.'}</Text>
        <Text style={s.emptyBody}>{filter === 'favorites' ? 'Tap the heart on a photo or clip to find it here.' : filter === 'video' ? 'Switch to Video in the iPhone camera to record your first clip.' : 'Take a photo or bring one in. Try a camera, find your look, and keep the original.'}</Text>
        {filter !== 'favorites' && <Button label="Open camera" primary icon="camera-outline" onPress={onBack} />}
      </View>}
      renderItem={({ item }) => item.kind === 'day' ? <Text style={s.day}>{dayLabel(item.day)}</Text> :
        <View style={s.grid}>{item.items.map(entry => <Pressable key={entry.uri} accessibilityRole="button"
          accessibilityLabel={(entry.mediaType === 'video' ? 'Video' : 'Photo') + ', ' + entry.cameraName + (entry.favorite ? ', favourite' : '')}
          accessibilityState={selecting ? { selected: selected.has(entry.uri) } : undefined} disabled={busy}
          onPress={() => selecting ? toggle(entry.uri) : onOpen(entry)}
          onLongPress={() => { setSelecting(true); toggle(entry.uri); }}
          style={[s.tile, { width: tileWidth, height: tileWidth * 1.18 }, selected.has(entry.uri) && s.tileSelected]}>
          {entry.mediaType === 'video' && !entry.thumbnailUri ? <View style={s.placeholder}><Icon name="play-outline" size={30} /></View> :
            <Image source={{ uri: entry.mediaType === 'video' ? entry.thumbnailUri! : entry.uri }} style={StyleSheet.absoluteFill} />}
          <View style={s.topBadges}>{entry.favorite && <Icon name="heart" size={15} color="#fff" />}
            {selecting && <View style={[s.selection, selected.has(entry.uri) && { backgroundColor: theme.accent }]}>{selected.has(entry.uri) && <Icon name="checkmark" color={theme.bg} size={15} />}</View>}</View>
          <View style={s.tileFooter}><Text style={s.tileLabel} numberOfLines={1}>{entry.cameraName}</Text><View style={ui.row}>{entry.mediaType === 'video' ? <Text style={s.duration}>{Math.max(1, Math.ceil((entry.durationMs ?? 0) / 1000))}s</Text> : null}{entry.savedToLibrary && <Icon name="checkmark-circle" size={12} color="#fff" />}</View></View>
        </Pressable>)}</View>}
    />
    <View style={s.bottom}>
      {selecting ? <><Text style={s.selectedCount}>{selected.size} selected</Text><Button label="Delete selected" icon="trash-outline" danger onPress={() => setConfirm(true)} disabled={busy || !selected.size} style={{ flex: 1 }} /></> :
        <><Button label="Import photo" icon="add-outline" onPress={onImport} disabled={busy} style={{ flex: 1 }} /><Button label="Camera" icon="camera-outline" primary onPress={onBack} disabled={busy} style={{ flex: 1 }} /></>}
    </View>
    {confirm && <View style={s.modal} accessibilityViewIsModal><View style={s.dialog}><Text style={s.emptyTitle}>Delete {selected.size} {selected.size === 1 ? 'item' : 'items'}?</Text><Text style={ui.body}>These items and their originals will leave Film Roll. Copies in Photos stay there.</Text><Button label="Keep them" onPress={() => setConfirm(false)} disabled={busy} primary /><Button label="Delete from Film Roll" danger icon="trash-outline" disabled={busy} onPress={() => { void onDeleteMany([...selected]).then(success => { if (success) cancel(); else setConfirm(false); }); }} /></View></View>}
  </View>;
}
const s = StyleSheet.create({
  summary: { paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectButton: { minHeight: 44, paddingLeft: 12, justifyContent: 'center' }, selectText: { color: theme.accent, fontSize: 13, fontWeight: '600' },
  filterScroll: { flexGrow: 0, flexShrink: 0 }, filters: { paddingHorizontal: 20, gap: 8, paddingVertical: 10 },
  filter: { minHeight: 44, paddingHorizontal: 17, borderRadius: 23, backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6 },
  filterActive: { backgroundColor: theme.accent }, filterText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingBottom: 20 }, day: { color: theme.muted, fontSize: 12, fontWeight: '600', marginTop: 15, marginBottom: 12 },
  grid: { flexDirection: 'row', gap: 6, marginBottom: 6 }, tile: { borderRadius: 12, overflow: 'hidden', backgroundColor: theme.surface },
  tileSelected: { borderWidth: 2, borderColor: theme.accent }, placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBadges: { position: 'absolute', top: 7, left: 7, right: 7, flexDirection: 'row', justifyContent: 'space-between' },
  selection: { marginLeft: 'auto', width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: '#fff', backgroundColor: '#00000030', alignItems: 'center', justifyContent: 'center' },
  tileFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 7, paddingVertical: 7, backgroundColor: '#00000080', flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileLabel: { color: '#fff', fontSize: 10, fontWeight: '600', flex: 1 }, duration: { color: '#fff', fontSize: 10 },
  empty: { flex: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', gap: 18, paddingVertical: 40 },
  emptyIcon: { width: 82, height: 82, borderRadius: 26, backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { color: theme.text, fontSize: 23, lineHeight: 29, fontWeight: '600', textAlign: 'center', letterSpacing: -.5 },
  emptyBody: { color: theme.muted, textAlign: 'center', fontSize: 14, lineHeight: 22, maxWidth: 280 },
  bottom: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: theme.line },
  selectedCount: { color: theme.muted, fontSize: 14, flex: 1 },
  modal: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000a0', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: theme.surface, padding: 22, borderRadius: 24, gap: 16 },
});
