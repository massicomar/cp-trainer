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

router.get('/', [controllers.Home, 'show']).as('home')
router.get('/selection/count', [controllers.Home, 'count']).as('selection.count')

router.post('/lessons', [controllers.Lessons, 'store']).as('lessons.store')
router
  .group(() => {
    router.get('/', [controllers.Lessons, 'show']).as('lessons.show')
    router.post('/answer', [controllers.Lessons, 'answer']).as('lessons.answer')
    router.post('/give-up', [controllers.Lessons, 'giveUp']).as('lessons.give_up')
    router.post('/skip', [controllers.Lessons, 'skip']).as('lessons.skip')
    router.post('/continue', [controllers.Lessons, 'continue']).as('lessons.continue')
    router.post('/next', [controllers.Lessons, 'next']).as('lessons.next')
    router.get('/summary', [controllers.Lessons, 'summary']).as('lessons.summary')
  })
  .prefix('/lessons/:id')
  .where('id', router.matchers.number())

router.get('/health', [controllers.Health, 'show']).as('health')
