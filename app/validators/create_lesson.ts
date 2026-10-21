import vine from '@vinejs/vine'
import { TIERS } from '#types/play'

/**
 * Shape of the setup form. Whether each subject exists and is visible is
 * checked by SessionSelection.normalize, which knows the taxonomy.
 */
export const createLessonValidator = vine.compile(
  vine.object({
    subjects: vine.array(vine.string().trim()).minLength(1),
    tiers: vine.array(vine.enum(TIERS)).minLength(1),
    // "official" leaves community-added problems out; anything else keeps them.
    problems: vine.enum(['official', 'all']).optional(),
    // A hidden "off" plus the checkbox's "on" when ticked (SessionSelection.normalize).
    drills: vine.any().optional(),
  })
)
