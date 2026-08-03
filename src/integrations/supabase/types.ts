export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      characters: {
        Row: {
          biography: string | null
          brand_hashtags: string[]
          consistency: Json
          created_at: string
          created_by: string | null
          description: string | null
          generation_defaults: Json
          id: string
          memory: Json
          name: string
          persona: Json
          personality_traits: string[]
          reference_image_url: string | null
          reference_images: string[]
          updated_at: string
        }
        Insert: {
          biography?: string | null
          brand_hashtags?: string[]
          consistency?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          generation_defaults?: Json
          id?: string
          memory?: Json
          name: string
          persona?: Json
          personality_traits?: string[]
          reference_image_url?: string | null
          reference_images?: string[]
          updated_at?: string
        }
        Update: {
          biography?: string | null
          brand_hashtags?: string[]
          consistency?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          generation_defaults?: Json
          id?: string
          memory?: Json
          name?: string
          persona?: Json
          personality_traits?: string[]
          reference_image_url?: string | null
          reference_images?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      connected_accounts: {
        Row: {
          access_token: string | null
          account_name: string
          connection_status: Database["public"]["Enums"]["connection_status"]
          created_at: string
          created_by: string | null
          external_account_id: string
          id: string
          last_sync_at: string | null
          platform: Database["public"]["Enums"]["publishing_platform"]
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          account_name: string
          connection_status?: Database["public"]["Enums"]["connection_status"]
          created_at?: string
          created_by?: string | null
          external_account_id: string
          id?: string
          last_sync_at?: string | null
          platform: Database["public"]["Enums"]["publishing_platform"]
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          account_name?: string
          connection_status?: Database["public"]["Enums"]["connection_status"]
          created_at?: string
          created_by?: string | null
          external_account_id?: string
          id?: string
          last_sync_at?: string | null
          platform?: Database["public"]["Enums"]["publishing_platform"]
          updated_at?: string
        }
        Relationships: []
      }
      generation_jobs: {
        Row: {
          character_id: string | null
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          input_payload: Json
          output_url: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at: string
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          input_payload?: Json
          output_url?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at?: string
        }
        Update: {
          character_id?: string | null
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          input_payload?: Json
          output_url?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type?: Database["public"]["Enums"]["job_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          character_id: string | null
          connected_account_id: string | null
          created_at: string
          created_by: string | null
          external_post_id: string | null
          id: string
          image_url: string
          prompt: string | null
          publish_status: Database["public"]["Enums"]["publish_status"]
          published_at: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          character_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_post_id?: string | null
          id?: string
          image_url: string
          prompt?: string | null
          publish_status?: Database["public"]["Enums"]["publish_status"]
          published_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          character_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_post_id?: string | null
          id?: string
          image_url?: string
          prompt?: string | null
          publish_status?: Database["public"]["Enums"]["publish_status"]
          published_at?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "images_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_connected_account_id_fkey"
            columns: ["connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      intensity_presets: {
        Row: {
          caption_style: string | null
          character_id: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          key: string
          label: string
          negative_prompt: string | null
          prompt_style: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          caption_style?: string | null
          character_id: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key: string
          label: string
          negative_prompt?: string | null
          prompt_style?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          caption_style?: string | null
          character_id?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          key?: string
          label?: string
          negative_prompt?: string | null
          prompt_style?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intensity_presets_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          created_at: string
          failed_upload_browser: boolean
          failed_upload_email: boolean
          failed_upload_in_app: boolean
          generation_browser: boolean
          generation_email: boolean
          generation_in_app: boolean
          publishing_browser: boolean
          publishing_email: boolean
          publishing_in_app: boolean
          system_alerts_browser: boolean
          system_alerts_email: boolean
          system_alerts_in_app: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          failed_upload_browser?: boolean
          failed_upload_email?: boolean
          failed_upload_in_app?: boolean
          generation_browser?: boolean
          generation_email?: boolean
          generation_in_app?: boolean
          publishing_browser?: boolean
          publishing_email?: boolean
          publishing_in_app?: boolean
          system_alerts_browser?: boolean
          system_alerts_email?: boolean
          system_alerts_in_app?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          failed_upload_browser?: boolean
          failed_upload_email?: boolean
          failed_upload_in_app?: boolean
          generation_browser?: boolean
          generation_email?: boolean
          generation_in_app?: boolean
          publishing_browser?: boolean
          publishing_email?: boolean
          publishing_in_app?: boolean
          system_alerts_browser?: boolean
          system_alerts_email?: boolean
          system_alerts_in_app?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_templates: {
        Row: {
          caption_direction: string | null
          category: string | null
          character_id: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          intensity: string | null
          name: string
          prompt: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          caption_direction?: string | null
          category?: string | null
          character_id: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          intensity?: string | null
          name: string
          prompt?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          caption_direction?: string | null
          category?: string | null
          character_id?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          intensity?: string | null
          name?: string
          prompt?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_templates_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_defaults: {
        Row: {
          auto_publish: boolean
          created_at: string
          default_category: string
          default_price: number
          default_visibility: string
          updated_at: string
          user_id: string
          watermark_enabled: boolean
        }
        Insert: {
          auto_publish?: boolean
          created_at?: string
          default_category?: string
          default_price?: number
          default_visibility?: string
          updated_at?: string
          user_id: string
          watermark_enabled?: boolean
        }
        Update: {
          auto_publish?: boolean
          created_at?: string
          default_category?: string
          default_price?: number
          default_visibility?: string
          updated_at?: string
          user_id?: string
          watermark_enabled?: boolean
        }
        Relationships: []
      }
      review_queue: {
        Row: {
          content_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
        }
        Insert: {
          content_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Update: {
          content_id?: string
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
        }
        Relationships: []
      }
      scene_templates: {
        Row: {
          category: string
          character_id: string
          created_at: string
          description: string | null
          enabled: boolean
          id: string
          intensity: string
          label: string
          prompt: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category: string
          character_id: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          intensity?: string
          label: string
          prompt?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          character_id?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          id?: string
          intensity?: string
          label?: string
          prompt?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_templates_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          content_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          created_by: string | null
          id: string
          platform: string
          publish_time: string
          status: Database["public"]["Enums"]["schedule_status"]
          updated_at: string
        }
        Insert: {
          content_id: string
          content_type: Database["public"]["Enums"]["content_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          platform?: string
          publish_time: string
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
        }
        Update: {
          content_id?: string
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          platform?: string
          publish_time?: string
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
        }
        Relationships: []
      }
      sync_settings: {
        Row: {
          auto_sync: boolean
          created_at: string
          retry_uploads: boolean
          sync_interval_minutes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sync?: boolean
          created_at?: string
          retry_uploads?: boolean
          sync_interval_minutes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sync?: boolean
          created_at?: string
          retry_uploads?: boolean
          sync_interval_minutes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings_general: {
        Row: {
          auto_publish: boolean
          compact_mode: boolean
          created_at: string
          default_fps: number
          default_scenes: number
          default_steps: number
          landing_page: string
          manual_approval: boolean
          retain_rejected: boolean
          retry_failed: boolean
          store_history: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_publish?: boolean
          compact_mode?: boolean
          created_at?: string
          default_fps?: number
          default_scenes?: number
          default_steps?: number
          landing_page?: string
          manual_approval?: boolean
          retain_rejected?: boolean
          retry_failed?: boolean
          store_history?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_publish?: boolean
          compact_mode?: boolean
          created_at?: string
          default_fps?: number
          default_scenes?: number
          default_steps?: number
          landing_page?: string
          manual_approval?: boolean
          retain_rejected?: boolean
          retry_failed?: boolean
          store_history?: boolean
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      videos: {
        Row: {
          character_id: string | null
          connected_account_id: string | null
          created_at: string
          created_by: string | null
          external_post_id: string | null
          id: string
          prompt: string | null
          publish_status: Database["public"]["Enums"]["publish_status"]
          published_at: string | null
          scene_prompts: Json
          status: Database["public"]["Enums"]["content_status"]
          updated_at: string
          video_url: string
        }
        Insert: {
          character_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_post_id?: string | null
          id?: string
          prompt?: string | null
          publish_status?: Database["public"]["Enums"]["publish_status"]
          published_at?: string | null
          scene_prompts?: Json
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
          video_url: string
        }
        Update: {
          character_id?: string | null
          connected_account_id?: string | null
          created_at?: string
          created_by?: string | null
          external_post_id?: string | null
          id?: string
          prompt?: string | null
          publish_status?: Database["public"]["Enums"]["publish_status"]
          published_at?: string | null
          scene_prompts?: Json
          status?: Database["public"]["Enums"]["content_status"]
          updated_at?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "videos_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "videos_connected_account_id_fkey"
            columns: ["connected_account_id"]
            isOneToOne: false
            referencedRelation: "connected_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      connection_status: "connected" | "disconnected" | "error" | "pending"
      content_status:
        | "pending"
        | "approved"
        | "rejected"
        | "draft"
        | "pending_review"
        | "scheduled"
        | "published"
        | "failed"
      content_type: "image" | "video"
      job_status: "queued" | "processing" | "completed" | "failed"
      job_type: "image" | "video"
      publish_status:
        | "draft"
        | "pending_review"
        | "approved"
        | "scheduled"
        | "published"
        | "failed"
      publishing_platform: "fanvue"
      schedule_status: "scheduled" | "published" | "failed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      connection_status: ["connected", "disconnected", "error", "pending"],
      content_status: [
        "pending",
        "approved",
        "rejected",
        "draft",
        "pending_review",
        "scheduled",
        "published",
        "failed",
      ],
      content_type: ["image", "video"],
      job_status: ["queued", "processing", "completed", "failed"],
      job_type: ["image", "video"],
      publish_status: [
        "draft",
        "pending_review",
        "approved",
        "scheduled",
        "published",
        "failed",
      ],
      publishing_platform: ["fanvue"],
      schedule_status: ["scheduled", "published", "failed", "cancelled"],
    },
  },
} as const
