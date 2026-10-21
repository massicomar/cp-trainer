import { inject } from '@adonisjs/core'
import DrillCatalog from '#services/drill_catalog'
import { shuffle, type Random } from '#services/random'
import type { DrillKind, LessonItem } from '#types/drills'

/**
 * Drills go after the 1st, 3rd and 5th problems (0-based 0, 2, 4), so a full
 * lesson is 5 problems + 3 drills and a shorter one has fewer, at least 1.
 */
export const DRILLS_AFTER = [0, 2, 4]

/** One slot per kind of question; "reverse" asks max-n or fits. */
type Slot = 'max-big-o' | 'algorithm' | 'reverse'

export interface DrillAvailability {
  /** The Big O table is synced: the generated kinds can be asked. */
  generated: boolean
  /** Algorithm drill ids of the lesson's subjects. */
  algorithms: string[]
}

/**
 * Interleaves drills with a lesson's problems. Slots get a shuffled mix of
 * the three kinds of question; the algorithm slot needs an algorithm of a
 * selected subject, the others need the Big O table.
 */
export function planItems(
  problemIds: string[],
  available: DrillAvailability,
  random: Random
): LessonItem[] {
  const slots = DRILLS_AFTER.filter((i) => i < problemIds.length)
  const algorithms = shuffle(available.algorithms, random)

  const kinds: Slot[] = shuffle(['max-big-o', 'algorithm', 'reverse'] as Slot[], random)
  const drills: LessonItem[] = []
  for (const slot of kinds.slice(0, slots.length)) {
    const kind: Slot =
      slot === 'algorithm' && !algorithms.length
        ? random() < 0.5
          ? 'max-big-o'
          : 'reverse'
        : slot !== 'algorithm' && !available.generated
          ? 'algorithm'
          : slot
    if (kind === 'algorithm') {
      const algorithmId = algorithms.shift()
      if (algorithmId) drills.push({ type: 'drill', kind: 'algorithm-big-o', algorithmId })
    } else if (available.generated) {
      const drillKind: DrillKind =
        kind === 'reverse' ? (random() < 0.5 ? 'max-n' : 'fits') : 'max-big-o'
      drills.push({ type: 'drill', kind: drillKind })
    }
  }

  const items: LessonItem[] = []
  problemIds.forEach((id, i) => {
    items.push({ type: 'problem', id })
    const slot = slots.indexOf(i)
    if (slot !== -1 && drills[slot]) items.push(drills[slot])
  })
  return items
}

@inject()
export default class DrillPlanner {
  constructor(protected drills: DrillCatalog) {}

  async availability(subjects: string[]): Promise<DrillAvailability> {
    const [table, algorithms] = await Promise.all([
      this.drills.table(),
      this.drills.algorithmIds(subjects),
    ])
    return { generated: table !== null, algorithms }
  }
}
