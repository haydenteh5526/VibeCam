import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraBody } from '../components/CameraPicker';
import { Button, Notice, theme, ui, useScreenInsets } from '../components/ui';
type Props = { onAllow: () => void; onRoll: () => void; onImport: () => void; canAskAgain: boolean; busy: boolean; error: string };
export function PermissionScreen({ onAllow, onRoll, onImport, canAskAgain, busy, error }: Props) {
  const insets = useScreenInsets();
  return <View style={[ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={ui.header}><Text style={s.brand}>vibecam</Text><Text style={ui.eyebrow}>POCKET MEMORIES</Text></View>
    <ScrollView contentContainerStyle={s.content}>
      <View style={s.illustration}><View style={s.orbit} /><View style={{ transform: [{ scale: 2.2 }, { rotate: '-9deg' }] }}><CameraBody color="#888c7c" accent={theme.accent} /></View><View style={s.sticker}><Text style={s.stickerText}>TAKE IT EVERYWHERE</Text></View></View>
      <Text style={s.title}>A little camera.{'\n'}A different feeling.</Text>
      <Text style={s.body}>Six pocket-camera looks for everyday moments. Shoot photos and short films, find your favourite colour, and keep it all close.</Text>
      <View style={s.features}><Text style={s.feature}>6 CAMERA LOOKS</Text><View style={s.dot} /><Text style={s.feature}>ALL ON YOUR DEVICE</Text></View>
      <Notice text={canAskAgain ? 'Allow camera access when prompted. Microphone access is only needed for video sound.' : 'Camera access is off. You can enable it in your device or browser settings, or start with a photo you already have.'} />
      <Notice text={error} error />
      <Button label={canAskAgain ? 'Open camera' : Platform.OS === 'web' ? 'Try camera again' : 'Open Settings'} primary icon="camera-outline" onPress={onAllow} disabled={busy} />
      <Button label="Import a photo" icon="image-outline" onPress={onImport} disabled={busy} />
      <Button label="My Film Roll" icon="images-outline" onPress={onRoll} disabled={busy} />
      <Text style={s.footer}>No account. No uploads. Just your moments.</Text>
    </ScrollView>
  </View>;
}
const s = StyleSheet.create({
  brand: { color: theme.text, fontSize: 26, fontWeight: '700', letterSpacing: -1.2 },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 24, gap: 12, justifyContent: 'center' },
  illustration: { height: 190, alignItems: 'center', justifyContent: 'center' },
  orbit: { position: 'absolute', width: 190, height: 190, borderRadius: 95, borderWidth: 1, borderColor: theme.line },
  sticker: { position: 'absolute', bottom: 16, right: 20, padding: 8, borderRadius: 5, backgroundColor: theme.accent, transform: [{ rotate: '-6deg' }] },
  stickerText: { color: theme.bg, fontSize: 9, letterSpacing: 1, fontWeight: '800' },
  title: { color: theme.text, fontSize: 37, lineHeight: 41, fontWeight: '600', letterSpacing: -1.3, marginTop: 10 },
  body: { color: theme.muted, fontSize: 15, lineHeight: 23, marginTop: 4 },
  features: { flexDirection: 'row', gap: 8, alignItems: 'center', marginVertical: 10, flexWrap: 'wrap' },
  feature: { color: theme.accent, fontSize: 9, fontWeight: '700', letterSpacing: 1 }, dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: theme.dim },
  footer: { color: theme.dim, fontSize: 11, textAlign: 'center', marginTop: 10 },
});
