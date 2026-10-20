import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { LESSON_SIZE } from '#services/lesson_planner'
import SessionSelection from '#services/session_selection'
import { TIERS, type Selection } from '#types/play'

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
        : { subjects: visibleIds, tiers: TIERS }

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
