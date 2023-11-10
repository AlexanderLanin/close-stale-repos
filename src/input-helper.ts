import * as core from '@actions/core'
import { IParameters } from './parameters'

require('dotenv').config()

export async function getInputs(): Promise<IParameters> {
  const result = {} as unknown as IParameters

  result.github_server = get('github-server-url', validate_valid_url)
  result.token = get('token', validate_simple_string)
  result.cache_path = get('cache_path', undefined, undefined, '.cache')
  result.cache_ttl_seconds = get(
    'cache_ttl_seconds',
    validate_positive_number,
    undefined,
    3600
  )

  result.stale_date = calculate_stale_date(
    get('days_until_stale', validate_positive_number, undefined, 365)
  )

  let organization = get(
    'organization',
    validate_simple_string,
    ['GITHUB_REPOSITORY_OWNER'],
    ''
  )
  if (organization === '') {
    organization = process.env['GITHUB_REPOSITORY']!.split('/')[0]
    validate_simple_string('organization', organization)
  }
  result.organization = organization

  core.debug(`Inputs: ${JSON.stringify(result)}`)

  return result
}

function get_input(name: string, alternative_names_in_env?: string[]) {
  const value = core.getInput(name)
  if (value === '') {
    const envName = name.toUpperCase().replace(/-/g, '_')
    if (process.env[envName]) {
      return process.env[envName]
    }
    if (alternative_names_in_env) {
      for (const name of alternative_names_in_env) {
        if (process.env[name]) {
          return process.env[name]
        }
      }
    }
    return undefined
  } else {
    return value
  }
}

function get<T>(
  name: string,
  validator?: (name: string, value: string) => T,
  alternative_names_in_env?: string[],
  default_value?: T
): T {
  // From now on value is not empty, but may be undefined.
  // Let's inform the compiler:
  const value = get_input(name, alternative_names_in_env)
  if (!value) {
    if (default_value !== undefined) {
      return default_value
    } else {
      throw Error(
        `Input required and not supplied: ${name} (or env:${alternative_names_in_env}))`
      )
    }
  } else {
    if (validator) {
      return validator(name, value)
    } else {
      return value as T
    }
  }
}

function validate_simple_string(name: string, organization: string): string {
  const organizationRegex = /^[a-zA-Z0-9_-]+$/
  if (!organizationRegex.test(organization)) {
    throw Error('Invalid organization syntax, must be alphanumeric with dashes')
  } else {
    return organization
  }
}

function validate_valid_url(name: string, url: string): string {
  try {
    new URL(url)
    return name
  } catch (error) {
    throw Error(`Invalid ${name}, must be a valid URL. Value: ${url}`)
  }
}

function validate_positive_number(name: string, value: string) {
  const int_value = parseInt(value.toString())
  if (isNaN(int_value) || int_value < 1) {
    throw Error(`Invalid ${name}, must be a positive number. Value: ${value}`)
  } else {
    return int_value
  }
}
function calculate_stale_date(days_until_stale: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days_until_stale)
  return date.toISOString().substring(0, 10)
}
