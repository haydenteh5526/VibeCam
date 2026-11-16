import React from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { readBuildInfo } from '../buildInfo';
import { formatBuildReport, type BuildInfo } from '../buildReport';
import { theme } from './ui';

export function BuildDetails({ read = readBuildInfo }: { read?: () => Promise<BuildInfo> }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState<string | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [shareFailed, setShareFailed] = React.useState(false);
  const request = React.useRef(0);
  React.useEffect(() => () => { request.current += 1; }, []);

  const toggle = () => {
    const id = ++request.current;
    setText(null); setUnavailable(false); setShareFailed(false);
    if (open) { setOpen(false); return; }
    setOpen(true);
    read().then(
      info => { if (request.current === id) setText(formatBuildReport(info).join('\n')); },
      () => { if (request.current === id) setUnavailable(true); },
    );
  };
  const share = () => {
    if (text === null || sharing) return;
    const id = request.current;
    setShareFailed(false); setSharing(true);
    Share.share({ message: text }).then(
      () => {},
      () => { if (request.current === id) setShareFailed(true); },
    ).finally(() => setSharing(false));
  };

  return <View style={s.wrap}>
    <Pressable accessibilityRole="button" accessibilityLabel="Build details" accessibilityState={{ expanded: open }} aria-expanded={open} onPress={toggle} style={s.press}>
      <Text style={s.control}>Build details</Text>
    </Pressable>
    {open && unavailable && <Text style={s.message}>Build details are unavailable.</Text>}
    {open && text !== null && <>
      <Text selectable style={s.report}>{text}</Text>
      {Platform.OS !== 'web' && <Pressable accessibilityRole="button" disabled={sharing} onPress={share} style={s.press}><Text style={s.share}>Share build report</Text></Pressable>}
      {shareFailed && <Text accessibilityRole="alert" style={s.message}>Could not share the build report. Select the text above to copy it.</Text>}
    </>}
  </View>;
}
const s = StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'stretch' },
  press: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  control: { color: theme.muted, fontSize: 12, fontWeight: '600' },
  report: { color: theme.muted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  share: { color: theme.accent, fontSize: 12, fontWeight: '600' },
  message: { color: theme.muted, fontSize: 11, textAlign: 'center' },
});
