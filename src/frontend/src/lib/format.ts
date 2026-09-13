export const money = (value: number | null | undefined, compact = false) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: compact ? 0 : 2,
      }).format(value);
export const percent = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
export const shortDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
export const initials = (value: string) =>
  value
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .filter((_, index, array) => index === 0 || index === array.length - 1)
    .join('');
