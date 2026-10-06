import React from 'react';
import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';

// Use the real icon glyphs without Expo's native font loader in this standalone harness.
export default function Icon({ name, size, color }: { name: keyof typeof glyphs; size: number; color: string }) {
  return <span aria-hidden style={{ fontFamily: 'Ionicons', fontSize: size, color }}>{String.fromCodePoint(glyphs[name])}</span>;
}
