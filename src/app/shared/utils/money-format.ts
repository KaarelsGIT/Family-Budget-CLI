import { LanguageCode } from '../../i18n/translation.service';

const LOCALE_BY_LANGUAGE: Record<LanguageCode, string> = {
  et: 'et-EE',
  en: 'en-GB',
  fi: 'fi-FI'
};

export function formatEuroAmount(value: number, language: LanguageCode): string {
  const locale = LOCALE_BY_LANGUAGE[language] ?? LOCALE_BY_LANGUAGE.et;
  const formattedNumber = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  })
    .formatToParts(value)
    .map((part) => (part.type === 'group' ? ' ' : part.value))
    .join('')
    .replace(/\s+/g, ' ');

  return `${formattedNumber} €`;
}
