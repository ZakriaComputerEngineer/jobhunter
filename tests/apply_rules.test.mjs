import test from 'node:test';
import assert from 'node:assert/strict';

import { ALREADY_APPLIED_RX, CLOSED_JOB_RX, isApplicationForm, requiredEmptyFields, shouldPauseRepeatedApply } from '../scraper/apply_rules.mjs';

test('limits repeated Apply clicks before asking the user for help', () => {
  assert.equal(shouldPauseRepeatedApply(0), false);
  assert.equal(shouldPauseRepeatedApply(1), false);
  assert.equal(shouldPauseRepeatedApply(2), true);
});

test('recognizes an opened application form from even one candidate field', () => {
  assert.equal(isApplicationForm([{ label: 'Upload your resume', name: 'resume', type: 'file', required: false }]), true);
  assert.equal(isApplicationForm([{ label: 'Email address', name: 'email', type: 'email', required: true }]), true);
  assert.equal(isApplicationForm([{ label: 'Search jobs', name: 'q', type: 'text', required: true }]), false);
});

test('blocks navigation while required values remain empty', () => {
  const missing = requiredEmptyFields([
    { label: 'Name', required: true, value: '' },
    { label: 'Country', required: true, value: 'Pakistan' },
    { label: 'Optional note', required: false, value: '' },
  ]);
  assert.deepEqual(missing.map((x) => x.label), ['Name']);
});

test('recognizes already-applied controls without confusing Apply actions', () => {
  for (const text of ['Applied', 'Already applied', 'Applied on Nov 2', 'Application submitted', 'Application received']) {
    assert.match(text, ALREADY_APPLIED_RX);
  }
  for (const text of ['Apply', 'Applied jobs', 'Submit application']) {
    assert.doesNotMatch(text, ALREADY_APPLIED_RX);
  }
});

test('recognizes strong closed-job notices', () => {
  for (const text of [
    'No longer accepting applications',
    'We are not accepting new applications',
    'Applications are now closed',
    'The application period has ended',
    'This job is no longer available',
    'This position has been filled',
    'The posting has expired',
    'Vacancy closed',
  ]) assert.match(text, CLOSED_JOB_RX);
});

test('does not classify ordinary application or engineering text as closed', () => {
  for (const text of [
    'Apply now',
    'We are accepting applications',
    'Experience with closed-loop control systems',
    'Review previous applications',
    'The successful applicant will fill this position',
  ]) assert.doesNotMatch(text, CLOSED_JOB_RX);
});
