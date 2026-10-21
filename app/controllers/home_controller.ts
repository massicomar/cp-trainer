import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { LESSON_SIZE } from '#services/lesson_planner'
import SessionSelection from '#services/session_selection'
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
 * The session setup page and its live "N problems match" line.
 */
@inject()
export default class HomeController {
  constructor(protected selection: SessionSelection) {}

  /**
   * Pre-fills from the query string ("Change selection" links), then the
   * player's last selection, then everything.
   */
  async show({ request, view, player }: HttpContext) {
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

    const [count, perSubject] = await Promise.all([
      this.selection.count(current),
      this.selection.countBySubject(TIERS),
    ])

    return view.render('pages/home', {
      subjects,
      tiers: TIERS,
      current,
      count,
      complete: this.selection.isComplete(current),
      perSubject,
      lessonSize: LESSON_SIZE,
      presets: {
        all: visibleIds.join(','),
        dp: visibleIds.includes('dp') ? 'dp' : null,
        modules: MODULES.map((m) => ({
          key: m.key,
          subjects: m.subjects.filter((id) => visibleIds.includes(id)).join(','),
        })).filter((m) => m.subjects),
        last: saved && this.selection.isComplete(saved) ? saved : null,
      },
    })
  }

  /**
   * GET /selection/count, called by HTMX whenever a chip is toggled.
   */
  async count({ request, view }: HttpContext) {
    const subjects = await this.selection.visibleSubjects()
    const current = this.selection.normalize(
      request.qs(),
      subjects.map((s) => s.id)
    )
    return view.render('partials/selection_count', {
      count: await this.selection.count(current),
      complete: this.selection.isComplete(current),
      lessonSize: LESSON_SIZE,
    })
  }
}
