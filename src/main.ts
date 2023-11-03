import * as core from '@actions/core'
import { CachedOctokit } from './cached-octokit'
import assert from 'assert'
import { Cache } from 'file-system-cache'
import { Commit, Repository } from '@octokit/graphql-schema'

type AffiliatedUser = {
  login: string
  name: string
  email: string
  permission: string
  affiliation: string
}

type StaleRepository = {
  name: string
  description: string
  updatedAt: string
  pushedAt: string
  latestRelease: string
  affiliations: AffiliatedUser[]
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Note: when this runs as a GitHub Action, the .cache directory will not be persisted.
    // This is to facilitate rapid iterations during development.
    const cache = new Cache({
      basePath: '.cache',
      ns: 'close-stale-repos',
      ttl: 3600 // 1 hour
    })

    const token = core.getInput('token')
    const octokit = new CachedOctokit(cache, { auth: token, log: console })

    const admins = await get_repository_admins(
      octokit,
      'SoftwareDefinedVehicle'
    )
    console.log(`Admins: ${admins.map(m => m.login).join(', ')}`)

    const stale_repos = await get_stale_repos(octokit, 'SoftwareDefinedVehicle')
    for (const repository of stale_repos) {
      console.log(`# ${repository.name}`)
      console.log(`_${repository.description}_`)
      console.log(``)
      console.log(`Last updated: ${repository.updatedAt}`)
      console.log(`Last pushed: ${repository.pushedAt}`)
      console.log(`Latest release: ${repository.latestRelease}`)

      console.log('\n')
      console.log(`Collaborators:`)
      for (const collaborator of repository.affiliations) {
        console.log(
          `* ${collaborator.login} (${collaborator.name}) <${collaborator.email}>` +
            ` (${collaborator.permission}) via (${collaborator.affiliation})`
        )
      }
      console.log('\n')

      console.log('\n\n')
    }

    octokit.print_cache_stats()

    // Set outputs for other workflow steps to use
    // core.setOutput('time', new Date().toTimeString())
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message)
    else core.setFailed('An unknown error occurred')
  }
  return
}

function one_year_ago(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 1)
  return date.toISOString().substring(0, 10)
}

async function get_repository_admins(
  octokit: CachedOctokit,
  org: string
): Promise<AffiliatedUser[]> {
  const { data: orgMembers } = await octokit.request_cached(
    'GET /orgs/{org}/members',
    {
      org,
      role: 'admin'
    }
  )

  const admins: AffiliatedUser[] = []

  for (const member of orgMembers) {
    const { data: user } = await octokit.request_cached(
      'GET /users/{username}',
      {
        username: member.login
      }
    )

    admins.push({
      login: user.login,
      name: user.name ?? '',
      email: user.email ?? '',
      permission: 'admin',
      affiliation: 'OWNER'
    })
  }

  return admins
}

async function get_stale_repos(
  octokit: CachedOctokit,
  org: string
): Promise<StaleRepository[]> {
  const stale_date = one_year_ago()

  // Sanitize to avoid any kind of injection
  if (!org.match(/^[a-zA-Z0-9-]+$/)) {
    throw new Error(`Invalid org name: ${org}`)
  }

  if (!stale_date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new Error(`Invalid stale date: ${stale_date}`)
  }

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
    limit: 15
  })

  const stale_repos: StaleRepository[] = []
  for (const edge of graph.search.edges) {
    stale_repos.push(extract_stale_repository_data(edge.node))
  }
  return stale_repos
}

function extract_stale_repository_data(
  repository: Repository
): StaleRepository {
  assert.strictEqual(
    repository.isArchived,
    false,
    `Repository ${repository.name} is archived`
  )
  assert.strictEqual(
    repository.isDisabled,
    false,
    `Repository ${repository.name} is disabled`
  )

  const stale_repo: StaleRepository = {
    name: repository.name,
    description: repository.description || '',
    updatedAt: repository.updatedAt,
    pushedAt: repository.pushedAt,
    latestRelease: repository.latestRelease?.createdAt,
    affiliations: []
  }

  for (const commit of (repository.defaultBranchRef?.target as Commit)?.history
    ?.nodes || []) {
    if (commit?.author?.user) {
      stale_repo.affiliations.push({
        login: commit.author.user.login,
        name: commit.author.user.name ?? '',
        email: commit.author.user.email,
        permission: '',
        affiliation: 'recent commiter'
      })
    }
  }

  for (const collaborator of repository.collaborators?.edges || []) {
    if (collaborator) {
      stale_repo.affiliations.push({
        login: collaborator.node.login,
        name: collaborator.node.name ?? '',
        email: collaborator.node.email ?? '',
        permission: collaborator.permission ?? '',
        affiliation: 'collaborator'
      })
    }
  }

  return stale_repo
}
