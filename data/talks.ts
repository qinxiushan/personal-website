import type { Talk } from '~/types'

export const talks: Talk[] = [
]
})

talks.sort((a, b) => {
  return new Date(b.presentations[0].date).getTime() - new Date(a.presentations[0].date).getTime()
})
