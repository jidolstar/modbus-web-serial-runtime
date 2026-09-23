export interface GoogleIdentity {
  readonly subject: string
  readonly email: string
  readonly displayName: string | null
  readonly avatarUrl: string | null
}

export interface AuthenticatedUser {
  readonly id: number
  readonly email: string
  readonly displayName: string | null
  readonly avatarUrl: string | null
  readonly sessionJtiHash: string
}

export interface PublicUser {
  readonly id: number
  readonly email: string
  readonly displayName: string | null
  readonly avatarUrl: string | null
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser
  }
}
