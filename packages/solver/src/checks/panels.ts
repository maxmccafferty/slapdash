/**
 * Shear-panel check: the unit shear a sheet carries against the allowable unit shear in
 * the catalog (SDPWS ASD wind values). With the panel's average shear strain γ and its
 * apparent shear stiffness Ga, the unit shear is v = Ga·|γ| (N per mm of panel edge).
 */
export function panelUnitShear(Ga: number, strain: number): number {
  return Ga * Math.abs(strain);
}
