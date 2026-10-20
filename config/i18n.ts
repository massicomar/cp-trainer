import app from '@adonisjs/core/services/app'
import { defineConfig, formatters, loaders } from '@adonisjs/i18n'

/**
 * The app's own text (buttons, prompts, feedback) is translated; problem
 * content from the content repo always stays in English.
 */
const i18nConfig = defineConfig({
  defaultLocale: 'en',
  supportedLocales: ['en', 'es'],
  formatter: formatters.icu(),

  loaders: [
    /**
     * resources/lang/<locale>/messages.json
     */
    loaders.fs({
      location: app.languageFilesPath(),
    }),
  ],
})

export default i18nConfig
