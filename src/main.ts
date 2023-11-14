import * as core from '@actions/core'
import { CachedOctokit } from './cached-octokit'
import assert from 'assert'
import { Cache } from 'file-system-cache'
import { Commit, Repository } from '@octokit/graphql-schema'
import * as input_helper from './input-helper'
import { IParameters } from './parameters'
import { maxHeaderSize } from 'http'
import * as data from './data-types'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const parameters = input_helper.parseInputs(input_helper.getInputs())
    const octokit = await create_octokit(parameters)

    const admins = await get_organization_admins(
      octokit,
      parameters.organization
    )
    console.log(`Admins: ${admins.map(m => m.login).join(', ')}`)

    const stale_repos = await get_stale_repos(
      octokit,
      parameters.organization,
      parameters.stale_date
    )
    console.log('| Repository | Description | Last updated | Collaborators |')
    console.log('| ---------- | ----------- | ------------ | ------------- |')
    await print_stale_repos_table(stale_repos)

    octokit.print_cache_stats()
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed('Error: ' + error.message)
      if ('status' in error) {
        console.log('Status: ' + error.status)
      }
      console.log(error.stack)
    } else {
      core.setFailed('Error: ' + (error as string))
    }
  }
  return
}

run()

async function create_octokit(parameters: IParameters): Promise<CachedOctokit> {
  // Note: when this runs as a GitHub Action, the cache directory will not be persisted.
  // This is to facilitate rapid iterations during development.
  const cache = new Cache({
    basePath: parameters.cache_path,
    ns: 'close-stale-repos',
    ttl: parameters.cache_ttl_seconds
  })

  const octokit = new CachedOctokit(cache, {
    auth: parameters.token,
    log: console
  })

  console.debug('Authenticating...')
  await octokit.auth()
  console.debug('Authenticated.')

  return octokit
}

async function print_stale_repos_list(stale_repos: data.StaleRepository[]) {
  for (const repository of stale_repos) {
    console.log(`# ${repository.name}`)
    console.log(`_${repository.description}_`)
    console.log(``)
    console.log(`Last updated: ${repository.updatedAt}`)

    console.log('\n')
    console.log(`Collaborators:`)
    for (const collaborator of repository.affiliations) {
      const full_name =
        collaborator.login && collaborator.name
          ? `${collaborator.name} (@${collaborator.login})`
          : collaborator.login
          ? collaborator.login
          : collaborator.name

      const opt_email = collaborator.email ? ` <${collaborator.email}>` : ''

      console.log(`* ${full_name} ${opt_email} (${collaborator.affiliation})`)
    }
    console.log('\n')

    console.log('\n\n')
  }
}

async function print_stale_repos_table(stale_repos: data.StaleRepository[]) {
  for (const repository of stale_repos) {
    const last_updated = repository.updatedAt?.substring(0, 10)
    let str = `| ${repository.name} | ${repository.description} | ${last_updated} | `

    for (const collaborator of repository.affiliations) {
      const full_name =
        collaborator.login && collaborator.name
          ? `${collaborator.name} (@${collaborator.login})`
          : collaborator.login
          ? collaborator.login
          : collaborator.name

      const opt_email = collaborator.email ? ` <${collaborator.email}>` : ''

      str += `* ${full_name} ${opt_email} (${collaborator.affiliation})<br />`
    }
    console.log(str + ' |')
  }
}

async function get_organization_admins(
  octokit: CachedOctokit,
  org: string
): Promise<data.AffiliatedUser[]> {
  const { data: orgMembers } = await octokit.request_cached(
    `GET /orgs/${org}/members`,
    {
      role: 'admin'
    }
  )

  const admins: data.AffiliatedUser[] = []

  // Get the user details for each member
  console.log("Getting admins' details...")
  if (orgMembers.length > 10)
    console.log(`${orgMembers.length} admins. This may take a while...`)

  for (const member of orgMembers) {
    const { data: user } = await octokit.request_cached(
      `GET /users/${member.login}`
    )

    admins.push({
      login: user.login,
      name: user.name ?? '',
      email: user.email ?? '',
      affiliation: 'organization admin'
    })
  }

  return admins
}

async function get_stale_repos(
  octokit: CachedOctokit,
  org: string,
  stale_date: string
): Promise<data.StaleRepository[]> {
  const search_query = `org:${org} pushed:<${stale_date}`

  const graphql_query = `
  query stale_repos($search_query: String!, $limit: Int!) {
    search(
      query: $search_query
      type: REPOSITORY
      first: $limit
    ) {
      edges {
        node {
          ... on Repository {
            name
            description
            updatedAt
            pushedAt
            latestRelease {
              createdAt
            }
            isArchived
            isDisabled
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 15) {
                    nodes {
                      ... on Commit {
                        committedDate
                        author {
                          name
                          email
                        }
                      }
                    }
                  }
                }
              }
            }
            collaborators(affiliation: DIRECT) {
              edges {
                permissionSources {
                  roleName
                }
                permission
                node {
                  login
                  name
                  email
                }
              }
            }
          }
        }
      }
    }
  }
  `
  const graph = await octokit.graphql_cached(graphql_query, {
    search_query,
    limit: 50
  })

  const stale_repos: data.StaleRepository[] = []
  for (const edge of graph.search.edges) {
    const data = extract_stale_repository_data(edge.node)
    if (data) stale_repos.push(data)
  }
  return stale_repos
}

function getLexicographicallyLargestString(
  a: string | undefined,
  b: string | undefined,
  c: string | undefined
): string | undefined {
  let largest = a

  if (b !== undefined && (largest === undefined || b > largest)) {
    largest = b
  }
  if (c !== undefined && (largest === undefined || c > largest)) {
    largest = c
  }

  return largest
}

function extract_stale_repository_data(
  repository: Repository
): data.StaleRepository | undefined {
  if (repository.isArchived) return undefined

  assert.strictEqual(
    repository.isDisabled,
    false,
    `Repository ${repository.name} is disabled`
  )

  const stale_repo: data.StaleRepository = {
    name: repository.name,
    description: repository.description || '',
    updatedAt: getLexicographicallyLargestString(
      repository.latestRelease?.createdAt,
      repository.updatedAt,
      repository.pushedAt
    ),
    affiliations: []
  }

  for (const commit of (repository.defaultBranchRef?.target as Commit)?.history
    ?.nodes || []) {
    if (commit?.author) {
      data.add_unique_user(stale_repo.affiliations, {
        login: commit.author.user?.login ?? '',
        name: commit.author.user?.name ?? commit.author.name ?? '',
        email: commit.author.user?.email ?? commit.author.email ?? '',
        affiliation: 'recent commiter'
      })
    }
  }

  for (const collaborator of repository.collaborators?.edges || []) {
    if (collaborator) {
      data.add_unique_user(stale_repo.affiliations, {
        login: collaborator.node.login,
        name: collaborator.node.name ?? '',
        email: collaborator.node.email ?? '',
        affiliation: 'collaborator'
      })
    }
  }

  return stale_repo
}
