export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileStatus = "active" | "disabled";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          company_name: string | null;
          avatar_url: string | null;
          avatar_scale: number;
          status: ProfileStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          company_name?: string | null;
          avatar_url?: string | null;
          avatar_scale?: number;
          status?: ProfileStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          display_name?: string | null;
          company_name?: string | null;
          avatar_url?: string | null;
          avatar_scale?: number;
          status?: ProfileStatus;
          updated_at?: string;
        };
        Relationships: [];
      };
      periods: {
        Row: {
          id: string;
          name: string;
          starts_on: string;
          ends_on: string;
          target_count: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          starts_on: string;
          ends_on: string;
          target_count: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          starts_on?: string;
          ends_on?: string;
          target_count?: number;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      thank_you_events: {
        Row: {
          id: string;
          period_id: string;
          user_id: string;
          kind: "thank_you" | "community_post";
          message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          period_id: string;
          user_id?: string;
          kind?: "thank_you" | "community_post";
          message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          period_id?: string;
          user_id?: string;
          kind?: "thank_you" | "community_post";
          message?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thank_you_events_period_id_fkey";
            columns: ["period_id"];
            isOneToOne: false;
            referencedRelation: "periods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thank_you_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      thank_you_likes: {
        Row: {
          event_id: string;
          user_id: string;
          reaction: "like" | "love" | "clap" | "celebrate" | "thanks" | "strong" | "sparkle" | "heart_eyes";
          created_at: string;
        };
        Insert: {
          event_id: string;
          user_id?: string;
          reaction?: "like" | "love" | "clap" | "celebrate" | "thanks" | "strong" | "sparkle" | "heart_eyes";
          created_at?: string;
        };
        Update: {
          event_id?: string;
          user_id?: string;
          reaction?: "like" | "love" | "clap" | "celebrate" | "thanks" | "strong" | "sparkle" | "heart_eyes";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "thank_you_likes_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "thank_you_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thank_you_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      thank_you_comments: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id?: string;
          body: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "thank_you_comments_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "thank_you_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thank_you_comments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      thank_you_adjustments: {
        Row: {
          id: string;
          period_id: string;
          admin_user_id: string;
          delta: number;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          period_id: string;
          admin_user_id?: string;
          delta: number;
          reason?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "thank_you_adjustments_period_id_fkey";
            columns: ["period_id"];
            isOneToOne: false;
            referencedRelation: "periods";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thank_you_adjustments_admin_user_id_fkey";
            columns: ["admin_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chatwork_settings: {
        Row: {
          id: number;
          api_token: string | null;
          room_id: string | null;
          rooms: Json;
          good_voice_enabled: boolean;
          good_voice_keywords: string[];
          enabled: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          api_token?: string | null;
          room_id?: string | null;
          rooms?: Json;
          good_voice_enabled?: boolean;
          good_voice_keywords?: string[];
          enabled?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          api_token?: string | null;
          room_id?: string | null;
          rooms?: Json;
          good_voice_enabled?: boolean;
          good_voice_keywords?: string[];
          enabled?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chatwork_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chatwork_monthly_notifications: {
        Row: {
          id: string;
          target_month: string;
          room_id: string;
          room_name: string | null;
          status: "sent" | "failed";
          cumulative_count: number | null;
          monthly_count: number | null;
          message_body: string;
          chatwork_message_id: string | null;
          response: Json | null;
          error_message: string | null;
          sent_at: string | null;
          triggered_by: "admin" | "cron" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          target_month: string;
          room_id?: string;
          room_name?: string | null;
          status: "sent" | "failed";
          cumulative_count?: number | null;
          monthly_count?: number | null;
          message_body: string;
          chatwork_message_id?: string | null;
          response?: Json | null;
          error_message?: string | null;
          sent_at?: string | null;
          triggered_by?: "admin" | "cron" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          target_month?: string;
          room_id?: string;
          room_name?: string | null;
          status?: "sent" | "failed";
          cumulative_count?: number | null;
          monthly_count?: number | null;
          message_body?: string;
          chatwork_message_id?: string | null;
          response?: Json | null;
          error_message?: string | null;
          sent_at?: string | null;
          triggered_by?: "admin" | "cron" | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      chatwork_good_voices: {
        Row: {
          id: string;
          chatwork_message_id: string;
          room_id: string;
          room_name: string | null;
          author_name: string | null;
          message_body: string;
          sent_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          chatwork_message_id: string;
          room_id: string;
          room_name?: string | null;
          author_name?: string | null;
          message_body: string;
          sent_at: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Period = Database["public"]["Tables"]["periods"]["Row"];
export type ThankYouEvent = Database["public"]["Tables"]["thank_you_events"]["Row"];
export type ThankYouLike = Database["public"]["Tables"]["thank_you_likes"]["Row"];
export type ThankYouComment =
  Database["public"]["Tables"]["thank_you_comments"]["Row"];
export type ThankYouAdjustment =
  Database["public"]["Tables"]["thank_you_adjustments"]["Row"];
