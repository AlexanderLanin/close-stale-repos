import * as core from '@actions/core'
import { IParameters } from './parameters'

export async function getInputs(): Promise<IParameters> {
  const result = {} as unknown as IParameters

  result.github_server = get_input('github-server-url', false)
  if (result.github_server === '') {
    result.github_server = process.env['GITHUB_SERVER_URL']!
  }
  validate_valid_url('github-server-url', result.github_server)

  result.organization = get_input('organization', false)
  if (result.organization === '') {
    result.organization = process.env['GITHUB_REPOSITORY_OWNER']!
  }
  validate_organization_syntax(result.organization)

  result.token = get_input('token')
  validate_token_syntax(result.token)

  const days_until_stale = parseInt(get_input('days_until_stale'))
  validate_positive_number('days_until_stale', days_until_stale)
  result.stale_date = calculate_stale_date(days_until_stale)

  result.cache_path = get_input('cache_path')
  result.cache_ttl_seconds = parseInt(get_input('cache_ttl_seconds'))
  validate_positive_number('cache_ttl_seconds', result.cache_ttl_seconds)

  core.debug(`Inputs: ${JSON.stringify(result)}`)

  return result
}

function get_input(name: string, required: boolean = true): string {
  return core.getInput(name, { required: required })
}

function validate_organization_syntax(organization: string): void {
  const organizationRegex = /^[a-zA-Z0-9-]+$/
  if (!organizationRegex.test(organization)) {
    throw Error('Invalid organization syntax, must be alphanumeric with dashes')
  }
}

function validate_token_syntax(token: string): void {
  const tokenRegex = /^[a-f0-9]{40}$/
  if (!tokenRegex.test(token)) {
    throw Error('Invalid token syntax, must be 40 characters of [a-f0-9]')
  }
}

function validate_valid_url(name: string, url: string): void {
  try {
    new URL(url)
  } catch (error) {
    throw Error(`Invalid ${name}, must be a valid URL. Value: ${url}`)
  }
}

function validate_positive_number(name: string, value: number) {
  if (isNaN(value) || value < 1) {
    throw Error(`Invalid ${name}, must be a positive number. Value: ${value}`)
  }
}
function calculate_stale_date(days_until_stale: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days_until_stale)
  return date.toISOString().substring(0, 10)
}
