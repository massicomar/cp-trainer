import { inject } from '@adonisjs/core'
import DrillCatalog from '#services/drill_catalog'
import { shuffle, type Random } from '#services/random'
import { DRILL_KINDS, type DrillKind, type LessonItem } from '#types/drills'

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

/** A Custom round of short questions only is as long as a full round (5 + 3). */
export const DRILLS_ONLY_SIZE = 8

/**
 * Interleaves drills with a lesson's problems. Slots get a shuffled mix of
 * the three kinds of question; the algorithm slot needs an algorithm of a
 * selected subject, the others need the Big O table. With a Custom `kinds`
 * filter, the slots draw from those kinds only (`pickDrills`).
 */
export function planItems(
  problemIds: string[],
  available: DrillAvailability,
  random: Random,
  kinds: DrillKind[] | null = null
): LessonItem[] {
  const slots = DRILLS_AFTER.filter((i) => i < problemIds.length)
  const drills = kinds
    ? pickDrills(slots.length, available, kinds, random)
    : defaultDrills(slots.length, available, random)

  const items: LessonItem[] = []
  problemIds.forEach((id, i) => {
    items.push({ type: 'problem', id })
    const slot = slots.indexOf(i)
    if (slot !== -1 && drills[slot]) items.push(drills[slot])
  })
  return items
}

/**
 * A Custom round of short questions only: `size` drills of the allowed
 * kinds (all of them when `kinds` is null).
 */
export function planDrillsOnly(
  available: DrillAvailability,
  random: Random,
  kinds: DrillKind[] | null = null,
  size = DRILLS_ONLY_SIZE
): LessonItem[] {
  return pickDrills(size, available, kinds ?? [...DRILL_KINDS], random)
}

/**
 * `count` drills cycling through the allowed kinds, reshuffled each cycle.
 * Kinds without content are left out: algorithm questions need an algorithm
 * of the subjects (each asked once; when they run out, a generated kind takes
 * the slot if allowed), the others the Big O table.
 */
export function pickDrills(
  count: number,
  available: DrillAvailability,
  kinds: DrillKind[],
  random: Random
): LessonItem[] {
  const algorithms = shuffle(available.algorithms, random)
  const generated = kinds.filter((kind) => kind !== 'algorithm-big-o' && available.generated)
  const usable = kinds.filter((kind) =>
    kind === 'algorithm-big-o' ? algorithms.length > 0 : available.generated
  )
  if (!usable.length) return []

  const drills: LessonItem[] = []
  let cycle: DrillKind[] = []
  while (drills.length < count) {
    if (!cycle.length) cycle = shuffle(usable, random)
    const kind = cycle.shift()!
    if (kind !== 'algorithm-big-o') {
      drills.push({ type: 'drill', kind })
      continue
    }
    const algorithmId = algorithms.shift()
    if (algorithmId) {
      drills.push({ type: 'drill', kind, algorithmId })
    } else if (generated.length) {
      drills.push({ type: 'drill', kind: generated[Math.floor(random() * generated.length)] })
    } else {
      break
    }
  }
  return drills
}

/**
 * The default mix: one slot of each kind of question, in a random order.
 */
function defaultDrills(count: number, available: DrillAvailability, random: Random) {
  const algorithms = shuffle(available.algorithms, random)

  const kinds: Slot[] = shuffle(['max-big-o', 'algorithm', 'reverse'] as Slot[], random)
  const drills: LessonItem[] = []
  for (const slot of kinds.slice(0, count)) {
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
  return drills
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
