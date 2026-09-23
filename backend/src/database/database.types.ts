import { Generated } from 'kysely'

export interface UsersTable {
  id: Generated<number>
  google_subject: string
  email: string
  display_name: string | null
  avatar_url: string | null
  last_login_at: Date
  disabled_at: Date | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface AuthSessionsTable {
  id: Generated<number>
  user_id: number
  token_jti_hash: string
  expires_at: Date
  revoked_at: Date | null
  created_at: Generated<Date>
  last_seen_at: Date | null
}

export interface DevicesTable {
  id: Generated<number>
  created_by_user_id: number
  name: string
  profile_id: string
  slave_id: number
  baud_rate: number
  data_bits: number
  stop_bits: number
  parity: 'none' | 'even' | 'odd'
  enabled: Generated<boolean>
  notes: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface DatabaseSchema {
  users: UsersTable
  auth_sessions: AuthSessionsTable
  devices: DevicesTable
}
