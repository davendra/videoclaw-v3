/**
 * Cinema profile resolution.
 *
 * The single place that decides a project's default cinematography register.
 * Joey 2.0 principle: "photorealism is the universal default, dial down by
 * exception" — so with ZERO flags and no project override, a project resolves to
 * the full detailed treatment (rich + realism + prose). Callers dial DOWN via
 * the project manifest's `cinemaProfile` block or per-call CLI overrides.
 *
 * Precedence (highest wins):
 *   1. CLI override (per invocation)
 *   2. project.cinemaProfile (persisted on the manifest)
 *   3. genre default (per-genre look policy)
 *   4. HARD DEFAULT (the universal photoreal baseline)
 *
 * Pure/deterministic: no Date, no Math.random, no I/O.
 */

import type { VideoCinemaProfile } from './workspace.js';
import { resolveGenreStyle } from './filmmaking-prompts.js';

export type CinemaDetail = 'terse' | 'standard' | 'rich';
export type CinemaRegister = 'prose' | 'numeric';
export type CinemaHaze = 'thin' | 'light' | 'heavy';
export type CinemaPlateKind = 'mid-gray' | 'white' | 'black';
export type CinemaCaptureRegister = 'cinema' | 'phone';

/**
 * A fully-resolved cinema profile — every field is concrete (no `undefined`),
 * so downstream emitters never re-apply defaults.
 */
export interface ResolvedCinemaProfile {
  detail: CinemaDetail;
  realism: boolean;
  register: CinemaRegister;
  haze: CinemaHaze;
  wet: boolean;
  /** Lighting register id; `undefined` means "use the emitter's own default". */
  lightingId?: string;
  /** Color-grade register id; `undefined` means "use the emitter's own default". */
  gradeId?: string;
  plateKind: CinemaPlateKind;
  captureRegister: CinemaCaptureRegister;
}

/**
 * A per-call override layer (e.g. parsed CLI flags). Same shape as the persisted
 * {@link VideoCinemaProfile}; every field is optional and wins over the project +
 * genre + hard-default layers when present.
 */
export type CinemaProfileOverrides = VideoCinemaProfile;

/**
 * Per-genre default profile patches. Applied below the project/CLI layers but
 * above the HARD DEFAULT. Keyed by the CANONICAL genre (after alias resolution
 * via {@link resolveGenreStyle}), so `ugc`/`vlog`/`social` all map to
 * `influencer`. Influencer/UGC defaults to a phone capture register; every other
 * genre inherits the cinema register from the hard default.
 */
const GENRE_PROFILE_DEFAULTS: Readonly<Record<string, VideoCinemaProfile>> = {
  influencer: { captureRegister: 'phone' },
};

/**
 * The universal photoreal baseline. This is what a project resolves to with no
 * project override, no genre default, and no CLI flags. `captureRegister` is set
 * per call from the genre (influencer/ugc → phone, everything else → cinema).
 */
function hardDefault(captureRegister: CinemaCaptureRegister): ResolvedCinemaProfile {
  return {
    detail: 'rich',
    realism: true,
    register: 'prose',
    haze: 'light',
    wet: false,
    plateKind: 'mid-gray',
    captureRegister,
  };
}

/**
 * Resolve the effective cinema profile for a render.
 *
 * @param manifestProfile  the persisted `project.cinemaProfile` (or undefined).
 * @param cliOverrides     per-call overrides (parsed CLI flags, or undefined).
 * @param genre            the resolved genre/style id (drives the genre layer +
 *                         the hard-default capture register). Aliases are
 *                         resolved internally via {@link resolveGenreStyle}.
 */
export function resolveCinemaProfile(
  manifestProfile: VideoCinemaProfile | undefined,
  cliOverrides: CinemaProfileOverrides | undefined,
  genre: string | undefined,
): ResolvedCinemaProfile {
  const canonicalGenre = resolveGenreStyle(genre).genre;
  const isPhoneGenre = canonicalGenre === 'influencer';
  const base = hardDefault(isPhoneGenre ? 'phone' : 'cinema');
  const genreLayer = GENRE_PROFILE_DEFAULTS[canonicalGenre] ?? {};

  // Merge the layers in increasing-precedence order onto the hard default.
  const merged: ResolvedCinemaProfile = { ...base };
  applyLayer(merged, genreLayer);
  applyLayer(merged, manifestProfile);
  applyLayer(merged, cliOverrides);
  return merged;
}

/** Overwrite only the defined keys of a partial profile onto the resolved one. */
function applyLayer(target: ResolvedCinemaProfile, layer: VideoCinemaProfile | undefined): void {
  if (!layer) return;
  if (layer.detail !== undefined) target.detail = layer.detail;
  if (layer.realism !== undefined) target.realism = layer.realism;
  if (layer.register !== undefined) target.register = layer.register;
  if (layer.haze !== undefined) target.haze = layer.haze;
  if (layer.wet !== undefined) target.wet = layer.wet;
  if (layer.lightingId !== undefined) target.lightingId = layer.lightingId;
  if (layer.gradeId !== undefined) target.gradeId = layer.gradeId;
  if (layer.plateKind !== undefined) target.plateKind = layer.plateKind;
  if (layer.captureRegister !== undefined) target.captureRegister = layer.captureRegister;
}
