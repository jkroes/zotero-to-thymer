import type { ZothymerPref } from '../prefs/zothymer-pref';

import { ErrorL10nId, LocalizableError } from './LocalizableError';

// No pref-specific messages; all missing prefs use the generic fallback below.
const L10N_IDS: Partial<Record<ZothymerPref, ErrorL10nId>> = {};

export class MissingPrefError extends LocalizableError {
  public readonly name = 'MissingPrefError';

  public constructor(pref: ZothymerPref) {
    super(
      `Missing pref: ${pref}`,
      L10N_IDS[pref] || 'zothymer-error-missing-pref',
      { l10nArgs: { pref } },
    );
  }
}
