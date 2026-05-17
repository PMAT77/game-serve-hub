import dayjs from 'dayjs'

export function formatPercent(value: number) {
  return `${value.toFixed(2)}%`
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return '-'
  }
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
}
