import { LanguageCode } from '../../i18n/translation.service';

const MONEY_LOCALE = 'et-EE';

export function formatMoney(value: number): string {
  return new Intl.NumberFormat(MONEY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  })
    .formatToParts(value)
    .map((part) => (part.type === 'group' ? ' ' : part.value))
    .join('')
    .replace(/\s+/g, ' ');
}

export function parseMoneyInput(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }

  if (typeof value === 'number') {
    return value;
  }

  const normalized = value.trim().replace(/,/g, '.');
  if (normalized === '') {
    return Number.NaN;
  }

  return Number.parseFloat(normalized);
}

export function formatEuroAmount(value: number, language: LanguageCode): string {
  return `${formatMoney(value)} €`;
}
