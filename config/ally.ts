import env from '#start/env'
import { defineConfig, services } from '@adonisjs/ally'
import type { InferSocialProviders } from '@adonisjs/ally/types'

/**
 * GitHub sign-in (plan §12.9). No scopes: the app only reads the public
 * profile (id, username, name, avatar), never email or repositories.
 * Without GITHUB_CLIENT_ID the login page hides the button.
 */
const allyConfig = defineConfig({
  github: services.github({
    clientId: env.get('GITHUB_CLIENT_ID', ''),
    clientSecret: env.get('GITHUB_CLIENT_SECRET', ''),
    callbackUrl: `${env.get('APP_URL')}/auth/github/callback`,
    scopes: [],
  }),
})

export default allyConfig

declare module '@adonisjs/ally/types' {
  interface SocialProviders extends InferSocialProviders<typeof allyConfig> {}
}
