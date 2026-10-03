/** Inspired looks, not measured reproductions of a camera's complete imaging pipeline. */
export type FilterId = 'original' | 'g7x' | 'rx100' | 'gr' | 'x100' | 'ccd' | 'powershot';
export type FilterPreset = {
  id: FilterId; name: string; fullName: string; tagline: string; dot: string;
  description: string; bestFor: string; body: string;
};
export const FILTERS: FilterPreset[] = [
  { id: 'original', name: 'Original', fullName: 'Your iPhone', tagline: 'Untouched', dot: '#aeb4a6', body: '#70766b', description: 'The original capture, with no VibeCam processing.', bestFor: 'A clean starting point' },
  { id: 'g7x', name: 'G7X III', fullName: 'Canon G7X III inspired', tagline: 'Warm & luminous', dot: '#efb764', body: '#38342d', description: 'Warm colour, lively reds and gentle texture. An everyday pocket-camera look.', bestFor: 'People · golden hour · everyday' },
  { id: 'rx100', name: 'RX100', fullName: 'Sony RX100 inspired', tagline: 'Clean & crisp', dot: '#a9bdd0', body: '#32383d', description: 'Cooler colour, clear contrast and the lightest texture in the collection.', bestFor: 'Travel · daylight · architecture' },
  { id: 'gr', name: 'GR III', fullName: 'Ricoh GR III inspired', tagline: 'Deep & contrasty', dot: '#c2c6b9', body: '#30352e', description: 'Deep blacks and restrained colour, with a little extra bite for the street.', bestFor: 'Street · shadows · city walks' },
  { id: 'x100', name: 'X100', fullName: 'Fujifilm X100 inspired', tagline: 'Soft & understated', dot: '#bfbea0', body: '#777d6f', description: 'Muted colour and lifted shadows with a gentle highlight shoulder.', bestFor: 'Quiet moments · daylight · portraits' },
  { id: 'ccd', name: 'CCD 2004', fullName: 'Early digital compact inspired', tagline: 'Grainy & nostalgic', dot: '#abd1b9', body: '#8a9891', description: 'A lo-fi digital look: visible texture, cooler shadows and stronger corner falloff.', bestFor: 'Night out · close flash · nostalgia' },
  { id: 'powershot', name: 'PowerShot', fullName: 'Canon compact inspired', tagline: 'Golden & playful', dot: '#dea680', body: '#777269', description: 'Golden warmth, lively colour and small-camera texture for spontaneous moments.', bestFor: 'Friends · parties · direct flash' },
];
export const getLook = (id: string) => FILTERS.find(f => f.id === id) ?? FILTERS[1];
