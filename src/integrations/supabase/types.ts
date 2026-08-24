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
      hotel_booking_sources: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          sort_order: number
          source_code: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          sort_order?: number
          source_code: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          source_code?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_booking_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_guests: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          address_line_3: string | null
          city: string | null
          country_code: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          identity_number: string | null
          identity_type: string | null
          mobile: string | null
          nationality: string | null
          nationality_code: string | null
          notes: string | null
          postcode: string | null
          state_code: string | null
          state_province: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          identity_number?: string | null
          identity_type?: string | null
          mobile?: string | null
          nationality?: string | null
          nationality_code?: string | null
          notes?: string | null
          postcode?: string | null
          state_code?: string | null
          state_province?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          address_line_3?: string | null
          city?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          identity_number?: string | null
          identity_type?: string | null
          mobile?: string | null
          nationality?: string | null
          nationality_code?: string | null
          notes?: string | null
          postcode?: string | null
          state_code?: string | null
          state_province?: string | null
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
      hotel_housekeeping_events: {
        Row: {
          action: string
          actor_n3_user_key: string
          created_at: string
          dnd_after: boolean | null
          dnd_before: boolean | null
          hotel_room_id: string
          id: string
          note: string | null
          previous_condition: string | null
          resulting_condition: string | null
          source: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_n3_user_key: string
          created_at?: string
          dnd_after?: boolean | null
          dnd_before?: boolean | null
          hotel_room_id: string
          id?: string
          note?: string | null
          previous_condition?: string | null
          resulting_condition?: string | null
          source?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_n3_user_key?: string
          created_at?: string
          dnd_after?: boolean | null
          dnd_before?: boolean | null
          hotel_room_id?: string
          id?: string
          note?: string | null
          previous_condition?: string | null
          resulting_condition?: string | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_housekeeping_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_housekeeping_events_tenant_room_fkey"
            columns: ["tenant_id", "hotel_room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      hotel_housekeeping_handoffs: {
        Row: {
          actor_n3_user_key: string
          attempts: number
          created_at: string
          hotel_room_id: string
          id: string
          last_error: string | null
          operation_request_id: string | null
          reservation_id: string | null
          resolved_at: string | null
          source: string
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actor_n3_user_key: string
          attempts?: number
          created_at?: string
          hotel_room_id: string
          id?: string
          last_error?: string | null
          operation_request_id?: string | null
          reservation_id?: string | null
          resolved_at?: string | null
          source?: string
          state?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actor_n3_user_key?: string
          attempts?: number
          created_at?: string
          hotel_room_id?: string
          id?: string
          last_error?: string | null
          operation_request_id?: string | null
          reservation_id?: string | null
          resolved_at?: string | null
          source?: string
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_housekeeping_handoffs_hotel_room_id_fkey"
            columns: ["hotel_room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_housekeeping_handoffs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_housekeeping_handoffs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_mutation_requests: {
        Row: {
          client_request_id: string
          created_at: string
          fingerprint: string | null
          id: string
          reservation_id: string | null
          result: Json
          scope: string
          tenant_id: string
        }
        Insert: {
          client_request_id: string
          created_at?: string
          fingerprint?: string | null
          id?: string
          reservation_id?: string | null
          result?: Json
          scope: string
          tenant_id: string
        }
        Update: {
          client_request_id?: string
          created_at?: string
          fingerprint?: string | null
          id?: string
          reservation_id?: string | null
          result?: Json
          scope?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_mutation_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_reservation_deposits: {
        Row: {
          amount: number
          created_at: string
          created_by_n3_user_key: string
          currency_code: string
          description: string | null
          id: string
          idempotency_key: string
          last_error_code: string | null
          n3_account_code: string | null
          n3_account_id: string | null
          n3_account_name: string | null
          n3_customer_code: string | null
          n3_customer_id: string | null
          n3_customer_name: string | null
          n3_doc_code: string | null
          n3_receipt_id: string | null
          n3_reference_no: string
          reservation_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by_n3_user_key: string
          currency_code: string
          description?: string | null
          id?: string
          idempotency_key: string
          last_error_code?: string | null
          n3_account_code?: string | null
          n3_account_id?: string | null
          n3_account_name?: string | null
          n3_customer_code?: string | null
          n3_customer_id?: string | null
          n3_customer_name?: string | null
          n3_doc_code?: string | null
          n3_receipt_id?: string | null
          n3_reference_no: string
          reservation_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by_n3_user_key?: string
          currency_code?: string
          description?: string | null
          id?: string
          idempotency_key?: string
          last_error_code?: string | null
          n3_account_code?: string | null
          n3_account_id?: string | null
          n3_account_name?: string | null
          n3_customer_code?: string | null
          n3_customer_id?: string | null
          n3_customer_name?: string | null
          n3_doc_code?: string | null
          n3_receipt_id?: string | null
          n3_reference_no?: string
          reservation_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_deposits_reservation_fkey"
            columns: ["tenant_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "hotel_reservation_deposits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_reservation_events: {
        Row: {
          actor_n3_user_key: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          reservation_id: string
          summary: string
          tenant_id: string
        }
        Insert: {
          actor_n3_user_key?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          occurred_at?: string
          reservation_id: string
          summary: string
          tenant_id: string
        }
        Update: {
          actor_n3_user_key?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          reservation_id?: string
          summary?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_events_tenant_reservation_fkey"
            columns: ["reservation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["id", "tenant_id"]
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
          reservation_room_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          guest_id: string
          id?: string
          is_primary?: boolean
          reservation_id: string
          reservation_room_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          guest_id?: string
          id?: string
          is_primary?: boolean
          reservation_id?: string
          reservation_room_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_guests_reservation_room_id_fkey"
            columns: ["reservation_room_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservation_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_guests_tenant_guest_fkey"
            columns: ["tenant_id", "guest_id"]
            isOneToOne: false
            referencedRelation: "hotel_guests"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "hotel_reservation_guests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_guests_tenant_reservation_fkey"
            columns: ["tenant_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      hotel_reservation_operation_requests: {
        Row: {
          applied_at: string | null
          created_at: string
          decided_at: string | null
          decided_by_n3_user_key: string | null
          decision_idempotency_key: string | null
          decision_note: string | null
          id: string
          idempotency_key: string
          operation_type: string
          payload: Json
          requested_at: string
          requested_by_n3_user_key: string
          reservation_id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_n3_user_key?: string | null
          decision_idempotency_key?: string | null
          decision_note?: string | null
          id?: string
          idempotency_key: string
          operation_type: string
          payload?: Json
          requested_at?: string
          requested_by_n3_user_key: string
          reservation_id: string
          state?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_n3_user_key?: string | null
          decision_idempotency_key?: string | null
          decision_note?: string | null
          id?: string
          idempotency_key?: string
          operation_type?: string
          payload?: Json
          requested_at?: string
          requested_by_n3_user_key?: string
          reservation_id?: string
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_operation_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_operation_requests_tenant_reservation_fkey"
            columns: ["reservation_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["id", "tenant_id"]
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
          remark: string | null
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
          remark?: string | null
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
          remark?: string | null
          reservation_id?: string
          stay_range?: unknown
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservation_rooms_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_reservation_rooms_tenant_reservation_fkey"
            columns: ["tenant_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "hotel_reservations"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "hotel_reservation_rooms_tenant_room_fkey"
            columns: ["tenant_id", "hotel_room_id"]
            isOneToOne: false
            referencedRelation: "hotel_rooms"
            referencedColumns: ["tenant_id", "id"]
          },
        ]
      }
      hotel_reservations: {
        Row: {
          arrival_date: string
          booking_reference: string
          booking_source: string
          checked_in_at: string | null
          checked_in_by_n3_user_key: string | null
          created_at: string
          created_by_n3_user_key: string
          currency: string
          departure_date: string
          expected_check_out_at: string | null
          external_booking_reference: string | null
          id: string
          notes: string | null
          operational_note: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          arrival_date: string
          booking_reference: string
          booking_source: string
          checked_in_at?: string | null
          checked_in_by_n3_user_key?: string | null
          created_at?: string
          created_by_n3_user_key: string
          currency: string
          departure_date: string
          expected_check_out_at?: string | null
          external_booking_reference?: string | null
          id?: string
          notes?: string | null
          operational_note?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          arrival_date?: string
          booking_reference?: string
          booking_source?: string
          checked_in_at?: string | null
          checked_in_by_n3_user_key?: string | null
          created_at?: string
          created_by_n3_user_key?: string
          currency?: string
          departure_date?: string
          expected_check_out_at?: string | null
          external_booking_reference?: string | null
          id?: string
          notes?: string | null
          operational_note?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_reservations_booking_source_fk"
            columns: ["tenant_id", "booking_source"]
            isOneToOne: false
            referencedRelation: "hotel_booking_sources"
            referencedColumns: ["tenant_id", "source_code"]
          },
          {
            foreignKeyName: "hotel_reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_room_housekeeping: {
        Row: {
          condition: string
          created_at: string
          dnd_active: boolean
          dnd_set_at: string | null
          dnd_set_by_n3_user_key: string | null
          hotel_room_id: string
          id: string
          initialized_at: string
          initialized_by_n3_user_key: string
          last_action: string | null
          last_actor_n3_user_key: string | null
          last_transition_at: string | null
          note: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          condition: string
          created_at?: string
          dnd_active?: boolean
          dnd_set_at?: string | null
          dnd_set_by_n3_user_key?: string | null
          hotel_room_id: string
          id?: string
          initialized_at?: string
          initialized_by_n3_user_key: string
          last_action?: string | null
          last_actor_n3_user_key?: string | null
          last_transition_at?: string | null
          note?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          condition?: string
          created_at?: string
          dnd_active?: boolean
          dnd_set_at?: string | null
          dnd_set_by_n3_user_key?: string | null
          hotel_room_id?: string
          id?: string
          initialized_at?: string
          initialized_by_n3_user_key?: string
          last_action?: string | null
          last_actor_n3_user_key?: string | null
          last_transition_at?: string | null
          note?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_room_housekeeping_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_room_housekeeping_tenant_room_fkey"
            columns: ["tenant_id", "hotel_room_id"]
            isOneToOne: true
            referencedRelation: "hotel_rooms"
            referencedColumns: ["tenant_id", "id"]
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
          allow_owner_primary_guest_change_after_check_in: boolean
          created_at: string
          currency: string
          exception_approval_mode: string
          housekeeping_mode: string
          id: string
          n3_walk_in_customer_code: string | null
          n3_walk_in_customer_id: string | null
          n3_walk_in_customer_name: string | null
          post_check_in_guest_edit_policy: string
          standard_check_in_time: string
          standard_check_out_time: string
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          allow_owner_primary_guest_change_after_check_in?: boolean
          created_at?: string
          currency?: string
          exception_approval_mode?: string
          housekeeping_mode?: string
          id?: string
          n3_walk_in_customer_code?: string | null
          n3_walk_in_customer_id?: string | null
          n3_walk_in_customer_name?: string | null
          post_check_in_guest_edit_policy?: string
          standard_check_in_time?: string
          standard_check_out_time?: string
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          allow_owner_primary_guest_change_after_check_in?: boolean
          created_at?: string
          currency?: string
          exception_approval_mode?: string
          housekeeping_mode?: string
          id?: string
          n3_walk_in_customer_code?: string | null
          n3_walk_in_customer_id?: string | null
          n3_walk_in_customer_name?: string | null
          post_check_in_guest_edit_policy?: string
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
      hotel_user_directory: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          n3_user_key: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          n3_user_key: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          n3_user_key?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotel_user_directory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "hotel_tenants"
            referencedColumns: ["id"]
          },
        ]
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
      hotelhub_assign_guest_rooms_v2: {
        Args: {
          p_actor_n3_user_key: string
          p_actor_role: string
          p_assignments: Json
          p_client_request_id: string
          p_correction_reason: string
          p_expected_updated_at: string
          p_reservation_id: string
          p_tenant_id: string
        }
        Returns: {
          out_replayed: boolean
          out_updated: number
          out_updated_at: string
        }[]
      }
      hotelhub_check_in_reservation:
        | {
            Args: {
              p_actor_n3_user_key: string
              p_allow_early?: boolean
              p_expected_updated_at: string
              p_operation_request_id?: string
              p_reservation_id: string
              p_tenant_id: string
            }
            Returns: {
              out_checked_in_at: string
              out_status: string
              out_updated_at: string
            }[]
          }
        | {
            Args: {
              p_actor_n3_user_key: string
              p_allow_early?: boolean
              p_client_request_id?: string
              p_expected_updated_at: string
              p_operation_request_id?: string
              p_reservation_id: string
              p_tenant_id: string
            }
            Returns: {
              out_checked_in_at: string
              out_status: string
              out_updated_at: string
            }[]
          }
      hotelhub_create_reservation: {
        Args: {
          p_arrival_date: string
          p_booking_source: string
          p_created_by_n3_user_key: string
          p_departure_date: string
          p_external_booking_reference: string
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
      hotelhub_decide_operation: {
        Args: {
          p_actor_n3_user_key: string
          p_decision: string
          p_idempotency_key: string
          p_note: string
          p_request_id: string
          p_tenant_id: string
        }
        Returns: {
          out_request_id: string
          out_state: string
        }[]
      }
      hotelhub_direct_operation: {
        Args: {
          p_actor_n3_user_key: string
          p_idempotency_key: string
          p_operation_type: string
          p_payload: Json
          p_reservation_id: string
          p_tenant_id: string
        }
        Returns: {
          out_request_id: string
          out_state: string
        }[]
      }
      hotelhub_hk_cancel_handoff: {
        Args: { p_handoff_id: string; p_tenant_id: string }
        Returns: undefined
      }
      hotelhub_hk_enqueue_handoff: {
        Args: {
          p_actor_n3_user_key: string
          p_hotel_room_id: string
          p_operation_request_id?: string
          p_reservation_id?: string
          p_source?: string
          p_tenant_id: string
        }
        Returns: {
          out_handoff_id: string
        }[]
      }
      hotelhub_hk_fail_handoff: {
        Args: { p_error: string; p_handoff_id: string; p_tenant_id: string }
        Returns: undefined
      }
      hotelhub_hk_initialize_room: {
        Args: {
          p_actor_n3_user_key: string
          p_condition: string
          p_hotel_room_id: string
          p_source?: string
          p_tenant_id: string
        }
        Returns: {
          out_condition: string
          out_created: boolean
          out_dnd: boolean
        }[]
      }
      hotelhub_hk_list_pending_handoffs: {
        Args: { p_limit?: number; p_tenant_id: string }
        Returns: {
          out_actor_n3_user_key: string
          out_attempts: number
          out_hotel_room_id: string
          out_id: string
          out_reservation_id: string
          out_source: string
        }[]
      }
      hotelhub_hk_set_dnd: {
        Args: {
          p_active: boolean
          p_actor_n3_user_key: string
          p_hotel_room_id: string
          p_source?: string
          p_tenant_id: string
        }
        Returns: {
          out_condition: string
          out_dnd: boolean
        }[]
      }
      hotelhub_hk_transition: {
        Args: {
          p_action: string
          p_actor_n3_user_key: string
          p_hotel_room_id: string
          p_note?: string
          p_source?: string
          p_tenant_id: string
        }
        Returns: {
          out_condition: string
          out_dnd: boolean
          out_previous: string
        }[]
      }
      hotelhub_hk_vacate_room: {
        Args: {
          p_actor_n3_user_key: string
          p_hotel_room_id: string
          p_source?: string
          p_tenant_id: string
        }
        Returns: {
          out_applied: boolean
          out_condition: string
          out_previous: string
        }[]
      }
      hotelhub_hk_vacate_room_v2: {
        Args: {
          p_actor_n3_user_key: string
          p_handoff_id?: string
          p_hotel_room_id: string
          p_source?: string
          p_tenant_id: string
        }
        Returns: {
          out_applied: boolean
          out_condition: string
          out_created: boolean
          out_previous: string
        }[]
      }
      hotelhub_housekeeping_history_preview_30d: {
        Args: { p_tenant_id: string }
        Returns: {
          out_count: number
          out_cutoff: string
        }[]
      }
      hotelhub_property_now: { Args: { p_tenant_id: string }; Returns: string }
      hotelhub_provision_owner: {
        Args: { p_n3_tenant_key: string; p_n3_user_key: string }
        Returns: {
          out_is_active: boolean
          out_n3_user_key: string
          out_role: Database["public"]["Enums"]["hotel_role"]
          out_tenant_id: string
        }[]
      }
      hotelhub_purge_housekeeping_history_30d: {
        Args: { p_actor_n3_user_key: string; p_tenant_id: string }
        Returns: {
          out_cutoff: string
          out_deleted: number
        }[]
      }
      hotelhub_request_operation: {
        Args: {
          p_actor_n3_user_key: string
          p_idempotency_key: string
          p_operation_type: string
          p_payload: Json
          p_reservation_id: string
          p_tenant_id: string
        }
        Returns: {
          out_request_id: string
          out_state: string
        }[]
      }
      hotelhub_update_reservation: {
        Args: {
          p_actor_n3_user_key: string
          p_arrival_date: string
          p_booking_source: string
          p_departure_date: string
          p_expected_updated_at: string
          p_external_booking_reference: string
          p_notes: string
          p_reservation_id: string
          p_rooms: Json
          p_tenant_id: string
        }
        Returns: {
          out_reservation_id: string
          out_updated_at: string
        }[]
      }
      hotelhub_update_reservation_v2: {
        Args: {
          p_actor_n3_user_key: string
          p_actor_role: string
          p_arrival_date: string
          p_booking_source: string
          p_client_request_id: string
          p_correction_reason: string
          p_departure_date: string
          p_expected_updated_at: string
          p_external_booking_reference: string
          p_fingerprint: string
          p_guests: Json
          p_notes: string
          p_reservation_id: string
          p_rooms: Json
          p_tenant_id: string
        }
        Returns: {
          out_replayed: boolean
          out_reservation_id: string
          out_updated_at: string
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
