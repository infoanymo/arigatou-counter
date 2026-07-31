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
          status: ProfileStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          status?: ProfileStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          display_name?: string | null;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          period_id: string;
          user_id?: string;
          created_at?: string;
        };
        Update: never;
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
export type ThankYouAdjustment =
  Database["public"]["Tables"]["thank_you_adjustments"]["Row"];
