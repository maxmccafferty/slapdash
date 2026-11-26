/**
 * Maximum spans for joists and rafters, to check the solver end to end (member model,
 * loads, NDS factors, deflection limits) against an independent calculation.
 *
 * SOURCE STATUS — READ BEFORE TRUSTING: these are NOT yet values read from the AWC Span
 * Options Calculator (https://awc.org/codes-standards/calculators-software/spancalc/).
 * On 2026-11-25 the calculator could not be read without running its JavaScript app
 * (span-calc.netlify.app), and the IRC span tables (codes.iccsafe.org) refused automated
 * reads (HTTP 403). The spans below are computed by hand with the method AWC publishes
 * for its span tables and calculator (awc.org "Tutorial for understanding loads and
 * using span tables" and "Online span calculator help", read 2026-11-25):
 *
 * - simple span, uniform load = (live + dead) × spacing, rafters on the horizontal projection;
 * - bending Fb' = Fb · CD · CF · Cr with Cr = 1.15 (repetitive), CF from NDS Supplement
 *   Table 4A, CD 1.0 (floor live), 1.15 (snow), 1.25 (roof live);
 * - deflection from the live (or snow) load alone, with the tabulated E;
 * - the span is the smaller of the bending and deflection spans.
 *
 * Reference values (psi): SPF No.2 Fb 875, E 1,400,000; DF-L No.2 Fb 900, E 1,600,000
 * (NDS 2018 Supplement Table 4A). Replace `span_in` with the calculator's output (and
 * set `verifiedAgainstAwc: true`) when someone can run it; the test keeps its ±3%.
 */
export interface SpanCase {
  name: string;
  materialId: string;
  section: '2x6' | '2x8' | '2x10';
  role: 'joist' | 'rafter';
  spacing: '16in' | '24in';
  /** Live (or snow / roof live) and dead loads, psf. */
  live_psf: number;
  dead_psf: number;
  liveKind: 'L' | 'S' | 'Lr';
  /** Deflection limit L/x under the live load. */
  deflection: 240 | 360 | 180;
  /** Maximum span, inches. */
  span_in: number;
  governs: 'bending' | 'deflection';
  verifiedAgainstAwc: boolean;
  /** How the number was obtained. */
  working: string;
}

export const AWC_SPANS: SpanCase[] = [
  {
    name: 'SPF No.2 2x8 floor joist, 16 in o.c., 40 L / 10 D, L/360',
    materialId: 'spf-no2',
    section: '2x8',
    role: 'joist',
    spacing: '16in',
    live_psf: 40,
    dead_psf: 10,
    liveKind: 'L',
    deflection: 360,
    span_in: 147.4,
    governs: 'deflection',
    verifiedAgainstAwc: false,
    working:
      'I = 47.63 in⁴; deflection: L³ = 384·E·I / (5·360·w_L), w_L = 53.33 plf → 147.4 in. Bending: Fb\' = 875·1.2·1.15 = 1207.5 psi, S = 13.14 in³, w = 66.67 plf → 151.2 in.',
  },
  {
    name: 'DF-L No.2 2x10 floor joist, 24 in o.c., 40 L / 10 D, L/360',
    materialId: 'df-l-no2',
    section: '2x10',
    role: 'joist',
    spacing: '24in',
    live_psf: 40,
    dead_psf: 10,
    liveKind: 'L',
    deflection: 360,
    span_in: 152.9,
    governs: 'bending',
    verifiedAgainstAwc: false,
    working:
      'Bending: Fb\' = 900·1.1·1.15 = 1138.5 psi, S = 21.39 in³, w = 100 plf → 152.9 in. Deflection: I = 98.93 in⁴, w_L = 80 plf → 171.7 in.',
  },
  {
    name: 'SPF No.2 2x6 rafter, 16 in o.c., 30 psf snow / 10 D, L/240',
    materialId: 'spf-no2',
    section: '2x6',
    role: 'rafter',
    spacing: '16in',
    live_psf: 30,
    dead_psf: 10,
    liveKind: 'S',
    deflection: 240,
    span_in: 140.8,
    governs: 'deflection',
    verifiedAgainstAwc: false,
    working:
      'I = 20.80 in⁴; deflection: w_S = 40 plf → 140.8 in. Bending: Fb\' = 875·1.3·1.15·1.15 = 1504.4 psi, S = 7.5625 in³, w = 53.33 plf → 143.1 in.',
  },
  {
    name: 'SPF No.2 2x8 rafter, 24 in o.c., 20 psf roof live / 10 D, L/180',
    materialId: 'spf-no2',
    section: '2x8',
    role: 'rafter',
    spacing: '24in',
    live_psf: 20,
    dead_psf: 10,
    liveKind: 'Lr',
    deflection: 180,
    span_in: 178.1,
    governs: 'bending',
    verifiedAgainstAwc: false,
    working:
      'Bending: Fb\' = 875·1.2·1.15·1.25 = 1509.4 psi, S = 13.14 in³, w = 60 plf → 178.1 in. Deflection: w_Lr = 40 plf → 204.4 in.',
  },
];
