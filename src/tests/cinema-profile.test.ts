import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCinemaProfile } from '../video/cinema-profile.js';

test('hard default with zero overrides is the full photoreal treatment', () => {
  const profile = resolveCinemaProfile(undefined, undefined, undefined);
  assert.equal(profile.detail, 'rich');
  assert.equal(profile.realism, true);
  assert.equal(profile.register, 'prose');
  assert.equal(profile.haze, 'light');
  assert.equal(profile.wet, false);
  assert.equal(profile.plateKind, 'mid-gray');
  assert.equal(profile.captureRegister, 'cinema');
});

test('influencer genre defaults the capture register to phone', () => {
  const profile = resolveCinemaProfile(undefined, undefined, 'influencer');
  assert.equal(profile.captureRegister, 'phone');
  // everything else stays the photoreal hard default
  assert.equal(profile.detail, 'rich');
  assert.equal(profile.realism, true);
});

test('ugc/vlog/social aliases resolve to the phone capture register', () => {
  for (const genre of ['ugc', 'vlog', 'social']) {
    assert.equal(resolveCinemaProfile(undefined, undefined, genre).captureRegister, 'phone', genre);
  }
});

test('a non-influencer genre keeps the cinema capture register', () => {
  assert.equal(resolveCinemaProfile(undefined, undefined, 'live-action').captureRegister, 'cinema');
  assert.equal(resolveCinemaProfile(undefined, undefined, 'noir').captureRegister, 'cinema');
});

test('project.cinemaProfile dials down detail and realism', () => {
  const profile = resolveCinemaProfile({ detail: 'standard', realism: false }, undefined, undefined);
  assert.equal(profile.detail, 'standard');
  assert.equal(profile.realism, false);
  // unset fields fall back to the hard default
  assert.equal(profile.register, 'prose');
  assert.equal(profile.plateKind, 'mid-gray');
});

test('CLI override wins over the project profile', () => {
  const profile = resolveCinemaProfile(
    { detail: 'standard', register: 'prose' },
    { detail: 'terse', register: 'numeric' },
    undefined,
  );
  assert.equal(profile.detail, 'terse');
  assert.equal(profile.register, 'numeric');
});

test('precedence: CLI > project > genre > hard default for captureRegister', () => {
  // genre default would be phone, but the project pins cinema, and the CLI re-pins phone
  assert.equal(
    resolveCinemaProfile({ captureRegister: 'cinema' }, undefined, 'influencer').captureRegister,
    'cinema',
  );
  assert.equal(
    resolveCinemaProfile({ captureRegister: 'cinema' }, { captureRegister: 'phone' }, 'influencer').captureRegister,
    'phone',
  );
});

test('lighting/grade ids thread through when provided and stay undefined otherwise', () => {
  const dflt = resolveCinemaProfile(undefined, undefined, undefined);
  assert.equal(dflt.lightingId, undefined);
  assert.equal(dflt.gradeId, undefined);
  const overridden = resolveCinemaProfile({ lightingId: 'night-fire' }, { gradeId: 'bleach-bypass' }, undefined);
  assert.equal(overridden.lightingId, 'night-fire');
  assert.equal(overridden.gradeId, 'bleach-bypass');
});

test('haze and wet dial-up via CLI override', () => {
  const profile = resolveCinemaProfile(undefined, { haze: 'heavy', wet: true }, undefined);
  assert.equal(profile.haze, 'heavy');
  assert.equal(profile.wet, true);
});
