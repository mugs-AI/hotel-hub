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
      hotel_audit_events: {
        Row: {
          created_at: string
          detail: Json
          event_type: string
          id: string
          ip: string | null
          n3_user_key: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          ip?: string | null
          n3_user_key?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          ip?: string | null
          n3_user_key?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_booking_sequences: {
        Row: {
          created_at: string
          id: string
          last_number: number
          sequence_date: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_number?: number
          sequence_date: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_number?: number
          sequence_date?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_booking_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_guests: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          mobile: string | null
          nationality: string | null
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          mobile?: string | null
          nationality?: string | null
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          mobile?: string | null
          nationality?: string | null
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_guests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_reservation_guests: {
        Row: {
          created_at: string
          guest_id: string
          id: string
          is_primary: boolean
          reservation_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          guest_id: string
          id?: string
          is_primary?: boolean
          reservation_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          guest_id?: string
          id?: string
          is_primary?: boolean
          reservation_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_guests_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "hotel_guests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_guests_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_guests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_reservation_rooms: {
        Row: {
          adults: number
          agreed_rate: number
          allocation_status: string
          arrival_date: string
          base_rate_snapshot: number
          children: number
          created_at: string
          departure_date: string
          hotel_room_id: string
          id: string
          rate_override_reason: string | null
          reservation_id: string
          stay_range: unknown
          tenant_id: string
          updated_at: string
        }
        Insert: {
          adults: number
          agreed_rate: number
          allocation_status?: string
          arrival_date: string
          base_rate_snapshot: number
          children?: number
          created_at?: string
          departure_date: string
          hotel_room_id: string
          id?: string
          rate_override_reason?: string | null
          reservation_id: string
          stay_range?: unknown
          tenant_id: string
          updated_at?: string
        }
        Update: {
          adults?: number
          agreed_rate?: number
          allocation_status?: string
          arrival_date?: string
          base_rate_snapshot?: number
          children?: number
          created_at?: string
          departure_date?: string
          hotel_room_id?: string
          id?: string
          rate_override_reason?: string | null
          reservation_id?: string
          stay_range?: unknown
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_rooms_hotel_room_id_fkey"
            columns: ["hotel_room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_rooms_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_reservations: {
        Row: {
          arrival_date: string
          booking_reference: string
          booking_source: string
          created_at: string
          created_by_n3_user_key: string
          currency: string
          departure_date: string
          id: string
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          arrival_date: string
          booking_reference: string
          booking_source: string
          created_at?: string
          created_by_n3_user_key: string
          currency: string
          departure_date: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          arrival_date?: string
          booking_reference?: string
          booking_source?: string
          created_at?: string
          created_by_n3_user_key?: string
          currency?: string
          departure_date?: string
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_rooms: {
        Row: {
          base_rate: number
          created_at: string
          display_name: string | null
          floor: string | null
          id: string
          is_active: boolean
          max_occupancy: number
          n3_stock_code: string
          n3_stock_id: string
          n3_stock_name: string | null
          room_number: string
          room_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_rate?: number
          created_at?: string
          display_name?: string | null
          floor?: string | null
          id?: string
          is_active?: boolean
          max_occupancy?: number
          n3_stock_code: string
          n3_stock_id: string
          n3_stock_name?: string | null
          room_number: string
          room_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_rate?: number
          created_at?: string
          display_name?: string | null
          floor?: string | null
          id?: string
          is_active?: boolean
          max_occupancy?: number
          n3_stock_code?: string
          n3_stock_id?: string
          n3_stock_name?: string | null
          room_number?: string
          room_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_settings: {
        Row: {
          created_at: string
          currency: string
          id: string
          n3_walk_in_customer_code: string | null
          n3_walk_in_customer_id: string | null
          n3_walk_in_customer_name: string | null
          standard_check_in_time: string
          standard_check_out_time: string
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          n3_walk_in_customer_code?: string | null
          n3_walk_in_customer_id?: string | null
          n3_walk_in_customer_name?: string | null
          standard_check_in_time?: string
          standard_check_out_time?: string
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          n3_walk_in_customer_code?: string | null
          n3_walk_in_customer_id?: string | null
          n3_walk_in_customer_name?: string | null
          standard_check_in_time?: string
          standard_check_out_time?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_tenants: {
        Row: {
          company_name: string | null
          created_at: string
          id: string
          n3_tenant_key: string
          status: string
          tenant_code: string | null
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          id?: string
          n3_tenant_key: string
          status?: string
          tenant_code?: string | null
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          id?: string
          n3_tenant_key?: string
          status?: string
          tenant_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hotel_user_roles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          n3_user_key: string
          role: Database["public"]["Enums"]["hotel_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          n3_user_key: string
          role: Database["public"]["Enums"]["hotel_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          n3_user_key?: string
          role?: Database["public"]["Enums"]["hotel_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hotelhub_create_reservation: {
        Args: {
          p_arrival_date: string
          p_booking_source: string
          p_created_by_n3_user_key: string
          p_departure_date: string
          p_guests: Json
          p_notes: string
          p_rooms: Json
          p_tenant_id: string
        }
        Returns: {
          out_booking_reference: string
          out_reservation_id: string
          out_status: string
        }[]
      }
      hotelhub_provision_owner: {
        Args: { p_n3_tenant_key: string; p_n3_user_key: string }
        Returns: {
          out_is_active: boolean
          out_n3_user_key: string
          out_role: Database["public"]["Enums"]["hotel_role"]
          out_tenant_id: string
        }[]
      }
    }
    Enums: {
      hotel_role: "owner" | "front_desk" | "housekeeper"
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
      hotel_role: ["owner", "front_desk", "housekeeper"],
    },
  },
} as const
