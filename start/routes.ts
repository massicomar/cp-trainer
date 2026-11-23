/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

router.get('/', [controllers.Home, 'show']).as('home')
router.get('/selection/count', [controllers.Home, 'count']).as('selection.count')

router.post('/lessons', [controllers.Lessons, 'store']).as('lessons.store')
router.post('/custom', [controllers.Lessons, 'custom']).as('custom.store').use(middleware.auth())
router
  .group(() => {
    router.get('/', [controllers.Lessons, 'show']).as('lessons.show')
    router.post('/answer', [controllers.Lessons, 'answer']).as('lessons.answer')
    router.post('/give-up', [controllers.Lessons, 'giveUp']).as('lessons.give_up')
    router.post('/skip', [controllers.Lessons, 'skip']).as('lessons.skip')
    router.post('/continue', [controllers.Lessons, 'continue']).as('lessons.continue')
    router.post('/next', [controllers.Lessons, 'next']).as('lessons.next')
    router.get('/summary', [controllers.Lessons, 'summary']).as('lessons.summary')
    router.get('/report', [controllers.Lessons, 'report']).as('lessons.report')
  })
  .prefix('/lessons/:id')
  .where('id', router.matchers.number())

router.get('/contribute', [controllers.Contribute, 'show']).as('contribute.show')
router.post('/contribute', [controllers.Contribute, 'preview']).as('contribute.preview')
router.post('/contribute/import', [controllers.Contribute, 'import']).as('contribute.import')

router.post('/preferences', [controllers.Preferences, 'update']).as('preferences.update')

// Accounts (plan §12.9)
router.get('/entrar', [controllers.Auth, 'show']).as('auth.show')
router.get('/auth/github', [controllers.Auth, 'github']).as('auth.github')
router.get('/auth/github/callback', [controllers.Auth, 'callback']).as('auth.github.callback')
router.post('/auth/dev', [controllers.Auth, 'dev']).as('auth.dev')
router.post('/logout', [controllers.Auth, 'logout']).as('auth.logout')
router
  .group(() => {
    router.get('/cuenta', [controllers.Account, 'show']).as('account.show')
    router.post('/cuenta/borrar', [controllers.Account, 'destroy']).as('account.destroy')
  })
  .use(middleware.auth())

router.get('/health', [controllers.Health, 'show']).as('health')
