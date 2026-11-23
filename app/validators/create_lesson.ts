import vine from '@vinejs/vine'
import { DRILL_KINDS } from '#types/drills'
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

/**
 * The Custom panel (plan §12.7): the setup plus subtemas and the kinds of
 * short questions. Tiers can be empty for short questions only;
 * SessionSelection.missing says what else a round needs.
 */
export const customRoundValidator = vine.compile(
  vine.object({
    subjects: vine.array(vine.string().trim()).minLength(1),
    tiers: vine.array(vine.enum(TIERS)).optional(),
    problems: vine.enum(['official', 'all']).optional(),
    // off | mixed | only
    drills: vine.any().optional(),
    // The markers tell "no box ticked" from "no filter".
    techniqueFilter: vine.any().optional(),
    techniques: vine.array(vine.string().trim()).optional(),
    drillKindFilter: vine.any().optional(),
    drillKinds: vine.array(vine.enum(DRILL_KINDS)).optional(),
  })
)
