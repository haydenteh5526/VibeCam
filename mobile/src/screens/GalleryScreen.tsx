import React from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { GalleryItem } from '../types';

const W = Dimensions.get('window').width;
type Props = { gallery: GalleryItem[]; onBack: () => void };

export function GalleryScreen({ gallery, onBack }: Props) {
  return (
    <View style={s.bg}><StatusBar style="light" />
      <View style={s.nav}><Pressable onPress={onBack}><Text style={s.navL}>‹</Text></Pressable><Text style={s.navT}>Uploads</Text><View style={{ width: 28 }} /></View>
      {gallery.length === 0 ? <View style={s.mid}><Text style={s.dim}>Nothing here yet</Text></View> : (
        <FlatList data={gallery} numColumns={3} keyExtractor={i => i.upload_id} contentContainerStyle={{ padding: 1 }} renderItem={({ item }) => (
          <View style={s.cell}><View style={s.inner}>{item.mime_type.startsWith('video/') && <Text style={s.vid}>▶</Text>}</View></View>
        )} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000' },
  mid: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  dim: { color: 'rgba(255,255,255,0.35)', fontSize: 15 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 8 },
  navL: { fontSize: 28, color: '#fff', fontWeight: '300' },
  navT: { fontSize: 17, fontWeight: '600', color: '#fff' },
  cell: { width: W / 3, aspectRatio: 1, padding: 0.5 },
  inner: { flex: 1, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  vid: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
