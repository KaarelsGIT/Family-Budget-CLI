export function formatDateToEstonian(isoDate: string): string {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}.${month}.${year}`;
}

export function parseEstonianDateToIso(estDate: string): string {
  if (!estDate) return '';
  const parts = estDate.split('.');
  if (parts.length !== 3) return estDate;
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  const year = parts[2];
  if (year.length !== 4) return estDate;
  return `${year}-${month}-${day}`;
}
