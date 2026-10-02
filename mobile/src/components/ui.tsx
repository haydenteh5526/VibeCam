import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const theme = {
  bg: '#10110f', surface: '#1c1e1a', elevated: '#282b25', line: '#353a30',
  text: '#f5f1e8', muted: '#b1b5a9', dim: '#7c8275', accent: '#efb764',
  danger: '#ffa49c', green: '#c0d8a5',
};
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 22, color = theme.text }: { name: IconName; size?: number; color?: string }) =>
  <Ionicons name={name} size={size} color={color} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden />;

export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'web' ? { top: 44, bottom: 16, left: 0, right: 0 } : insets;
}
export function IconButton({ icon, label, onPress, active, disabled, style }: {
  icon: IconName; label: string; onPress: () => void; active?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, ...(active !== undefined ? { selected: active } : {}) }}
    style={({ pressed }) => [ui.iconButton, active && { backgroundColor: '#453823' }, pressed && ui.pressed, disabled && ui.disabled, style]}>
    <Icon name={icon} color={active ? theme.accent : theme.text} />
  </Pressable>;
}
export function Button({ label, onPress, icon, primary, disabled, danger, style }: {
  label: string; onPress: () => void; icon?: IconName; primary?: boolean; disabled?: boolean; danger?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const color = primary ? theme.bg : danger ? theme.danger : theme.text;
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
    style={({ pressed }) => [ui.button, primary && { backgroundColor: theme.accent, borderColor: theme.accent }, pressed && ui.pressed, disabled && ui.disabled, style]}>
    {icon ? <Icon name={icon} size={19} color={color} /> : null}<Text style={[ui.buttonText, { color }]}>{label}</Text>
  </Pressable>;
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  if (!text) return null;
  return <View style={[ui.notice, error && { backgroundColor: '#352320' }]}>
    <Icon name={error ? 'alert-circle-outline' : 'information-circle-outline'} size={18} color={error ? theme.danger : theme.muted} />
    <Text accessibilityRole={error ? 'alert' : undefined} style={[ui.noticeText, error && { color: theme.danger }]}>{text}</Text>
  </View>;
}
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  eyebrow: { fontSize: 11, letterSpacing: 2.2, fontWeight: '700', color: theme.accent },
  title: { color: theme.text, fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.8 },
  body: { color: theme.muted, fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.surface, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 48, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 }, disabled: { opacity: 0.4 },
  notice: { flexDirection: 'row', gap: 8, backgroundColor: theme.surface, padding: 12, borderRadius: 12, marginVertical: 6 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18, color: theme.muted },
});
