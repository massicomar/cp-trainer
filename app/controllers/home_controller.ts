import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { DRILLS_ONLY_SIZE } from '#services/drill_planner'
import { LESSON_SIZE } from '#services/lesson_planner'
import SessionSelection, { type TechniqueChoice } from '#services/session_selection'
import type Subject from '#models/subject'
import { DRILL_KINDS } from '#types/drills'
import { TIERS, type Selection } from '#types/play'

/**
 * The course's two modules, as setup presets (subjects that aren't in the
 * taxonomy anymore are left out).
 */
export const MODULES = [
  { key: 'module1', subjects: ['dp', 'graphs', 'geometry'] },
  { key: 'module2', subjects: ['number-theory', 'bsearch-dnc', 'segtree'] },
]

/**
 * `/`: the setup page without an account, the account home with one, and
 * the live "N problems match" line both use.
 */
@inject()
export default class HomeController {
  constructor(protected selection: SessionSelection) {}

  async show(ctx: HttpContext) {
    return ctx.currentUser ? this.accountHome(ctx) : this.setup(ctx)
  }

  /**
   * GET /selection/count, called by HTMX whenever a chip is toggled.
   */
  async count({ request, view }: HttpContext) {
    const [subjects, choices] = await Promise.all([
      this.selection.visibleSubjects(),
      this.selection.techniqueChoices(),
    ])
    const current = this.selection.normalize(
      request.qs(),
      subjects.map((s) => s.id),
      choices
    )
    return view.render('partials/selection_count', await this.countState(current, choices))
  }

  /**
   * Anonymous setup. Pre-fills from the query string ("Change selection"
   * links), then the player's last selection, then everything.
   */
  protected async setup({ request, view, player }: HttpContext) {
    const subjects = await this.selection.visibleSubjects()
    const visibleIds = subjects.map((s) => s.id)

    const fromQuery = this.selection.normalize(request.qs(), visibleIds)
    const saved = player?.preferences
      ? this.selection.normalize(player.preferences, visibleIds)
      : null
    const current: Selection = this.selection.isComplete(fromQuery)
      ? fromQuery
      : saved && this.selection.isComplete(saved)
        ? saved
        : { subjects: visibleIds, tiers: TIERS, includeCommunity: true, includeDrills: true }

    const perSubject = await this.selection.countBySubject(TIERS)
    return view.render('pages/home', {
      ...(await this.countState(current, [])),
      subjects,
      tiers: TIERS,
      current,
      perSubject,
      presets: this.presets(visibleIds, saved),
    })
  }

  /**
   * The account home (plan §12.1): Lecciones and Clase rápida are still to
   * come; Custom starts the last selection in one tap, or opens its panel
   * with every option. A "Change selection" link opens the panel prefilled.
   */
  protected async accountHome({ request, view, player, i18n, session }: HttpContext) {
    const [subjects, choices, perSubject] = await Promise.all([
      this.selection.visibleSubjects(),
      this.selection.techniqueChoices(),
      this.selection.countBySubject(TIERS),
    ])
    const visibleIds = subjects.map((s) => s.id)

    const fromQuery = this.selection.normalize(request.qs(), visibleIds, choices)
    const fromQueryComplete = this.selection.isComplete(fromQuery)
    const saved = player?.preferences
      ? this.selection.normalize(player.preferences, visibleIds, choices)
      : null
    const ready = this.selection.startingPoint(saved, visibleIds, choices)
    const current = fromQueryComplete ? fromQuery : ready

    const groups = subjects
      .map((subject) => ({
        subject,
        choices: choices.filter((choice) => choice.subjectId === subject.id),
      }))
      .filter((group) => group.choices.length)

    return view.render('pages/account_home', {
      ...(await this.countState(current, choices)),
      subjects,
      tiers: TIERS,
      drillKinds: DRILL_KINDS,
      current,
      perSubject,
      groups,
      presets: this.presets(visibleIds, saved && this.selection.isComplete(saved) ? saved : null),
      readyLine: describe(ready, subjects, i18n.t.bind(i18n)),
      panelOpen:
        fromQueryComplete ||
        session.flashMessages.has('inputErrorsBag') ||
        session.flashMessages.has('error'),
    })
  }

  /**
   * What the count line and the start button need.
   */
  protected async countState(current: Selection, choices: TechniqueChoice[]) {
    const single =
      current.techniques?.length === 1
        ? (choices.find((c) => c.id === current.techniques![0])?.name ?? null)
        : null
    return {
      count: await this.selection.count(current),
      complete: this.selection.isComplete(current),
      missing: this.selection.missing(current),
      drillsOnly: Boolean(current.drillsOnly),
      drillsOnlySize: DRILLS_ONLY_SIZE,
      singleTechnique: single,
      lessonSize: LESSON_SIZE,
    }
  }

  protected presets(visibleIds: string[], last: Selection | null) {
    return {
      all: visibleIds.join(','),
      dp: visibleIds.includes('dp') ? 'dp' : null,
      modules: MODULES.map((m) => ({
        key: m.key,
        subjects: m.subjects.filter((id) => visibleIds.includes(id)).join(','),
      })).filter((m) => m.subjects),
      last: last && last.subjects.length && last.tiers.length ? last : null,
    }
  }
}

type Translate = (key: string, data?: Record<string, unknown>) => string

/**
 * One line for a selection, as on the closed Custom card:
 * "Module 1 · Easy, Medium · all techniques · with short questions".
 */
export function describe(selection: Selection, subjects: Subject[], t: Translate): string {
  const ids = selection.subjects
  const visible = subjects.map((s) => s.id)
  const same = (list: string[]) =>
    list.length === ids.length && list.every((id) => ids.includes(id))

  const module = MODULES.find((m) => same(m.subjects.filter((id) => visible.includes(id))))
  const subjectPart = same(visible)
    ? t('messages.setup.presets.all')
    : module
      ? t(`messages.setup.presets.${module.key}`)
      : ids.length === 1
        ? (subjects.find((s) => s.id === ids[0])?.name ?? ids[0])
        : t('messages.custom.subjectCount', { count: ids.length })

  const parts = [subjectPart]
  if (!selection.drillsOnly) {
    parts.push(selection.tiers.map((tier) => t(`messages.tiers.${tier}`)).join(', '))
    parts.push(
      selection.techniques
        ? t('messages.custom.techniqueCount', { count: selection.techniques.length })
        : t('messages.custom.allTechniques')
    )
    if (!selection.includeCommunity) parts.push(t('messages.setup.collections.official'))
  }
  parts.push(
    selection.drillsOnly
      ? t('messages.custom.drills.only')
      : selection.includeDrills
        ? t('messages.custom.drills.with')
        : t('messages.custom.drills.without')
  )
  return parts.join(' · ')
}
