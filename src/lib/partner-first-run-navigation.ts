export const partnerFirstRunStepCount = 4;

export type PartnerFirstRunStep = 1 | 2 | 3 | 4;

export function getPartnerFirstRunStep(value: number): PartnerFirstRunStep {
  return Math.min(Math.max(Math.trunc(value), 1), partnerFirstRunStepCount) as PartnerFirstRunStep;
}

export function getPreviousPartnerFirstRunStep(step: PartnerFirstRunStep) {
  return step === 1 ? null : getPartnerFirstRunStep(step - 1);
}

export function getNextPartnerFirstRunStep(step: PartnerFirstRunStep) {
  return step === partnerFirstRunStepCount ? null : getPartnerFirstRunStep(step + 1);
}
