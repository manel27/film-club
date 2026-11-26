export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: NonNullable<Json>
        }
        ComputedFields: never
        Insert: {
          key: string
          updated_at?: string
          value: NonNullable<Json>
        }
        Update: {
          key?: string
          updated_at?: string
          value?: NonNullable<Json>
        }
        Relationships: []
      }
      attendance: {
        Row: {
          film_id: number
          marked_at: string
          marked_by: string | null
          profile_id: string
        }
        ComputedFields: never
        Insert: {
          film_id: number
          marked_at?: string
          marked_by?: string | null
          profile_id: string
        }
        Update: {
          film_id?: number
          marked_at?: string
          marked_by?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'attendance_film_id_fkey'
            columns: ['film_id']
            isOneToOne: false
            referencedRelation: 'film_stats'
            referencedColumns: ['film_id']
          },
          {
            foreignKeyName: 'attendance_film_id_fkey'
            columns: ['film_id']
            isOneToOne: false
            referencedRelation: 'films'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_marked_by_fkey'
            columns: ['marked_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_marked_by_fkey'
            columns: ['marked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'attendance_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          film_id: number
          id: number
          is_legacy: boolean
        }
        ComputedFields: never
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          film_id: number
          id?: never
          is_legacy?: boolean
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          film_id?: number
          id?: never
          is_legacy?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_film_id_fkey'
            columns: ['film_id']
            isOneToOne: false
            referencedRelation: 'film_stats'
            referencedColumns: ['film_id']
          },
          {
            foreignKeyName: 'comments_film_id_fkey'
            columns: ['film_id']
            isOneToOne: false
            referencedRelation: 'films'
            referencedColumns: ['id']
          },
        ]
      }
      films: {
        Row: {
          assigned_id: string
          backdrop_path: string | null
          created_at: string
          created_by: string | null
          day_order: number
          democratico_reason: string | null
          directors: string[]
          genres: string[]
          id: number
          is_easter_egg: boolean
          kind: Database['public']['Enums']['film_kind']
          legacy_sheet_row: number | null
          original_title: string | null
          original_title_norm: string | null
          overview: string | null
          poster_path: string | null
          release_date: string | null
          release_year: number | null
          runtime_min: number | null
          scores_locked: boolean
          screened_on: string
          source_url: string | null
          title: string
          title_norm: string | null
          tmdb_fetched_at: string | null
          tmdb_id: number | null
          turn_holder_id: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          assigned_id: string
          backdrop_path?: string | null
          created_at?: string
          created_by?: string | null
          day_order?: number
          democratico_reason?: string | null
          directors?: string[]
          genres?: string[]
          id?: never
          is_easter_egg?: boolean
          kind?: Database['public']['Enums']['film_kind']
          legacy_sheet_row?: number | null
          original_title?: string | null
          original_title_norm?: never
          overview?: string | null
          poster_path?: string | null
          release_date?: string | null
          release_year?: number | null
          runtime_min?: number | null
          scores_locked?: boolean
          screened_on: string
          source_url?: string | null
          title: string
          title_norm?: never
          tmdb_fetched_at?: string | null
          tmdb_id?: number | null
          turn_holder_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_id?: string
          backdrop_path?: string | null
          created_at?: string
          created_by?: string | null
          day_order?: number
          democratico_reason?: string | null
          directors?: string[]
          genres?: string[]
          id?: never
          is_easter_egg?: boolean
          kind?: Database['public']['Enums']['film_kind']
          legacy_sheet_row?: number | null
          original_title?: string | null
          original_title_norm?: never
          overview?: string | null
          poster_path?: string | null
          release_date?: string | null
          release_year?: number | null
          runtime_min?: number | null
          scores_locked?: boolean
          screened_on?: string
          source_url?: string | null
          title?: string
          title_norm?: never
          tmdb_fetched_at?: string | null
          tmdb_id?: number | null
          turn_holder_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'films_assigned_id_fkey'
            columns: ['assigned_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'films_assigned_id_fkey'
            columns: ['assigned_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'films_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'films_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'films_turn_holder_id_fkey'
            columns: ['turn_holder_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'films_turn_holder_id_fkey'
            columns: ['turn_holder_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          kind: string
          profile_id: string
          revoked_at: string | null
          token_hash: string
          used_at: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          kind?: string
          profile_id: string
          revoked_at?: string | null
          token_hash: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          kind?: string
          profile_id?: string
          revoked_at?: string | null
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invites_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invites_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          claimed_at: string | null
          colour: string | null
          created_at: string
          display_name: string
          id: string
          is_claimed: boolean | null
          is_system: boolean
          login_removed_at: string | null
          role: Database['public']['Enums']['profile_role']
          sheet_keyword: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          auth_user_id?: string | null
          claimed_at?: string | null
          colour?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_claimed?: never
          is_system?: boolean
          login_removed_at?: string | null
          role?: Database['public']['Enums']['profile_role']
          sheet_keyword?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          claimed_at?: string | null
          colour?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_claimed?: never
          is_system?: boolean
          login_removed_at?: string | null
          role?: Database['public']['Enums']['profile_role']
          sheet_keyword?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          subject: string
          window_start: string
        }
        ComputedFields: never
        Insert: {
          bucket: string
          count?: number
          subject: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          subject?: string
          window_start?: string
        }
        Relationships: []
      }
      rotation_adjustments: {
        Row: {
          clear_owed_turn: boolean
          created_at: string
          created_by: string | null
          delta: number | null
          effective_at: string
          id: number
          profile_id: string
          reason: string | null
          set_to: number | null
        }
        ComputedFields: never
        Insert: {
          clear_owed_turn?: boolean
          created_at?: string
          created_by?: string | null
          delta?: number | null
          effective_at?: string
          id?: never
          profile_id: string
          reason?: string | null
          set_to?: number | null
        }
        Update: {
          clear_owed_turn?: boolean
          created_at?: string
          created_by?: string | null
          delta?: number | null
          effective_at?: string
          id?: never
          profile_id?: string
          reason?: string | null
          set_to?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'rotation_adjustments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_adjustments_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_adjustments_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_adjustments_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rotation_next: {
        Row: {
          created_at: string
          decided_by: string | null
          profile_id: string
          updated_at: string
          week_start: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          decided_by?: string | null
          profile_id: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          decided_by?: string | null
          profile_id?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rotation_next_decided_by_fkey'
            columns: ['decided_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_next_decided_by_fkey'
            columns: ['decided_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_next_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_next_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rotation_passes: {
        Row: {
          created_at: string
          created_by: string | null
          profile_id: string
          week_start: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          profile_id: string
          week_start: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          profile_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rotation_passes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_passes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_passes_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rotation_passes_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      scores: {
        Row: {
          created_at: string
          entered_by: string | null
          film_id: number
          profile_id: string
          score: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          entered_by?: string | null
          film_id: number
          profile_id: string
          score: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          entered_by?: string | null
          film_id?: number
          profile_id?: string
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'scores_entered_by_fkey'
            columns: ['entered_by']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scores_entered_by_fkey'
            columns: ['entered_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scores_film_id_fkey'
            columns: ['film_id']
            isOneToOne: false
            referencedRelation: 'film_stats'
            referencedColumns: ['film_id']
          },
          {
            foreignKeyName: 'scores_film_id_fkey'
            columns: ['film_id']
            isOneToOne: false
            referencedRelation: 'films'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scores_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scores_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_settings: {
        Row: {
          films_view: string | null
          profile_id: string
          theme: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          films_view?: string | null
          profile_id: string
          theme?: string | null
          updated_at?: string
        }
        Update: {
          films_view?: string | null
          profile_id?: string
          theme?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_settings_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profile_directory'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_settings_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      film_stats: {
        Row: {
          avg_score: number | null
          film_id: number
          is_easter_egg: boolean
          present_count: number | null
          score_count: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      profile_directory: {
        Row: {
          claimed_at: string | null
          colour: string | null
          created_at: string
          display_name: string
          id: string
          is_claimed: boolean | null
          is_system: boolean
          login_removed_at: string | null
          role: Database['public']['Enums']['profile_role']
          sheet_keyword: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          claimed_at?: string | null
          colour?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_claimed?: boolean | null
          is_system?: boolean | null
          login_removed_at?: string | null
          role?: Database['public']['Enums']['profile_role'] | null
          sheet_keyword?: string | null
          updated_at?: string | null
        }
        Update: {
          claimed_at?: string | null
          colour?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_claimed?: boolean | null
          is_system?: boolean | null
          login_removed_at?: string | null
          role?: Database['public']['Enums']['profile_role'] | null
          sheet_keyword?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      rotation_standings: {
        Row: {
          owed_rank: number | null
          owed_since: string | null
          points: number | null
          profile_id: string | null
          week_start: string | null
        }
        ComputedFields: never
        Relationships: []
      }
    }
    Functions: {
      export_data: { Args: Record<PropertyKey, never>; Returns: Json }
      film_duplicate_check: {
        Args: {
          p_original_title?: string
          p_release_year?: number
          p_title: string
          p_tmdb_id?: number
        }
        Returns: {
          id: number
          kind: Database['public']['Enums']['film_kind']
          release_year: number
          screened_on: string
          title: string
          tmdb_id: number
        }[]
      }
      invite_issue: {
        Args: { p_created_by: string; p_kind: string; p_profile_id: string; p_token_hash: string }
        Returns: string
      }
      invite_peek: {
        Args: { p_kind: string; p_token_hash: string }
        Returns: {
          colour: string
          display_name: string
          watched: number
        }[]
      }
      invite_rate_fail: { Args: { p_ip: string; p_token?: string }; Returns: undefined }
      invite_rate_ok: { Args: { p_ip: string; p_token?: string }; Returns: boolean }
      invite_redeem: {
        Args: { p_auth_user_id?: string; p_kind: string; p_token_hash: string }
        Returns: {
          auth_user_id: string
          invite_id: string
        }[]
      }
      keepalive: { Args: Record<PropertyKey, never>; Returns: boolean }
      my_profile: {
        Args: Record<PropertyKey, never>
        Returns: {
          claimed_at: string | null
          colour: string | null
          created_at: string
          display_name: string
          id: string
          is_claimed: boolean | null
          is_system: boolean
          login_removed_at: string | null
          role: Database['public']['Enums']['profile_role']
          sheet_keyword: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'profile_directory'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      profile_remove_login: { Args: { p_admin_id: string; p_profile_id: string }; Returns: string }
      tmdb_search_hit: { Args: Record<PropertyKey, never>; Returns: boolean }
    }
    Enums: {
      film_kind: 'normal' | 'democratico' | 'cinema' | 'maratona'
      profile_role: 'admin' | 'moderator' | 'member' | 'viewer'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      film_kind: ['normal', 'democratico', 'cinema', 'maratona'],
      profile_role: ['admin', 'moderator', 'member', 'viewer'],
    },
  },
} as const
