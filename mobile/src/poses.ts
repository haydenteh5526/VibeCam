export type PoseSuggestion = {
  id: string;
  name: string;
  instruction: string;
  category: 'portrait' | 'full' | 'group';
};

export const POSES: PoseSuggestion[] = [
  { id: 'chin-down', name: 'Chin Down', instruction: 'Tilt chin slightly down, eyes up to camera', category: 'portrait' },
  { id: 'three-quarter', name: '¾ Turn', instruction: 'Turn body 45° away, face toward camera', category: 'portrait' },
  { id: 'hand-face', name: 'Hand on Face', instruction: 'Rest chin gently on hand, relax fingers', category: 'portrait' },
  { id: 'look-away', name: 'Look Away', instruction: 'Gaze off-camera to the left, slight smile', category: 'portrait' },
  { id: 'over-shoulder', name: 'Over Shoulder', instruction: 'Look back over your shoulder at the camera', category: 'portrait' },
  { id: 'lean-wall', name: 'Lean Back', instruction: 'Lean against a wall, one foot up, arms relaxed', category: 'full' },
  { id: 'walk-toward', name: 'Walk Toward', instruction: 'Walk naturally toward the camera, mid-stride', category: 'full' },
  { id: 'sit-cross', name: 'Seated Cross', instruction: 'Sit with legs crossed, lean slightly forward', category: 'full' },
  { id: 'hands-pocket', name: 'Hands in Pockets', instruction: 'Thumbs in pockets, shoulders relaxed, slight angle', category: 'full' },
  { id: 'candid-laugh', name: 'Candid Laugh', instruction: 'Think of something funny, natural laugh', category: 'portrait' },
  { id: 'group-stagger', name: 'Stagger Heights', instruction: 'Vary heights — some sit, some stand, some lean', category: 'group' },
  { id: 'group-close', name: 'Get Close', instruction: 'Squeeze together, heads close, natural smiles', category: 'group' },
];

export function getRandomPose(category?: 'portrait' | 'full' | 'group'): PoseSuggestion {
  const filtered = category ? POSES.filter(p => p.category === category) : POSES;
  return filtered[Math.floor(Math.random() * filtered.length)];
}
