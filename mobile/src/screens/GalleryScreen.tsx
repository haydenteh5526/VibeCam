import React from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { GalleryItem } from '../types';
import { formatBytes } from '../utils';

const W = Dimensions.get('window').width;
type Props = { gallery: GalleryItem[]; onBack: () => void };

export function GalleryScreen({ gallery, onBack }: Props) {
  return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.nav}>
        <Pressable onPress={onBack} style={({ pressed }) => [s.backBtn, pressed && s.pressed]}><Text style={s.backT}>← Back</Text></Pressable>
        <Text style={s.navT}>Uploads</Text>
        <Text style={s.count}>{gallery.length}</Text>
      </View>
      {gallery.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}><Text style={s.emptyIconT}>◻</Text></View>
          <Text style={s.emptyH}>No uploads yet</Text>
          <Text style={s.emptyP}>Captured media will appear here after uploading</Text>
        </View>
      ) : (
        <FlatList data={gallery} numColumns={3} keyExtractor={i => i.upload_id} contentContainerStyle={s.grid} renderItem={({ item }) => (
          <View style={s.cell}>
            <View style={s.cellInner}>
              {item.mime_type.startsWith('video/') && <View style={s.vidBadge}><Text style={s.vidT}>▶</Text></View>}
              <View style={s.cellMeta}><Text style={s.cellName} numberOfLines={1}>{item.file_name}</Text><Text style={s.cellSize}>{formatBytes(item.size_bytes)}</Text></View>
            </View>
          </View>
        )} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#09090b' },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#27272a' },
  backBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  backT: { color: '#a1a1aa', fontSize: 14, fontWeight: '500' },
  navT: { color: '#fafafa', fontSize: 16, fontWeight: '600', letterSpacing: -0.3 },
  count: { color: '#52525b', fontSize: 13, fontWeight: '500', backgroundColor: '#27272a', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyIconT: { fontSize: 20, color: '#52525b' },
  emptyH: { color: '#fafafa', fontSize: 15, fontWeight: '500', marginBottom: 4 },
  emptyP: { color: '#52525b', fontSize: 13, textAlign: 'center' },
  grid: { padding: 2 },
  cell: { width: (W - 8) / 3, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, backgroundColor: '#18181b', borderRadius: 8, borderWidth: 1, borderColor: '#27272a', overflow: 'hidden', justifyContent: 'flex-end' },
  vidBadge: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  vidT: { color: '#fff', fontSize: 9 },
  cellMeta: { padding: 6 },
  cellName: { color: '#a1a1aa', fontSize: 9, fontWeight: '500' },
  cellSize: { color: '#52525b', fontSize: 8, marginTop: 1 },
});
