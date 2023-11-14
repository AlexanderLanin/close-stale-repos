export type AffiliatedUser = {
  login: string
  name: string
  email: string
  affiliation: string
}

export type StaleRepository = {
  name: string
  description: string
  updatedAt?: string
  affiliations: AffiliatedUser[]
}

function merge_single_entry(a: string, b: string) {
  if (a == b || (a && !b)) {
    return a
  } else if (b && !a) {
    return b
  } else {
    return `${a}, ${b}`
  }
}

export function merge_user_infos(in_out: AffiliatedUser, in_: AffiliatedUser) {
  in_out.login = merge_single_entry(in_out.login, in_.login)
  in_out.name = merge_single_entry(in_out.name, in_.name)
  in_out.email = merge_single_entry(in_out.email, in_.email)

  // ToDo: handle multiple affiliations without duplicating the string
  in_out.affiliation = merge_single_entry(in_out.affiliation, in_.affiliation)
}

export function add_unique_user(users: AffiliatedUser[], user: AffiliatedUser) {
  if (!user.login) {
    // if email contains users.noreply.github.com, extract the username
    // The syntax is: <noise>+<github_username>@users.noreply.github.com
    const match = user.email.match(/(.*)\+([^@]*)@users.noreply.github.com/)
    if (match) {
      user.login = match[2]
      user.email = '' // remove the fake email
    }
  }

  // remove useless noise from the name
  if (user.name == user.login) {
    user.name = ''
  }

  const match = users.find(
    u =>
      (user.login && u.login === user.login) ||
      (user.email &&
        user.name &&
        u.email === user.email &&
        u.name === user.name)
  )
  if (match) {
    merge_user_infos(match, user)
  } else {
    users.push(user)
  }
}
