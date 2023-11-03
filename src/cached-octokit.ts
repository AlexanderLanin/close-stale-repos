import { Cache } from 'file-system-cache'
import { Octokit } from 'octokit'
import type { RequestParameters } from '@octokit/types'
import type { OctokitOptions } from '@octokit/core/dist-types/types'

export class CachedOctokit extends Octokit {
  cache: Cache
  extra_cache_keys: string
  hits: number
  misses: number

  constructor(cache: Cache, octokit_options: OctokitOptions) {
    super(octokit_options)
    this.cache = cache
    this.extra_cache_keys = JSON.stringify(octokit_options || [])

    this.hits = 0
    this.misses = 0
  }

  async graphql_cached(
    query: string,
    parameters: RequestParameters | undefined,
    retention_in_seconds = 3600
  ): Promise<any> {
    const cache_key = JSON.stringify({
      query,
      parameters,
      extra_cache_keys: this.extra_cache_keys
    })

    const cached_data = await this.cache.get(cache_key)
    if (cached_data) {
      this.hits += 1

      return cached_data
    } else {
      this.misses += 1

      // we need to await the result to ensure that the cache is populated
      const live_data = await super.graphql(query, parameters)
      this.cache.set(cache_key, live_data, retention_in_seconds)
      return live_data
    }
  }

  async request_cached(
    route: string,
    options: RequestParameters | undefined,
    retention_in_seconds = 3600
  ): Promise<any> {
    const cache_key = JSON.stringify({
      route,
      options,
      extra_cache_keys: this.extra_cache_keys
    })

    const cached_data = await this.cache.get(cache_key)
    if (cached_data) {
      this.hits += 1
      console.debug(`cache hit: ${route} ${JSON.stringify(options)}`)
      return cached_data
    } else {
      this.misses += 1

      // we need to await the result to ensure that the cache is populated
      const live_data = await super.request(route, options)
      await this.cache.set(cache_key, live_data, retention_in_seconds)
      return live_data
    }
  }

  print_cache_stats(): void {
    console.log()
    console.log('cache stats:')
    console.log('  hits:', this.hits)
    console.log('  misses:', this.misses)
    console.log(
      '  hit rate:',
      (this.hits / (this.hits + this.misses)) * 100,
      '%'
    )
  }
}
