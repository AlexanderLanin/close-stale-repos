export interface IParameters {
  github_server: URL
  organization: string
  token: string

  stale_date: string

  cache_path: string
  cache_ttl_seconds: number
}
