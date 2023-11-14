import { AffiliatedUser, add_unique_user } from '../src/data-types'

const user1: AffiliatedUser = {
  login: 'octocat',
  email: 'octocat@github.com',
  name: 'The Octocat',
  permission: 'All-Knowing',
  affiliation: 'owns everything'
}

const user2: AffiliatedUser = {
  login: 'monalisa',
  email: 'mona@github.com',
  name: 'Mona Lisa',
  permission: 'Read-Only',
  affiliation: 'Liked by everyone'
}

const user3: AffiliatedUser = {
  login: 'hubot',
  email: 'hubot@github.com',
  name: 'Hubot',
  permission: 'Write-Only',
  affiliation: 'Bot'
}

describe('add_unique_user', () => {
  console.log('User1.email: ', user1.email)

  it('adding a new user to an empty array yields an array with one user', () => {
    const users: AffiliatedUser[] = []
    add_unique_user(users, user1)
    expect(users).toEqual([user1])
  })

  it('adding a new user to an array with one user yields an array with two users', () => {
    const users: AffiliatedUser[] = [{ ...user1 }]
    add_unique_user(users, user2)
    expect(users).toEqual([user1, user2])
  })

  it('adding the same user to an array with one user yields an array with one user', () => {
    const users: AffiliatedUser[] = [{ ...user1 }]
    add_unique_user(users, user1)
    expect(users).toEqual([user1])
  })

  it('adding a user without login to an array with one user with login yields an array with one user with login', () => {
    const users: AffiliatedUser[] = [{ ...user1 }]
    const user1_copy = { ...user1 }
    user1_copy.login = ''
    add_unique_user(users, user1_copy)
    expect(users).toEqual([user1])
  })

  it('adding a user with login to an array with one user without login yields an array with one user with login', () => {
    const user1_copy = { ...user1 }
    user1_copy.login = ''
    const users: AffiliatedUser[] = [user1_copy]
    add_unique_user(users, user1)
    expect(users).toEqual([user1])
  })

  it('adding the same user with a different email to an array with one user yields an array with one user with both emails', () => {
    const users: AffiliatedUser[] = [{ ...user1 }]
    const user1_copy = { ...user1 }
    user1_copy.email = 'second@mail.com' // different email

    add_unique_user(users, user1_copy)

    const expected_user: AffiliatedUser = { ...user1 }
    expected_user.email = `${user1.email}, ${user1_copy.email}`
    expect(users).toEqual([expected_user])
  })
})
