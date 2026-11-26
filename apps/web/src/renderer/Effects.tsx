/**
 * Post effects for the user's view only (snapshots skip them): ambient occlusion with N8AO
 * (half resolution on the medium tier, off on low), and SMAA on the low tier, where the
 * canvas has no MSAA.
 */
import { EffectComposer, N8AO, SMAA } from '@react-three/postprocessing';
import { TIER_SETTINGS, type QualityTier } from './quality.ts';

export function Effects({ tier }: { tier: QualityTier }) {
  const s = TIER_SETTINGS[tier];
  if (s.ao === 'off') {
    return (
      <EffectComposer key="low" multisampling={0}>
        <SMAA />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer key={tier} multisampling={s.msaa}>
      <N8AO halfRes={s.ao === 'half'} aoRadius={0.6} distanceFalloff={0.6} intensity={1.6} quality={s.ao === 'half' ? 'low' : 'medium'} />
    </EffectComposer>
  );
}
