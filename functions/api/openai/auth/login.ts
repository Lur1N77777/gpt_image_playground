import {
  createSession,
  createUser,
  getUserByUsername,
  jsonResponse,
  normalizeUsername,
  optionsResponse,
  passwordHash,
  toAuthUser,
  validateUsername,
  type PagesContext,
  type UserRow,
} from '../../../_lib/server'

interface LoginRequest {
  username?: unknown
  password?: unknown
}

async function ensureAdminUser(env: PagesContext['env'], password: string): Promise<UserRow | Response> {
  if (!env.ADMIN_PASSWORD) {
    return jsonResponse({ error: 'ADMIN_PASSWORD is not configured.' }, 500)
  }

  if (password !== env.ADMIN_PASSWORD) {
    return jsonResponse({ error: '用户名或密码错误。' }, 401)
  }

  const admin = await getUserByUsername(env, 'admin')
  const nextHash = await passwordHash(env, 'admin', password)

  if (!admin) {
    return createUser(env, 'admin', password, 'admin')
  }

  if (admin.password_hash !== nextHash) {
    await env.IMAGE_DB.prepare('UPDATE users SET password_hash = ?, role = ? WHERE username = ?')
      .bind(nextHash, 'admin', 'admin')
      .run()
    return { ...admin, password_hash: nextHash, role: 'admin' }
  }

  return admin
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context

  if (request.method === 'OPTIONS') return optionsResponse()
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are supported.' }, 405)
  }

  let body: LoginRequest
  try {
    body = await request.json() as LoginRequest
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400)
  }

  const username = normalizeUsername(body.username)
  const password = typeof body.password === 'string' ? body.password : ''
  const usernameError = validateUsername(username)
  if (usernameError) return jsonResponse({ error: usernameError }, 400)
  if (!password) return jsonResponse({ error: '请输入密码。' }, 400)

  let user: UserRow | Response | null
  if (username === 'admin') {
    user = await ensureAdminUser(env, password)
    if (user instanceof Response) return user
  } else {
    user = await getUserByUsername(env, username)
    if (!user) {
      user = await createUser(env, username, password, 'user')
    } else {
      const expectedHash = await passwordHash(env, username, password)
      if (user.password_hash !== expectedHash) {
        return jsonResponse({ error: '用户名或密码错误。' }, 401)
      }
    }
  }

  const session = await createSession(env, user)
  const authUser = await toAuthUser(env, user)
  return jsonResponse({
    user: authUser,
    token: session.token,
    expiresAt: session.expiresAt,
  })
}
