import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import contentConfig from '#config/content'
import Problem from '#models/problem'
import Catalog from '#services/catalog'
import ProblemDraft from '#services/problem_draft'
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

/**
 * /contribute: a form that writes a problem file for the content repo.
 * English only, like the content it produces (D-048).
 */
@inject()
export default class ContributeController {
  constructor(
    protected drafts: ProblemDraft,
    protected catalog: Catalog
  ) {}

  /**
   * Blank form, or `?from=<id>` to start from an existing problem.
   */
  async show({ request, view }: HttpContext) {
    const from = request.input('from')
    const fromId = typeof from === 'string' ? from.trim() : ''
    const loaded = fromId ? await this.drafts.load(fromId) : null
    const problem = loaded ?? this.drafts.blank()
    return view.render(
      'pages/contribute',
      await this.page(problem, loaded ? fromId : null, fromId && !loaded ? fromId : null)
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
    return view.render('pages/contribute', await this.page(problem, editing || null, null))
  }

  protected async page(problem: ProblemFile, editing: string | null, notFound: string | null) {
    const [taxonomy, problems, choices, preview] = await Promise.all([
      this.catalog.taxonomy(),
      Problem.query().select('id').orderBy('id'),
      this.drafts.choices(),
      this.drafts.preview(problem, editing),
    ])
    return {
      // Optional lists always present, so the template can loop over them.
      problem: {
        ...problem,
        appearsIn: problem.appearsIn ?? [],
        distractors: problem.distractors ?? [],
        traps: problem.traps ?? [],
        pairWith: problem.pairWith ?? [],
        extraLayers: problem.extraLayers ?? [],
      },
      editing,
      notFound,
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
