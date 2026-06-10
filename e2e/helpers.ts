// Helpers partagés par les specs : lecture de l'état du global-setup et
// injection d'auth AVANT le premier chargement de page (addInitScript).
import * as fs from 'fs'
import * as path from 'path'
import type { Page } from '@playwright/test'
import type { E2EState } from './global-setup'

const STATE_PATH = path.join(__dirname, '.state.json')

export function loadState(): E2EState {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'))
}

// Neutralise l'auto-login superadmin dev (AUTO_LOGIN_ADMIN_DEV) : AuthContext
// ignore le dev-login quand la clé kc_no_autologin est présente.
export async function blockAutoLogin(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('kc_no_autologin', '1')
  })
}

// Connecte le compte du global-setup sans consommer d'appel login :
// le token est posé en localStorage avant le chargement de l'app.
export async function authenticate(page: Page, state: E2EState) {
  await page.addInitScript(
    ({ token, orgId }) => {
      window.localStorage.setItem('kc_no_autologin', '1')
      window.localStorage.setItem('cbsaas_token', token)
      window.localStorage.setItem('cbsaas_org', String(orgId))
    },
    { token: state.token, orgId: state.orgId },
  )
}
