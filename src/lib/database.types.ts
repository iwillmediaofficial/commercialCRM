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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      access_pins: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string
          full_name: string | null
          id: string
          issued_by: string | null
          phone: string | null
          pin_hash: string
          pin_hint: string
          purpose: Database["public"]["Enums"]["pin_purpose"]
          revoked_at: string | null
          role: Database["public"]["Enums"]["member_role"] | null
          target_user_id: string | null
          used_at: string | null
          used_by: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          expires_at?: string
          full_name?: string | null
          id?: string
          issued_by?: string | null
          phone?: string | null
          pin_hash: string
          pin_hint: string
          purpose?: Database["public"]["Enums"]["pin_purpose"]
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["member_role"] | null
          target_user_id?: string | null
          used_at?: string | null
          used_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string
          full_name?: string | null
          id?: string
          issued_by?: string | null
          phone?: string | null
          pin_hash?: string
          pin_hint?: string
          purpose?: Database["public"]["Enums"]["pin_purpose"]
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["member_role"] | null
          target_user_id?: string | null
          used_at?: string | null
          used_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_pins_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string
          id: number
          summary: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          summary?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          summary?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_fund_adjustments: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          id: string
          kind: string
          notes: string | null
          recorded_by: string | null
          updated_at: string
          workspace_id: string
          year_month: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          id?: string
          kind: string
          notes?: string | null
          recorded_by?: string | null
          updated_at?: string
          workspace_id: string
          year_month: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          recorded_by?: string | null
          updated_at?: string
          workspace_id?: string
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_fund_adjustments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_fund_adjustments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_fund_collections: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_mode"]
          notes: string | null
          received_on: string
          recorded_by: string | null
          reference_no: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_mode"]
          notes?: string | null
          received_on?: string
          recorded_by?: string | null
          reference_no?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_mode"]
          notes?: string | null
          received_on?: string
          recorded_by?: string | null
          reference_no?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_fund_collections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_fund_collections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_fund_uploads: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          id: string
          notes: string | null
          payer_name: string | null
          payer_type: string
          platform: string
          recorded_by: string | null
          updated_at: string
          upload_date: string
          workspace_id: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          payer_name?: string | null
          payer_type: string
          platform: string
          recorded_by?: string | null
          updated_at?: string
          upload_date?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          payer_name?: string | null
          payer_type?: string
          platform?: string
          recorded_by?: string | null
          updated_at?: string
          upload_date?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_fund_uploads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_fund_uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          id: number
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          id?: never
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          ad_platforms: string[]
          address: string | null
          company_name: string
          contact_person: string | null
          created_at: string
          created_by: string | null
          email: string | null
          gstin: string | null
          id: string
          is_dm_client: boolean
          logo_path: string | null
          monthly_ad_target: number
          notes: string | null
          phone: string | null
          status: string
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          ad_platforms?: string[]
          address?: string | null
          company_name: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          is_dm_client?: boolean
          logo_path?: string | null
          monthly_ad_target?: number
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          ad_platforms?: string[]
          address?: string | null
          company_name?: string
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          gstin?: string | null
          id?: string
          is_dm_client?: boolean
          logo_path?: string | null
          monthly_ad_target?: number
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string
          file_name: string
          id: string
          mime_type: string | null
          r2_key: string
          size_bytes: number
          uploaded_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type: string
          file_name: string
          id?: string
          mime_type?: string | null
          r2_key: string
          size_bytes?: number
          uploaded_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          r2_key?: string
          size_bytes?: number
          uploaded_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number | null
          description: string
          hsn_sac: string | null
          id: string
          invoice_id: string
          position: number
          quantity: number
          rate: number
          tax_rate: number
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          description: string
          hsn_sac?: string | null
          id?: string
          invoice_id: string
          position?: number
          quantity?: number
          rate?: number
          tax_rate?: number
          workspace_id: string
        }
        Update: {
          amount?: number | null
          description?: string
          hsn_sac?: string | null
          id?: string
          invoice_id?: string
          position?: number
          quantity?: number
          rate?: number
          tax_rate?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_with_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_mode"]
          notes: string | null
          paid_on: string
          recorded_by: string | null
          reference_no: string | null
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_mode"]
          notes?: string | null
          paid_on?: string
          recorded_by?: string | null
          reference_no?: string | null
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_mode"]
          notes?: string | null
          paid_on?: string
          recorded_by?: string | null
          reference_no?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices_with_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          discount_amount: number
          due_date: string
          id: string
          invoice_number: string | null
          issue_date: string
          notes: string | null
          period_end: string | null
          period_start: string | null
          place_of_supply: string | null
          recurring_bill_id: string | null
          status: string
          subtotal: number
          tax_total: number
          terms: string | null
          total: number
          updated_at: string
          work_item_id: string | null
          workspace_id: string
        }
        Insert: {
          amount_paid?: number
          assigned_to?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_amount?: number
          due_date: string
          id?: string
          invoice_number?: string | null
          issue_date?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          place_of_supply?: string | null
          recurring_bill_id?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          terms?: string | null
          total?: number
          updated_at?: string
          work_item_id?: string | null
          workspace_id: string
        }
        Update: {
          amount_paid?: number
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          discount_amount?: number
          due_date?: string
          id?: string
          invoice_number?: string | null
          issue_date?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          place_of_supply?: string | null
          recurring_bill_id?: string | null
          status?: string
          subtotal?: number
          tax_total?: number
          terms?: string | null
          total?: number
          updated_at?: string
          work_item_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_recurring_bill_id_fkey"
            columns: ["recurring_bill_id"]
            isOneToOne: false
            referencedRelation: "recurring_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_forms: {
        Row: {
          banner_path: string | null
          created_at: string
          created_by: string | null
          default_source: string
          description: string | null
          fields: Json
          id: string
          is_active: boolean
          logo_path: string | null
          slug: string
          success_message: string | null
          theme_color: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          banner_path?: string | null
          created_at?: string
          created_by?: string | null
          default_source?: string
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          logo_path?: string | null
          slug: string
          success_message?: string | null
          theme_color?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          banner_path?: string | null
          created_at?: string
          created_by?: string | null
          default_source?: string
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          logo_path?: string | null
          slug?: string
          success_message?: string | null
          theme_color?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_forms_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          campaign_details: string | null
          company: string | null
          converted_client_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          follow_up_date: string | null
          form_answers: Json | null
          form_id: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          position: number
          score: number | null
          source: string
          stage: string
          updated_at: string
          value: number | null
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          campaign_details?: string | null
          company?: string | null
          converted_client_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          follow_up_date?: string | null
          form_answers?: Json | null
          form_id?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          position?: number
          score?: number | null
          source?: string
          stage?: string
          updated_at?: string
          value?: number | null
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          campaign_details?: string | null
          company?: string | null
          converted_client_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          follow_up_date?: string | null
          form_answers?: Json | null
          form_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          position?: number
          score?: number | null
          source?: string
          stage?: string
          updated_at?: string
          value?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "lead_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string | null
          title: string
          type: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          title: string
          type?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          client_limit: number | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          modules: string[]
          name: string
          price_half_yearly: number | null
          price_monthly: number | null
          price_quarterly: number | null
          price_yearly: number | null
          sort_order: number
          staff_limit: number | null
          updated_at: string
        }
        Insert: {
          client_limit?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          modules?: string[]
          name: string
          price_half_yearly?: number | null
          price_monthly?: number | null
          price_quarterly?: number | null
          price_yearly?: number | null
          sort_order?: number
          staff_limit?: number | null
          updated_at?: string
        }
        Update: {
          client_limit?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          modules?: string[]
          name?: string
          price_half_yearly?: number | null
          price_monthly?: number | null
          price_quarterly?: number | null
          price_yearly?: number | null
          sort_order?: number
          staff_limit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          bank_account_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          bank_name: string | null
          grace_days: number
          id: boolean
          payment_note: string | null
          reminder_days: number
          trial_days: number
          updated_at: string
          upi_id: string | null
          upi_qr_path: string | null
        }
        Insert: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          grace_days?: number
          id?: boolean
          payment_note?: string | null
          reminder_days?: number
          trial_days?: number
          updated_at?: string
          upi_id?: string | null
          upi_qr_path?: string | null
        }
        Update: {
          bank_account_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          bank_name?: string | null
          grace_days?: number
          id?: boolean
          payment_note?: string | null
          reminder_days?: number
          trial_days?: number
          updated_at?: string
          upi_id?: string | null
          upi_qr_path?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          department: string | null
          designation: string | null
          email: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          email: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          department?: string | null
          designation?: string | null
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      recurring_bills: {
        Row: {
          amount: number
          assigned_to: string | null
          billing_day: number
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["billing_period"]
          id: string
          is_active: boolean
          next_run_date: string
          payment_terms_days: number
          start_date: string
          tax_rate: number
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          assigned_to?: string | null
          billing_day?: number
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["billing_period"]
          id?: string
          is_active?: boolean
          next_run_date: string
          payment_terms_days?: number
          start_date?: string
          tax_rate?: number
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          assigned_to?: string | null
          billing_day?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["billing_period"]
          id?: string
          is_active?: boolean
          next_run_date?: string
          payment_terms_days?: number
          start_date?: string
          tax_rate?: number
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_bills_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_bills_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      renewal_requests: {
        Row: {
          admin_note: string | null
          amount: number
          created_at: string
          id: string
          note: string | null
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          period: Database["public"]["Enums"]["billing_period"]
          plan_id: string
          receipt_path: string | null
          reference_no: string | null
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["request_status"]
          workspace_id: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          period: Database["public"]["Enums"]["billing_period"]
          plan_id: string
          receipt_path?: string | null
          reference_no?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          workspace_id: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          payment_mode?: Database["public"]["Enums"]["payment_mode"]
          period?: Database["public"]["Enums"]["billing_period"]
          plan_id?: string
          receipt_path?: string | null
          reference_no?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewal_requests_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          paid_on: string
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          period: Database["public"]["Enums"]["billing_period"] | null
          plan_id: string
          recorded_by: string | null
          reference_no: string | null
          renewal_request_id: string | null
          valid_from: string
          valid_until: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          paid_on?: string
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          period?: Database["public"]["Enums"]["billing_period"] | null
          plan_id: string
          recorded_by?: string | null
          reference_no?: string | null
          renewal_request_id?: string | null
          valid_from: string
          valid_until: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          paid_on?: string
          payment_mode?: Database["public"]["Enums"]["payment_mode"]
          period?: Database["public"]["Enums"]["billing_period"] | null
          plan_id?: string
          recorded_by?: string | null
          reference_no?: string | null
          renewal_request_id?: string | null
          valid_from?: string
          valid_until?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_renewal_request_id_fkey"
            columns: ["renewal_request_id"]
            isOneToOne: false
            referencedRelation: "renewal_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          client_id: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          is_billable: boolean
          notes: string | null
          started_at: string
          stopped_at: string | null
          stopped_by: string | null
          user_id: string
          work_item_id: string | null
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_billable?: boolean
          notes?: string | null
          started_at?: string
          stopped_at?: string | null
          stopped_by?: string | null
          user_id: string
          work_item_id?: string | null
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_billable?: boolean
          notes?: string | null
          started_at?: string
          stopped_at?: string | null
          stopped_by?: string | null
          user_id?: string
          work_item_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          user_id: string
          work_item_id: string
          workspace_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          user_id: string
          work_item_id: string
          workspace_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          user_id?: string
          work_item_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_assignees_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_assignees_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          billable_amount: number | null
          checklist: Json
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          is_billable: boolean
          position: number
          priority: string
          start_date: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          billable_amount?: number | null
          checklist?: Json
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_billable?: boolean
          position?: number
          priority?: string
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          billable_amount?: number | null
          checklist?: Json
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          is_billable?: boolean
          position?: number
          priority?: string
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          is_active: boolean
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          is_active?: boolean
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          is_active?: boolean
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          address: string | null
          bank_details: string | null
          city: string | null
          company_name: string | null
          country: string | null
          currency: string
          default_payment_terms_days: number
          default_tax_rate: number
          email: string | null
          gstin: string | null
          invoice_footer: string | null
          invoice_prefix: string
          legal_name: string | null
          logo_path: string | null
          next_invoice_number: number
          notification_rules: Json
          pan: string | null
          phone: string | null
          postal_code: string | null
          recurring_lead_days: number
          state: string | null
          updated_at: string
          website: string | null
          workspace_id: string
        }
        Insert: {
          address?: string | null
          bank_details?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          currency?: string
          default_payment_terms_days?: number
          default_tax_rate?: number
          email?: string | null
          gstin?: string | null
          invoice_footer?: string | null
          invoice_prefix?: string
          legal_name?: string | null
          logo_path?: string | null
          next_invoice_number?: number
          notification_rules?: Json
          pan?: string | null
          phone?: string | null
          postal_code?: string | null
          recurring_lead_days?: number
          state?: string | null
          updated_at?: string
          website?: string | null
          workspace_id: string
        }
        Update: {
          address?: string | null
          bank_details?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          currency?: string
          default_payment_terms_days?: number
          default_tax_rate?: number
          email?: string | null
          gstin?: string | null
          invoice_footer?: string | null
          invoice_prefix?: string
          legal_name?: string | null
          logo_path?: string | null
          next_invoice_number?: number
          notification_rules?: Json
          pan?: string | null
          phone?: string | null
          postal_code?: string | null
          recurring_lead_days?: number
          state?: string | null
          updated_at?: string
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          logo_path: string | null
          name: string
          notes: string | null
          owner_email: string | null
          owner_name: string | null
          owner_phone: string | null
          plan_id: string
          slug: string
          state: Database["public"]["Enums"]["subscription_state"]
          updated_at: string
          valid_until: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          logo_path?: string | null
          name: string
          notes?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          plan_id: string
          slug: string
          state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
          valid_until: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          notes?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          plan_id?: string
          slug?: string
          state?: Database["public"]["Enums"]["subscription_state"]
          updated_at?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      invoices_with_status: {
        Row: {
          amount_paid: number | null
          assigned_to: string | null
          balance_due: number | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          discount_amount: number | null
          display_status: string | null
          due_date: string | null
          id: string | null
          invoice_number: string | null
          issue_date: string | null
          notes: string | null
          period_end: string | null
          period_start: string | null
          place_of_supply: string | null
          recurring_bill_id: string | null
          status: string | null
          subtotal: number | null
          tax_total: number | null
          terms: string | null
          total: number | null
          updated_at: string | null
          work_item_id: string | null
          workspace_id: string | null
        }
        Insert: {
          amount_paid?: number | null
          assigned_to?: string | null
          balance_due?: never
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          discount_amount?: number | null
          display_status?: never
          due_date?: string | null
          id?: string | null
          invoice_number?: string | null
          issue_date?: string | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          place_of_supply?: string | null
          recurring_bill_id?: string | null
          status?: string | null
          subtotal?: number | null
          tax_total?: number | null
          terms?: string | null
          total?: number | null
          updated_at?: string | null
          work_item_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount_paid?: number | null
          assigned_to?: string | null
          balance_due?: never
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          discount_amount?: number | null
          display_status?: never
          due_date?: string | null
          id?: string | null
          invoice_number?: string | null
          issue_date?: string | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          place_of_supply?: string | null
          recurring_bill_id?: string | null
          status?: string | null
          subtotal?: number | null
          tax_total?: number | null
          terms?: string | null
          total?: number | null
          updated_at?: string | null
          work_item_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_recurring_bill_id_fkey"
            columns: ["recurring_bill_id"]
            isOneToOne: false
            referencedRelation: "recurring_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_create_workspace: {
        Args: {
          p_name: string
          p_owner_email?: string
          p_owner_name: string
          p_owner_phone?: string
          p_plan_id: string
          p_slug: string
          p_trial_days?: number
          p_valid_until?: string
        }
        Returns: Json
      }
      admin_update_subscription: {
        Args: {
          p_add_days?: number
          p_note?: string
          p_plan_id?: string
          p_state?: Database["public"]["Enums"]["subscription_state"]
          p_workspace_id: string
        }
        Returns: undefined
      }
      approve_renewal: {
        Args: { p_admin_note?: string; p_request_id: string }
        Returns: Json
      }
      can_admin_write: {
        Args: { module?: string; ws: string }
        Returns: boolean
      }
      can_write: { Args: { module?: string; ws: string }; Returns: boolean }
      convert_lead_to_client: {
        Args: { p_create_work_item?: boolean; p_lead_id: string }
        Returns: Json
      }
      get_public_form: { Args: { p_slug: string }; Returns: Json }
      is_assigned_to_work_item: {
        Args: { p_work_item: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_workspace_admin: { Args: { ws: string }; Returns: boolean }
      is_workspace_member: { Args: { ws: string }; Returns: boolean }
      issue_access_pin: {
        Args: {
          p_email?: string
          p_full_name?: string
          p_phone?: string
          p_purpose: Database["public"]["Enums"]["pin_purpose"]
          p_role?: Database["public"]["Enums"]["member_role"]
          p_target_user_id?: string
          p_valid_days?: number
          p_workspace_id?: string
        }
        Returns: Json
      }
      issue_access_pin_retired: {
        Args: {
          p_email?: string
          p_purpose: Database["public"]["Enums"]["pin_purpose"]
          p_role?: Database["public"]["Enums"]["member_role"]
          p_target_user_id?: string
          p_valid_days?: number
          p_workspace_id?: string
        }
        Returns: Json
      }
      member_role: {
        Args: { ws: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      pin_check: {
        Args: {
          p_client_key: string
          p_email: string
          p_pin: string
          p_purpose: Database["public"]["Enums"]["pin_purpose"]
        }
        Returns: Json
      }
      pin_consume: {
        Args: {
          p_client_key?: string
          p_email: string
          p_full_name?: string
          p_phone?: string
          p_pin_id: string
          p_user_id: string
        }
        Returns: Json
      }
      reject_renewal: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      revoke_access_pin: { Args: { p_pin_id: string }; Returns: undefined }
      run_recurring_billing: {
        Args: { p_workspace_id: string }
        Returns: number
      }
      start_timer: {
        Args: {
          p_notes?: string
          p_work_item_id?: string
          p_workspace_id: string
        }
        Returns: string
      }
      stop_timer: {
        Args: { p_user_id?: string; p_workspace_id: string }
        Returns: undefined
      }
      submit_public_lead: {
        Args: {
          p_answers?: Json
          p_email?: string
          p_name: string
          p_phone: string
          p_slug: string
        }
        Returns: Json
      }
      workspace_has_module: {
        Args: { module: string; ws: string }
        Returns: boolean
      }
      workspace_is_active: { Args: { ws: string }; Returns: boolean }
      workspace_status: { Args: { ws: string }; Returns: string }
    }
    Enums: {
      billing_period: "monthly" | "quarterly" | "half_yearly" | "yearly"
      member_role: "owner" | "admin" | "staff"
      payment_mode: "bank_transfer" | "upi" | "cheque" | "cash" | "other"
      pin_purpose: "signup" | "reset" | "platform_admin"
      request_status: "pending" | "approved" | "rejected"
      subscription_state: "trial" | "active" | "suspended"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      billing_period: ["monthly", "quarterly", "half_yearly", "yearly"],
      member_role: ["owner", "admin", "staff"],
      payment_mode: ["bank_transfer", "upi", "cheque", "cash", "other"],
      pin_purpose: ["signup", "reset", "platform_admin"],
      request_status: ["pending", "approved", "rejected"],
      subscription_state: ["trial", "active", "suspended"],
    },
  },
} as const
