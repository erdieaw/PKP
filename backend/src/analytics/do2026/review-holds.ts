import { MANAGEMENT_HOLDS } from './reviewed-management';
import { CLINICAL_HOLDS } from './reviewed-clinical';
import { INFECTIOUS_CROSS_HOLDS } from './reviewed-infectious-cross';

// Reviewed source limitations are not a substitute formula or an approval decision.
export const DO_REVIEW_HOLDS: Readonly<Record<string, string>> = {
  ...MANAGEMENT_HOLDS,
  ...CLINICAL_HOLDS,
  ...INFECTIOUS_CROSS_HOLDS,
};
