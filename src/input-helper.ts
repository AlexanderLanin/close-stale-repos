import * as core from '@actions/core'
import { IParameters } from './parameters'

require('dotenv').config()

export function parseInputs(inputs: IRawParameters): IParameters {
  const result = {} as unknown as IParameters

  result.github_server = parse_url(inputs.github_server)
  result.organization = parse_simple_string(inputs.organization)
  result.token = parse_simple_string(inputs.token)

  result.stale_date = calculate_stale_date(
    parse_positive_number(inputs.days_until_stale)
  )
  result.cache_path = inputs.cache_path[1]
  result.cache_ttl_seconds = parse_positive_number(inputs.cache_ttl_seconds)

  for (const [key, value] of Object.entries(result)) {
    core.debug(`Parsed Input: ${key} = ${value}`)
  }

  return result
}

type KeyValuePair = [key: string, value: string]

export interface IRawParameters {
  github_server: KeyValuePair
  organization: KeyValuePair
  token: KeyValuePair

  days_until_stale: KeyValuePair

  cache_path: KeyValuePair
  cache_ttl_seconds: KeyValuePair
}

export function getInputs(): IRawParameters {
  const result = {} as unknown as IRawParameters

  result.github_server = get('github-server-url')
  result.organization = get('organization', '', 'GITHUB_REPOSITORY_OWNER')
  if (!result.organization[1])
    result.organization[1] = process.env['GITHUB_REPOSITORY']!.split('/')[0]

  result.token = get('token')

  result.days_until_stale = get('days_until_stale', '365')!

  result.cache_path = get('cache_path', '.cache')
  result.cache_ttl_seconds = get('cache_ttl_seconds', '3600')

  for (const [key, value] of Object.entries(result)) {
    core.debug(`Raw Input: ${value[0]} = ${value[1]}`)
  }

  return result
}

function get(
  name: string,
  default_value?: string,
  alternative_name_in_env?: string
): KeyValuePair {
  const name_in_env = name.toUpperCase().replace(/-/g, '_')
  const readable_name = alternative_name_in_env
    ? `${name} (${name_in_env} or ${alternative_name_in_env})`
    : `${name} (${name_in_env})`

  // try to get the value from the input
  const value = core.getInput(name)
  if (value !== '') return [readable_name, value]

  // Fall back to env vars

  if (process.env[name_in_env])
    return [readable_name, process.env[name_in_env]!]

  // Fall back to alternative env vars
  if (alternative_name_in_env && process.env[alternative_name_in_env])
    return [readable_name, process.env[alternative_name_in_env]!]

  // No value found. If a default value was provided, return that.
  if (default_value !== undefined) return [readable_name, default_value]

  throw Error(`Missing required input: ${name}`)
}

/// "simple" means that the string must be alphanumeric with dashes
function parse_simple_string(p: KeyValuePair): string {
  const [name, value] = p

  const organizationRegex = /^[a-zA-Z0-9_-]+$/
  if (!organizationRegex.test(value)) {
    throw Error(
      `Invalid value for ${name}, must be alphanumeric with dashes. Value: ${value}`
    )
  } else {
    return value
  }
}

function parse_url(p: KeyValuePair) {
  const [name, value] = p

  try {
    return new URL(value)
  } catch (error) {
    throw Error(`Invalid ${name}, must be a valid URL. But it is: ${value}`)
  }
}

function parse_positive_number(p: KeyValuePair) {
  const [name, value] = p
  const int_value = parseInt(value)
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
