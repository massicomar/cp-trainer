import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import contentConfig from '#config/content'
import Problem from '#models/problem'
import Catalog from '#services/catalog'
import ProblemDraft from '#services/problem_draft'
import StatementImport from '#services/statement_import'
import type { ProblemFile } from '#types/content'

/** Standard prompts for the DP layer presets on the contribute page. */
const LAYER_PRESETS = {
  dpState: { key: 'dp-state', kind: 'dp-state', prompt: 'What should the DP state represent?' },
  dpTransition: {
    key: 'dp-transition',
    kind: 'dp-transition',
    prompt: 'Given that state, which transition is right?',
  },
}

/** What a link import managed to fill in, shown above the form. */
type ImportNotice = 'fetched' | 'blocked' | 'failed'

/**
 * /contribute: a form that writes a problem file for the content repo.
 * The page follows the UI language; the file is English, with optional
 * Spanish versions of the texts that explain (D-064, D-084). Nothing is stored on
 * the server; the file reaches the content repo through a GitHub PR.
 */
@inject()
export default class ContributeController {
  constructor(
    protected drafts: ProblemDraft,
    protected catalog: Catalog,
    protected importer: StatementImport
  ) {}

  /**
   * The start screen ("From a link" / "Manual" / edit an existing problem),
   * `?new=1` for a blank form, or `?from=<id>` to edit an existing problem.
   */
  async show({ request, view }: HttpContext) {
    const from = request.input('from')
    const fromId = typeof from === 'string' ? from.trim() : ''
    if (!fromId && !request.input('new')) {
      const problems = await Problem.query().select('id').orderBy('id')
      return view.render('pages/contribute_start', { problemIds: problems.map((p) => p.id) })
    }
    const loaded = fromId ? await this.drafts.load(fromId) : null
    const problem = loaded ?? this.drafts.blank()
    return view.render(
      'pages/contribute',
      await this.page(problem, {
        editing: loaded ? fromId : null,
        notFound: fromId && !loaded ? fromId : null,
      })
    )
  }

  /**
   * POST /contribute/import { url }: the form prefilled from the judge, the
   * manual form for Codeforces / SPOJ, or edit mode if the problem exists.
   */
  async import({ request, response, session, view, i18n }: HttpContext) {
    const url = request.input('url')
    const result = await this.importer.import(typeof url === 'string' ? url : '')

    if (result.kind === 'invalid') {
      session.flash('error', i18n.t('messages.contribute.notices.invalidLink'))
      return response.redirect('/contribute')
    }
    if (result.kind === 'existing') {
      session.flash('notice', i18n.t('messages.contribute.notices.existing', { id: result.id }))
      return response.redirect(`/contribute?from=${encodeURIComponent(result.id)}`)
    }
    const notice: ImportNotice = result.kind === 'fetched' ? 'fetched' : result.reason
    return view.render(
      'pages/contribute',
      await this.page(result.draft, {
        editing: null,
        notFound: null,
        notice,
        judge: result.draft.source,
      })
    )
  }

  /**
   * Every form change (HTMX) gets the preview back; a plain submit gets the
   * whole page with the form as typed.
   */
  async preview({ request, view }: HttpContext) {
    const problem = this.drafts.fromForm(request.all())
    const editing = typeof request.input('editing') === 'string' ? request.input('editing') : ''
    if (request.header('hx-request') === 'true') {
      return view.render('partials/contribute_preview', {
        preview: await this.drafts.preview(problem, editing || null),
      })
    }
    return view.render(
      'pages/contribute',
      await this.page(problem, { editing: editing || null, notFound: null })
    )
  }

  protected async page(
    problem: ProblemFile,
    state: {
      editing: string | null
      notFound: string | null
      notice?: ImportNotice
      judge?: string
    }
  ) {
    const [taxonomy, problems, choices, preview] = await Promise.all([
      this.catalog.taxonomy(),
      Problem.query().select('id').orderBy('id'),
      this.drafts.choices(),
      this.drafts.preview(problem, state.editing),
    ])
    return {
      ...state,
      // Optional lists always present, so the template can loop over them.
      problem: {
        ...problem,
        appearsIn: problem.appearsIn ?? [],
        distractors: problem.distractors ?? [],
        traps: problem.traps ?? [],
        pairWith: problem.pairWith ?? [],
        extraLayers: problem.extraLayers ?? [],
        es: {
          explanation: problem.es?.explanation ?? '',
          traps: problem.es?.traps ?? [],
          layers: problem.es?.layers ?? {},
        },
      },
      preview,
      choices,
      subjects: taxonomy.subjects,
      techniqueGroups: taxonomy.subjects.map((subject) => ({
        subject,
        techniques: taxonomy.techniques.filter((t) => t.subjectId === subject.id),
      })),
      problemIds: problems.map((p) => p.id),
      roles: ['intended', 'accepted', 'overkill'],
      presets: {
        dpState: JSON.stringify(LAYER_PRESETS.dpState),
        dpTransition: JSON.stringify(LAYER_PRESETS.dpTransition),
      },
      repoUrl: contentConfig.repoUrl,
    }
  }
}
