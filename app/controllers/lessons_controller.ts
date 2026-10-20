import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { findOrCreatePlayer } from '#middleware/player_middleware'
import Lesson from '#models/lesson'
import LessonFlow from '#services/lesson_flow'
import { problemReportUrl } from '#services/problem_reports'
import SessionSelection from '#services/session_selection'
import type { Selection } from '#types/play'
import { createLessonValidator } from '#validators/create_lesson'

/**
 * The lesson pages. Every POST works with and without HTMX: HTMX requests get
 * the `#play` partial back (or an HX-Redirect at the end); plain form posts
 * redirect to the lesson page, which renders the same state.
 */
@inject()
export default class LessonsController {
  constructor(
    protected flow: LessonFlow,
    protected selection: SessionSelection
  ) {}

  async store(ctx: HttpContext) {
    const { request, response, session, i18n } = ctx
    const data = await request.validateUsing(createLessonValidator)
    const subjects = await this.selection.visibleSubjects()
    const selection = this.selection.normalize(
      data,
      subjects.map((s) => s.id)
    )
    if (!this.selection.isComplete(selection)) {
      session.flash('error', i18n.t('messages.setup.errors.incomplete'))
      return response.redirect('/')
    }

    const player = await findOrCreatePlayer(ctx)
    const lesson = await this.flow.create(player, selection)
    if (!lesson) {
      session.flash('error', i18n.t('messages.setup.errors.noMatch'))
      return response.redirect(setupUrl(selection))
    }
    return response.redirect(`/lessons/${lesson.id}`)
  }

  async show(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    const play = await this.flow.state(lesson)
    if (!play) return ctx.response.redirect(`/lessons/${lesson.id}/summary`)
    return ctx.view.render('pages/lesson', { play })
  }

  async answer(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    await this.flow.answer(lesson, inputString(ctx, 'step'), inputString(ctx, 'option'))
    return this.respond(ctx, lesson)
  }

  async giveUp(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    await this.flow.giveUp(lesson, inputString(ctx, 'step'))
    return this.respond(ctx, lesson)
  }

  async skip(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    await this.flow.skip(lesson)
    return this.respond(ctx, lesson)
  }

  async continue(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    await this.flow.continue(lesson)
    return this.respond(ctx, lesson)
  }

  /**
   * "Next lesson" on the summary: same selection, fresh problems.
   */
  async next(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    const next = await this.flow.create(ctx.player!, lesson.selection)
    if (!next) {
      ctx.session.flash('error', ctx.i18n.t('messages.setup.errors.noMatchAnymore'))
      return ctx.response.redirect(setupUrl(lesson.selection))
    }
    return ctx.response.redirect(`/lessons/${next.id}`)
  }

  async summary(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    if (!lesson.isDone) return ctx.response.redirect(`/lessons/${lesson.id}`)
    return ctx.view.render('pages/lesson_summary', {
      summary: await this.flow.summary(lesson),
      changeUrl: setupUrl(lesson.selection),
    })
  }

  /**
   * "Report a problem": resolves the step (or summary entry) to a problem and
   * layer, then sends the player to a pre-filled GitHub issue.
   */
  async report(ctx: HttpContext) {
    const lesson = await this.find(ctx)
    const target = await this.flow.reportTarget(lesson, ctx.request.qs())
    if (!target) return ctx.response.redirect(`/lessons/${lesson.id}`)
    return ctx.response.redirect(problemReportUrl(target))
  }

  /**
   * Only the player who owns a lesson can see it; anyone else gets a 404.
   */
  protected find({ params, player }: HttpContext) {
    return Lesson.query()
      .where('id', params.id)
      .where('player_id', player?.id ?? '')
      .firstOrFail()
  }

  protected async respond(ctx: HttpContext, lesson: Lesson) {
    const url = lesson.isDone ? `/lessons/${lesson.id}/summary` : `/lessons/${lesson.id}`
    if (ctx.request.header('hx-request') !== 'true') return ctx.response.redirect(url)

    if (lesson.isDone) {
      ctx.response.header('HX-Redirect', url)
      return ''
    }
    return ctx.view.render('partials/play', { play: await this.flow.state(lesson) })
  }
}

function inputString({ request }: HttpContext, key: string) {
  const value = request.input(key)
  return typeof value === 'string' ? value : ''
}

/**
 * The setup page pre-filled with a selection.
 */
function setupUrl(selection: Selection) {
  const query = new URLSearchParams()
  for (const subject of selection.subjects) query.append('subjects[]', subject)
  for (const tier of selection.tiers) query.append('tiers[]', tier)
  if (!selection.includeCommunity) query.append('problems', 'official')
  return `/?${query}`
}
