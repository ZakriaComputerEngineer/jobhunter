// Strong terminal page signals. Keep these specific so ordinary JD wording does not end a live application.
export const ALREADY_APPLIED_RX = /^(?:already\s+)?applied(?:\s+on\s+.+)?$|^(?:application\s+)?(?:submitted|received)$/i;

export const CLOSED_JOB_RX = /\b(?:no longer accepting applications|not accepting (?:new )?applications|applications? (?:are |is )?(?:now )?closed|applications? (?:have |has )?ended|application (?:window|period) (?:has )?(?:closed|ended|expired)|(?:this |the )?(?:job|position|vacancy|posting) (?:is |has )?(?:no longer available|closed|expired|been filled)|position has been filled|vacancy (?:is )?closed)\b/i;

// A listing CTA sometimes reloads the same aggregator page forever. Two clicks
// are enough to allow a slow redirect while keeping the user wait under control.
export const MAX_APPLY_CLICKS_WITHOUT_PROGRESS = 2;

export const shouldPauseRepeatedApply = (clicks) => clicks >= MAX_APPLY_CLICKS_WITHOUT_PROGRESS;

const NON_APPLICATION_FIELD_RX = /search|keyword|filter|subscribe|newsletter|job alert/i;
const CANDIDATE_FIELD_RX = /first.?name|last.?name|full.?name|e-?mail|phone|mobile|resume|cv\b|cover.?letter|linkedin|portfolio|address|city|country|work.?authori[sz]ation|visa|salary|experience|education/i;

export function isApplicationForm(fields = []) {
  const relevant = fields.filter((f) => !NON_APPLICATION_FIELD_RX.test(`${f.label || ''} ${f.name || ''}`));
  return relevant.some((f) => f.type === 'file' || CANDIDATE_FIELD_RX.test(`${f.label || ''} ${f.name || ''}`))
    || relevant.some((f) => f.required) || relevant.length >= 3;
}

export function requiredEmptyFields(fields = []) {
  return fields.filter((f) => f.required && (f.value == null || String(f.value).trim() === ''));
}
