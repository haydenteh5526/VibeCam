import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, type CameraRef } from 'react-native-vision-camera';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

// ─── Accent ──────────────────────────────────────────────────────────────────

const RED = '#E63946';

// ─── Component ───────────────────────────────────────────────────────────────

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const device = useCameraDevice('back');
  const cameraRef = useRef<CameraRef>(null);

  // Shutter press animation
  const shutterScale = useSharedValue(1);
  const shutterAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));

  const onShutterPressIn = useCallback(() => {
    shutterScale.value = withSpring(0.85, { damping: 15, stiffness: 300 });
  }, [shutterScale]);

  const onShutterPressOut = useCallback(() => {
    shutterScale.value = withSpring(1, { damping: 12, stiffness: 200 });
  }, [shutterScale]);

  // Placeholder handlers
  const onCapture = useCallback(() => {}, []);
  const onFlashToggle = useCallback(() => {}, []);
  const onFlipCamera = useCallback(() => {}, []);
  const onOpenSettings = useCallback(() => {}, []);
  const onOpenGallery = useCallback(() => {}, []);
  const onVibeToggle = useCallback(() => {}, []);

  return (
    <View style={s.container}>
      {/* Full-screen viewfinder */}
      {device && (
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
        />
      )}

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

      {/* Bottom control area */}
      <View style={[s.bottomWrap, { paddingBottom: insets.bottom + 16 }]}>
        <BlurView intensity={40} tint="dark" style={s.blurFill} />

        <View style={s.bottomRow}>
          {/* Gallery thumbnail */}
          <Pressable onPress={onOpenGallery} style={s.galleryThumb}>
            <View style={s.galleryPlaceholder} />
          </Pressable>

          {/* Shutter button */}
          <Pressable
            onPress={onCapture}
            onPressIn={onShutterPressIn}
            onPressOut={onShutterPressOut}
          >
            <Animated.View style={[s.shutterOuter, shutterAnimStyle]}>
              <View style={s.shutterInner} />
            </Animated.View>
          </Pressable>

          {/* Vibe toggle */}
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
  container: {
    flex: 1,
    backgroundColor: '#000',
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  topBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFlash: {
    width: 4,
    height: 14,
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  iconFlip: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  iconSettings: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
  },

  // Bottom area
  bottomWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 24,
    overflow: 'hidden',
  },
  blurFill: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
  },

  // Gallery thumbnail
  galleryThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
  },
  galleryPlaceholder: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
  },

  // Shutter
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: RED,
  },

  // Vibe toggle
  vibeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vibeIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },
});
