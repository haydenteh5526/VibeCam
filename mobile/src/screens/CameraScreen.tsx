import React, { useCallback, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, useCameraPermission, type CameraRef } from 'react-native-vision-camera';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const RED = '#E63946';

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const cameraRef = useRef<CameraRef>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Shutter animation
  const shutterScale = useSharedValue(1);
  const shutterAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));

  const onPressIn = useCallback(() => {
    shutterScale.value = withSpring(0.85, { damping: 15, stiffness: 300 });
  }, [shutterScale]);

  const onPressOut = useCallback(() => {
    shutterScale.value = withSpring(1, { damping: 12, stiffness: 200 });
  }, [shutterScale]);

  // Capture
  const onCapture = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      const snapshot = await cameraRef.current.takeSnapshot();
      const path = await snapshot.saveToTemporaryFileAsync('jpg', 90);
      setCapturedImage(path);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      // Silently handle capture errors on device
    }
  }, []);

  const onRetake = useCallback(() => setCapturedImage(null), []);
  const onApplyVibe = useCallback(() => {}, []);

  // Placeholder handlers
  const onFlashToggle = useCallback(() => {}, []);
  const onFlipCamera = useCallback(() => {}, []);
  const onOpenSettings = useCallback(() => {}, []);
  const onOpenGallery = useCallback(() => {}, []);
  const onVibeToggle = useCallback(() => {}, []);

  // ─── Permission fallback ─────────────────────────────────────────────────

  if (!hasPermission) {
    return (
      <View style={s.permScreen}>
        <Pressable style={s.permBtn} onPress={requestPermission}>
          <Text style={s.permBtnText}>Grant Camera Access</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Preview mode ────────────────────────────────────────────────────────

  if (capturedImage) {
    return (
      <View style={s.container}>
        <Image source={{ uri: `file://${capturedImage}` }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={[s.previewBar, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onRetake} hitSlop={12}>
            <Text style={s.previewAction}>Retake</Text>
          </Pressable>
          <Pressable onPress={onApplyVibe} hitSlop={12}>
            <Text style={s.previewAction}>Apply Vibe</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── No device fallback ──────────────────────────────────────────────────

  if (!device) {
    return (
      <View style={s.permScreen}>
        <Text style={s.noDevice}>No camera device available</Text>
      </View>
    );
  }

  // ─── Live camera ─────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
      />

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={onFlashToggle} style={s.topBtn} hitSlop={12}>
          <View style={s.iconFlash} />
        </Pressable>
        <Pressable onPress={onFlipCamera} style={s.topBtn} hitSlop={12}>
          <View style={s.iconFlip} />
        </Pressable>
        <Pressable onPress={onOpenSettings} style={s.topBtn} hitSlop={12}>
          <View style={s.iconSettings} />
        </Pressable>
      </View>

      {/* Bottom */}
      <View style={[s.bottomWrap, { paddingBottom: insets.bottom + 16 }]}>
        <BlurView intensity={40} tint="dark" style={s.blurFill} />
        <View style={s.bottomRow}>
          <Pressable onPress={onOpenGallery} style={s.galleryThumb}>
            <View style={s.galleryPlaceholder} />
          </Pressable>

          <Pressable onPress={onCapture} onPressIn={onPressIn} onPressOut={onPressOut}>
            <Animated.View style={[s.shutterOuter, shutterAnimStyle]}>
              <View style={s.shutterInner} />
            </Animated.View>
          </Pressable>

          <Pressable onPress={onVibeToggle} style={s.vibeBtn}>
            <View style={s.vibeIcon} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Permission
  permScreen: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  permBtn: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 999 },
  permBtnText: { color: '#0a0a0a', fontSize: 15, fontWeight: '600' },
  noDevice: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  // Preview
  previewBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24,
  },
  previewAction: { color: '#fff', fontSize: 16, fontWeight: '500' },

  // Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 12,
  },
  topBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  iconFlash: { width: 4, height: 14, backgroundColor: '#fff', borderRadius: 2 },
  iconFlip: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  iconSettings: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },

  // Bottom
  bottomWrap: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 24, overflow: 'hidden' },
  blurFill: { ...StyleSheet.absoluteFillObject },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  galleryThumb: { width: 44, height: 44, borderRadius: 10, overflow: 'hidden' },
  galleryPlaceholder: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10 },
  shutterOuter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 3.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: RED },
  vibeBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center',
  },
  vibeIcon: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)' },
});
