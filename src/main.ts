import * as core from '@actions/core'
import { CachedOctokit } from './cached-octokit'
import assert from 'assert'
import { Cache } from 'file-system-cache'
import { Octokit } from 'octokit'
import { Repository } from '@octokit/graphql-schema'
import { Commit } from '@octokit/graphql-schema'

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
    const ms: string = core.getInput('milliseconds')

    // Note: when this runs as a GitHub Action, the .cache directory will not be persisted.
    // This is to facilitate rapid iterations during development.
    const cache = new Cache({
      basePath: '.cache',
      ns: 'close-stale-repos',
      ttl: 3600 // 1 hour
    })

    const token = core.getInput('token')
    const octokit = new CachedOctokit(cache, { auth: token, log: console })

    const org_admins = await get_repository_admins(
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
      console.log(`Latest release: ${repository.latestRelease?.createdAt}`)
      console.log(`Last Commits:`)
      for (const commit of repository.defaultBranchRef?.target.history.nodes) {
        if (!commit.author.email.includes('noreply.github.com')) {
          console.log(
            `* ${commit.committedDate} - ${commit.author.name} <${commit.author.email}>`
          )
        } else {
          console.log(`* ${commit.committedDate} - ${commit.author.name}`)
        }
      }

      console.log('\n')
      console.log(`Collaborators (assigned directly by name):`)
      for (const collaborator of repository.collaborators.edges) {
        console.log(
          `* ${collaborator.node.name} <${collaborator.node.login}, ${collaborator.node.email}> - ${collaborator.permission}`
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
}

function one_year_ago() {
  var one_year_ago = new Date()
  one_year_ago.setFullYear(one_year_ago.getFullYear() - 1)
  return one_year_ago.toISOString().substring(0, 10)
}

async function get_stale_repos(octokit: CachedOctokit, org: string) {
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
    search_query: search_query,
    limit: 15
  })
  const repositories: Repository[] = graph.search.edges.map(
    (edge: { node: any }) => edge.node
  )

  var stale_repos: StaleRepository[] = []

  // iterate repositories
  for (const repository of repositories) {
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

    var stale_repo: StaleRepository = {
      name: repository.name,
      description: repository.description || '',
      updatedAt: repository.updatedAt,
      pushedAt: repository.pushedAt,
      latestRelease: repository.latestRelease?.createdAt,
      affiliations: []
    }

    for (const commit of (repository.defaultBranchRef?.target as Commit)
      ?.history?.nodes || []) {
      if (commit?.author?.user) {
        stale_repo.affiliations.push({
          login: commit.author.user.login,
          name: commit.author.user.name || '',
          email: commit.author.user.email || '',
          permission: '',
          affiliation: 'recent commiter'
        })
      }

      if (repository.collaborators?.edges) {
        for (const collaborator of repository.collaborators.edges) {
          if (collaborator?.node) {
            stale_repo.affiliations.push({
              login: collaborator.node.login,
              name: collaborator.node.name || '',
              email: collaborator.node.email || '',
              permission: collaborator.permission || '',
              affiliation: 'direct collaborator'
            })
          }
        }
      }
    }

    return stale_repos
  }
}
