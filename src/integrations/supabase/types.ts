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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      annual_statements: {
        Row: {
          candidate_id: string | null
          created_at: string
          employee_id: string
          generated_at: string | null
          id: string
          notes: string | null
          organization_id: string
          pdf_url: string | null
          sent_at: string | null
          status: string
          total_allowances: number | null
          total_deductions: number | null
          total_gross: number | null
          total_hours: number | null
          total_net: number | null
          total_overtime_hours: number | null
          total_pension: number | null
          total_social_premiums: number | null
          total_tax_withheld: number | null
          total_vacation_money: number | null
          updated_at: string
          year: number
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          employee_id: string
          generated_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          pdf_url?: string | null
          sent_at?: string | null
          status?: string
          total_allowances?: number | null
          total_deductions?: number | null
          total_gross?: number | null
          total_hours?: number | null
          total_net?: number | null
          total_overtime_hours?: number | null
          total_pension?: number | null
          total_social_premiums?: number | null
          total_tax_withheld?: number | null
          total_vacation_money?: number | null
          updated_at?: string
          year: number
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          employee_id?: string
          generated_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          pdf_url?: string | null
          sent_at?: string | null
          status?: string
          total_allowances?: number | null
          total_deductions?: number | null
          total_gross?: number | null
          total_hours?: number | null
          total_net?: number | null
          total_overtime_hours?: number | null
          total_pension?: number | null
          total_social_premiums?: number | null
          total_tax_withheld?: number | null
          total_vacation_money?: number | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_statements_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_statements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_statements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "annual_statements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at: string
          id: string
          ip_address: string | null
          new_values: Json | null
          old_values: Json | null
          organization_id: string
          reason: string | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          organization_id: string
          reason?: string | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: string
          ip_address?: string | null
          new_values?: Json | null
          old_values?: Json | null
          organization_id?: string
          reason?: string | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_campaigns: {
        Row: {
          channel: Database["public"]["Enums"]["communication_channel"]
          completed_at: string | null
          created_at: string
          created_by: string | null
          email_subject: string | null
          email_template_id: string | null
          failed_count: number
          id: string
          message_template: string
          name: string
          opted_out_count: number
          organization_id: string
          rate_limit_per_hour: number
          rate_limit_per_minute: number
          scheduled_at: string | null
          segment_filter: Json | null
          sent_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          total_recipients: number
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["communication_channel"]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          email_subject?: string | null
          email_template_id?: string | null
          failed_count?: number
          id?: string
          message_template: string
          name: string
          opted_out_count?: number
          organization_id: string
          rate_limit_per_hour?: number
          rate_limit_per_minute?: number
          scheduled_at?: string | null
          segment_filter?: Json | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_recipients?: number
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["communication_channel"]
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          email_subject?: string | null
          email_template_id?: string | null
          failed_count?: number
          id?: string
          message_template?: string
          name?: string
          opted_out_count?: number
          organization_id?: string
          rate_limit_per_hour?: number
          rate_limit_per_minute?: number
          scheduled_at?: string | null
          segment_filter?: Json | null
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_recipients?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_campaigns_email_template_id_fkey"
            columns: ["email_template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          candidate_id: string
          communication_id: string | null
          created_at: string
          error_message: string | null
          id: string
          organization_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["campaign_recipient_status"]
        }
        Insert: {
          campaign_id: string
          candidate_id: string
          communication_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_recipient_status"]
        }
        Update: {
          campaign_id?: string
          candidate_id?: string
          communication_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          organization_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["campaign_recipient_status"]
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "bulk_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_communication_id_fkey"
            columns: ["communication_id"]
            isOneToOne: false
            referencedRelation: "communications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_employment: {
        Row: {
          candidate_id: string
          contract_hours: number | null
          contract_type: string | null
          created_at: string | null
          end_date: string | null
          end_reason: string | null
          id: string
          insurance_notes: string | null
          insurance_type: string | null
          is_current: boolean | null
          notes: string | null
          organization_id: string
          pay_frequency: string | null
          pension_scheme: string | null
          pension_start_date: string | null
          senior_days: number | null
          start_date: string
          updated_at: string | null
          vacation_days_total: number | null
          vacation_days_used: number | null
          vacation_money_percentage: number | null
        }
        Insert: {
          candidate_id: string
          contract_hours?: number | null
          contract_type?: string | null
          created_at?: string | null
          end_date?: string | null
          end_reason?: string | null
          id?: string
          insurance_notes?: string | null
          insurance_type?: string | null
          is_current?: boolean | null
          notes?: string | null
          organization_id: string
          pay_frequency?: string | null
          pension_scheme?: string | null
          pension_start_date?: string | null
          senior_days?: number | null
          start_date: string
          updated_at?: string | null
          vacation_days_total?: number | null
          vacation_days_used?: number | null
          vacation_money_percentage?: number | null
        }
        Update: {
          candidate_id?: string
          contract_hours?: number | null
          contract_type?: string | null
          created_at?: string | null
          end_date?: string | null
          end_reason?: string | null
          id?: string
          insurance_notes?: string | null
          insurance_type?: string | null
          is_current?: boolean | null
          notes?: string | null
          organization_id?: string
          pay_frequency?: string | null
          pension_scheme?: string | null
          pension_start_date?: string | null
          senior_days?: number | null
          start_date?: string
          updated_at?: string | null
          vacation_days_total?: number | null
          vacation_days_used?: number | null
          vacation_money_percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_employment_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_employment_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_profile_tokens: {
        Row: {
          candidate_id: string
          created_at: string
          expires_at: string
          id: string
          last_accessed_at: string | null
          organization_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          candidate_id: string
          created_at?: string
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          organization_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          candidate_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_accessed_at?: string | null
          organization_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_profile_tokens_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_profile_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_signup_links: {
        Row: {
          created_at: string
          current_signups: number | null
          description: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          max_signups: number | null
          organization_id: string
          show_availability: boolean | null
          show_cv_upload: boolean | null
          show_drivers_license: boolean | null
          show_languages: boolean | null
          show_nationality: boolean | null
          slug: string
          source_tag: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_signups?: number | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_signups?: number | null
          organization_id: string
          show_availability?: boolean | null
          show_cv_upload?: boolean | null
          show_drivers_license?: boolean | null
          show_languages?: boolean | null
          show_nationality?: boolean | null
          slug: string
          source_tag?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_signups?: number | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          max_signups?: number | null
          organization_id?: string
          show_availability?: boolean | null
          show_cv_upload?: boolean | null
          show_drivers_license?: boolean | null
          show_languages?: boolean | null
          show_nationality?: boolean | null
          slug?: string
          source_tag?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_signup_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_postal: string | null
          address_street: string | null
          ai_analysis: Json | null
          ai_analyzed_at: string | null
          ai_classification: string | null
          ai_function_group: string | null
          ai_interview_questions: string[] | null
          ai_languages: Json | null
          ai_positive_signals: string[] | null
          ai_red_flags: string[] | null
          ai_reliability_score: number | null
          ai_risk_factors: string[] | null
          ai_stability: string | null
          ai_status: string | null
          ai_summary: string | null
          ai_target_functions: string[] | null
          auth_user_id: string | null
          availability_notes: string | null
          bank_account_holder: string | null
          birth_country: string | null
          birth_place: string | null
          bsn: string | null
          certifications: string[] | null
          compliance_status: Database["public"]["Enums"]["compliance_status"]
          created_at: string
          cv_file_url: string | null
          cv_raw_text: string | null
          date_of_birth: string | null
          drivers_license_expiry: string | null
          email: string | null
          employee_number: string | null
          employee_status: string | null
          external_id: string | null
          first_name: string
          gender: string | null
          has_drivers_license: boolean | null
          iban: string | null
          id: string
          id_document_number: string | null
          id_document_type: string | null
          id_document_valid_until: string | null
          initials: string | null
          languages: string[] | null
          last_name: string
          marital_status: string | null
          middle_name: string | null
          nationality: string | null
          notes: string | null
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          organization_id: string
          phone: string | null
          portal_activated_at: string | null
          portal_enabled: boolean | null
          portal_language: string | null
          portal_last_login: string | null
          signup_link_id: string | null
          skills: string[] | null
          source: string | null
          status: Database["public"]["Enums"]["candidate_status"]
          updated_at: string
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_postal?: string | null
          address_street?: string | null
          ai_analysis?: Json | null
          ai_analyzed_at?: string | null
          ai_classification?: string | null
          ai_function_group?: string | null
          ai_interview_questions?: string[] | null
          ai_languages?: Json | null
          ai_positive_signals?: string[] | null
          ai_red_flags?: string[] | null
          ai_reliability_score?: number | null
          ai_risk_factors?: string[] | null
          ai_stability?: string | null
          ai_status?: string | null
          ai_summary?: string | null
          ai_target_functions?: string[] | null
          auth_user_id?: string | null
          availability_notes?: string | null
          bank_account_holder?: string | null
          birth_country?: string | null
          birth_place?: string | null
          bsn?: string | null
          certifications?: string[] | null
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          cv_file_url?: string | null
          cv_raw_text?: string | null
          date_of_birth?: string | null
          drivers_license_expiry?: string | null
          email?: string | null
          employee_number?: string | null
          employee_status?: string | null
          external_id?: string | null
          first_name: string
          gender?: string | null
          has_drivers_license?: boolean | null
          iban?: string | null
          id?: string
          id_document_number?: string | null
          id_document_type?: string | null
          id_document_valid_until?: string | null
          initials?: string | null
          languages?: string[] | null
          last_name: string
          marital_status?: string | null
          middle_name?: string | null
          nationality?: string | null
          notes?: string | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          organization_id: string
          phone?: string | null
          portal_activated_at?: string | null
          portal_enabled?: boolean | null
          portal_language?: string | null
          portal_last_login?: string | null
          signup_link_id?: string | null
          skills?: string[] | null
          source?: string | null
          status?: Database["public"]["Enums"]["candidate_status"]
          updated_at?: string
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_postal?: string | null
          address_street?: string | null
          ai_analysis?: Json | null
          ai_analyzed_at?: string | null
          ai_classification?: string | null
          ai_function_group?: string | null
          ai_interview_questions?: string[] | null
          ai_languages?: Json | null
          ai_positive_signals?: string[] | null
          ai_red_flags?: string[] | null
          ai_reliability_score?: number | null
          ai_risk_factors?: string[] | null
          ai_stability?: string | null
          ai_status?: string | null
          ai_summary?: string | null
          ai_target_functions?: string[] | null
          auth_user_id?: string | null
          availability_notes?: string | null
          bank_account_holder?: string | null
          birth_country?: string | null
          birth_place?: string | null
          bsn?: string | null
          certifications?: string[] | null
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          cv_file_url?: string | null
          cv_raw_text?: string | null
          date_of_birth?: string | null
          drivers_license_expiry?: string | null
          email?: string | null
          employee_number?: string | null
          employee_status?: string | null
          external_id?: string | null
          first_name?: string
          gender?: string | null
          has_drivers_license?: boolean | null
          iban?: string | null
          id?: string
          id_document_number?: string | null
          id_document_type?: string | null
          id_document_valid_until?: string | null
          initials?: string | null
          languages?: string[] | null
          last_name?: string
          marital_status?: string | null
          middle_name?: string | null
          nationality?: string | null
          notes?: string | null
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          organization_id?: string
          phone?: string | null
          portal_activated_at?: string | null
          portal_enabled?: boolean | null
          portal_language?: string | null
          portal_last_login?: string | null
          signup_link_id?: string | null
          skills?: string[] | null
          source?: string | null
          status?: Database["public"]["Enums"]["candidate_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidates_signup_link_id_fkey"
            columns: ["signup_link_id"]
            isOneToOne: false
            referencedRelation: "candidate_signup_links"
            referencedColumns: ["id"]
          },
        ]
      }
      client_errors: {
        Row: {
          component_stack: string | null
          created_at: string | null
          error_message: string
          id: string
          metadata: Json | null
          organization_id: string | null
          stack_trace: string | null
          url: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          component_stack?: string | null
          created_at?: string | null
          error_message: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          stack_trace?: string | null
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          component_stack?: string | null
          created_at?: string | null
          error_message?: string
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          stack_trace?: string | null
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_errors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_preferences: {
        Row: {
          candidate_id: string
          channel: Database["public"]["Enums"]["communication_channel"]
          created_at: string
          id: string
          opted_out: boolean
          opted_out_at: string | null
          opted_out_reason: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          channel: Database["public"]["Enums"]["communication_channel"]
          created_at?: string
          id?: string
          opted_out?: boolean
          opted_out_at?: string | null
          opted_out_reason?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          channel?: Database["public"]["Enums"]["communication_channel"]
          created_at?: string
          id?: string
          opted_out?: boolean
          opted_out_at?: string | null
          opted_out_reason?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_preferences_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communications: {
        Row: {
          body: string | null
          call_duration_seconds: number | null
          candidate_id: string | null
          channel: Database["public"]["Enums"]["communication_channel"]
          company_contact_id: string | null
          company_id: string | null
          created_at: string
          direction: string
          email_attachments: Json | null
          email_cc: string[] | null
          email_conversation_id: string | null
          email_from: string | null
          email_message_id: string | null
          email_to: string[] | null
          id: string
          organization_id: string
          recording_url: string | null
          sent_at: string
          sent_by: string | null
          subject: string | null
          transcription: string | null
          whatsapp_message_id: string | null
          whatsapp_status: string | null
        }
        Insert: {
          body?: string | null
          call_duration_seconds?: number | null
          candidate_id?: string | null
          channel: Database["public"]["Enums"]["communication_channel"]
          company_contact_id?: string | null
          company_id?: string | null
          created_at?: string
          direction?: string
          email_attachments?: Json | null
          email_cc?: string[] | null
          email_conversation_id?: string | null
          email_from?: string | null
          email_message_id?: string | null
          email_to?: string[] | null
          id?: string
          organization_id: string
          recording_url?: string | null
          sent_at?: string
          sent_by?: string | null
          subject?: string | null
          transcription?: string | null
          whatsapp_message_id?: string | null
          whatsapp_status?: string | null
        }
        Update: {
          body?: string | null
          call_duration_seconds?: number | null
          candidate_id?: string | null
          channel?: Database["public"]["Enums"]["communication_channel"]
          company_contact_id?: string | null
          company_id?: string | null
          created_at?: string
          direction?: string
          email_attachments?: Json | null
          email_cc?: string[] | null
          email_conversation_id?: string | null
          email_from?: string | null
          email_message_id?: string | null
          email_to?: string[] | null
          id?: string
          organization_id?: string
          recording_url?: string | null
          sent_at?: string
          sent_by?: string | null
          subject?: string | null
          transcription?: string | null
          whatsapp_message_id?: string | null
          whatsapp_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_company_contact_id_fkey"
            columns: ["company_contact_id"]
            isOneToOne: false
            referencedRelation: "company_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communications_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_lat: number | null
          address_lng: number | null
          address_postal: string | null
          address_street: string | null
          authorized_signatory: string | null
          bank_account_holder: string | null
          btw_number: string | null
          cao: string | null
          created_at: string
          email: string | null
          exact_account_id: string | null
          iban: string | null
          id: string
          invoice_address_city: string | null
          invoice_address_country: string | null
          invoice_address_postal: string | null
          invoice_address_street: string | null
          invoice_cc: string | null
          invoice_company_name: string | null
          invoice_email: string | null
          is_active: boolean
          kvk_number: string | null
          language: string | null
          legal_form: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          sbi_codes: string[] | null
          updated_at: string
          vat_rate: number | null
          visit_address_city: string | null
          visit_address_country: string | null
          visit_address_postal: string | null
          visit_address_street: string | null
          website: string | null
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_lat?: number | null
          address_lng?: number | null
          address_postal?: string | null
          address_street?: string | null
          authorized_signatory?: string | null
          bank_account_holder?: string | null
          btw_number?: string | null
          cao?: string | null
          created_at?: string
          email?: string | null
          exact_account_id?: string | null
          iban?: string | null
          id?: string
          invoice_address_city?: string | null
          invoice_address_country?: string | null
          invoice_address_postal?: string | null
          invoice_address_street?: string | null
          invoice_cc?: string | null
          invoice_company_name?: string | null
          invoice_email?: string | null
          is_active?: boolean
          kvk_number?: string | null
          language?: string | null
          legal_form?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          sbi_codes?: string[] | null
          updated_at?: string
          vat_rate?: number | null
          visit_address_city?: string | null
          visit_address_country?: string | null
          visit_address_postal?: string | null
          visit_address_street?: string | null
          website?: string | null
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_lat?: number | null
          address_lng?: number | null
          address_postal?: string | null
          address_street?: string | null
          authorized_signatory?: string | null
          bank_account_holder?: string | null
          btw_number?: string | null
          cao?: string | null
          created_at?: string
          email?: string | null
          exact_account_id?: string | null
          iban?: string | null
          id?: string
          invoice_address_city?: string | null
          invoice_address_country?: string | null
          invoice_address_postal?: string | null
          invoice_address_street?: string | null
          invoice_cc?: string | null
          invoice_company_name?: string | null
          invoice_email?: string | null
          is_active?: boolean
          kvk_number?: string | null
          language?: string | null
          legal_form?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          sbi_codes?: string[] | null
          updated_at?: string
          vat_rate?: number | null
          visit_address_city?: string | null
          visit_address_country?: string | null
          visit_address_postal?: string | null
          visit_address_street?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_contacts: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string
          function_title: string | null
          id: string
          is_primary: boolean
          last_name: string | null
          linkedin_url: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          role: Database["public"]["Enums"]["contact_role"] | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name: string
          function_title?: string | null
          id?: string
          is_primary?: boolean
          last_name?: string | null
          linkedin_url?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["contact_role"] | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string
          function_title?: string | null
          id?: string
          is_primary?: boolean
          last_name?: string | null
          linkedin_url?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["contact_role"] | null
        }
        Relationships: [
          {
            foreignKeyName: "company_contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_functions: {
        Row: {
          company_id: string
          created_at: string
          default_hourly_rate: number | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          default_hourly_rate?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          default_hourly_rate?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_functions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_functions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_sla: {
        Row: {
          company_id: string
          created_at: string
          description: string
          id: string
          notes: string | null
          organization_id: string
          response_time_hours: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          description: string
          id?: string
          notes?: string | null
          organization_id: string
          response_time_hours?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string
          id?: string
          notes?: string | null
          organization_id?: string
          response_time_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "company_sla_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_sla_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_rules: {
        Row: {
          contract_type: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          required_documents: string[]
          required_fields: string[]
          sector: string | null
        }
        Insert: {
          contract_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          required_documents?: string[]
          required_fields?: string[]
          sector?: string | null
        }
        Update: {
          contract_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          required_documents?: string[]
          required_fields?: string[]
          sector?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_templates: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          candidate_id: string | null
          content: string
          created_at: string
          created_by: string | null
          employee_id: string
          id: string
          organization_id: string
          pdf_url: string | null
          sent_at: string | null
          sign_token: string | null
          signed_at: string | null
          status: Database["public"]["Enums"]["contract_status"]
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          candidate_id?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          id?: string
          organization_id: string
          pdf_url?: string | null
          sent_at?: string | null
          sign_token?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          id?: string
          organization_id?: string
          pdf_url?: string | null
          sent_at?: string | null
          sign_token?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["contract_status"]
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_values: {
        Row: {
          created_at: string | null
          custom_field_id: string
          entity_id: string
          id: string
          organization_id: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          created_at?: string | null
          custom_field_id: string
          entity_id: string
          id?: string
          organization_id: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string | null
          custom_field_id?: string
          entity_id?: string
          id?: string
          organization_id?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_field_values_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          created_at: string | null
          entity_type: string
          field_label: string
          field_name: string
          field_type: string
          id: string
          is_active: boolean | null
          is_required: boolean | null
          options: Json | null
          organization_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          entity_type: string
          field_label: string
          field_name: string
          field_type: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          options?: Json | null
          organization_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          entity_type?: string
          field_label?: string
          field_name?: string
          field_type?: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          options?: Json | null
          organization_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_verification_result: Json | null
          candidate_id: string
          created_at: string
          employee_id: string | null
          expiry_date: string | null
          file_path: string | null
          id: string
          issued_date: string | null
          name: string
          notes: string | null
          organization_id: string
          source: string | null
          status: Database["public"]["Enums"]["document_status"]
          type: Database["public"]["Enums"]["document_type"]
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          ai_verification_result?: Json | null
          candidate_id: string
          created_at?: string
          employee_id?: string | null
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          issued_date?: string | null
          name: string
          notes?: string | null
          organization_id: string
          source?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          type: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          ai_verification_result?: Json | null
          candidate_id?: string
          created_at?: string
          employee_id?: string | null
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          issued_date?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          source?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          type?: Database["public"]["Enums"]["document_type"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          body_json: string | null
          category: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          subject: string
          updated_at: string
          variables_used: string[] | null
        }
        Insert: {
          body_html?: string
          body_json?: string | null
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          subject: string
          updated_at?: string
          variables_used?: string[] | null
        }
        Update: {
          body_html?: string
          body_json?: string | null
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          subject?: string
          updated_at?: string
          variables_used?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_deductions: {
        Row: {
          amount: number
          candidate_id: string | null
          category: string
          created_at: string
          deducted_amount: number | null
          description: string
          employee_id: string
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          start_date: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          amount: number
          candidate_id?: string | null
          category?: string
          created_at?: string
          deducted_amount?: number | null
          description: string
          employee_id: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          start_date?: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number
          candidate_id?: string | null
          category?: string
          created_at?: string
          deducted_amount?: number | null
          description?: string
          employee_id?: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          start_date?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_deductions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_deductions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_deductions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_deductions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_notifications: {
        Row: {
          candidate_id: string | null
          company_id: string | null
          created_at: string
          due_date: string | null
          employee_id: string | null
          id: string
          is_dismissed: boolean | null
          is_read: boolean | null
          message: string | null
          organization_id: string
          read_at: string | null
          read_by: string | null
          reference_id: string | null
          reference_table: string | null
          severity: string | null
          title: string
          type: string
        }
        Insert: {
          candidate_id?: string | null
          company_id?: string | null
          created_at?: string
          due_date?: string | null
          employee_id?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          message?: string | null
          organization_id: string
          read_at?: string | null
          read_by?: string | null
          reference_id?: string | null
          reference_table?: string | null
          severity?: string | null
          title: string
          type: string
        }
        Update: {
          candidate_id?: string | null
          company_id?: string | null
          created_at?: string
          due_date?: string | null
          employee_id?: string | null
          id?: string
          is_dismissed?: boolean | null
          is_read?: boolean | null
          message?: string | null
          organization_id?: string
          read_at?: string | null
          read_by?: string | null
          reference_id?: string | null
          reference_table?: string | null
          severity?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_notifications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notifications_read_by_fkey"
            columns: ["read_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_reservations: {
        Row: {
          calculation_base: string | null
          candidate_id: string | null
          category: string
          created_at: string
          description: string
          employee_id: string
          end_date: string | null
          fixed_amount: number | null
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          percentage: number | null
          start_date: string
          updated_at: string
        }
        Insert: {
          calculation_base?: string | null
          candidate_id?: string | null
          category?: string
          created_at?: string
          description: string
          employee_id: string
          end_date?: string | null
          fixed_amount?: number | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          percentage?: number | null
          start_date?: string
          updated_at?: string
        }
        Update: {
          calculation_base?: string | null
          candidate_id?: string | null
          category?: string
          created_at?: string
          description?: string
          employee_id?: string
          end_date?: string | null
          fixed_amount?: number | null
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          percentage?: number | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_reservations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_reservations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_reservations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_subsidies: {
        Row: {
          amount_per_hour: number | null
          candidate_id: string | null
          created_at: string
          description: string | null
          employee_id: string
          end_date: string | null
          id: string
          is_active: boolean
          max_annual_amount: number | null
          notes: string | null
          organization_id: string
          start_date: string
          type: string
          updated_at: string
        }
        Insert: {
          amount_per_hour?: number | null
          candidate_id?: string | null
          created_at?: string
          description?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          max_annual_amount?: number | null
          notes?: string | null
          organization_id: string
          start_date: string
          type: string
          updated_at?: string
        }
        Update: {
          amount_per_hour?: number | null
          candidate_id?: string | null
          created_at?: string
          description?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          max_annual_amount?: number | null
          notes?: string | null
          organization_id?: string
          start_date?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_subsidies_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_subsidies_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_subsidies_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "employee_subsidies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          auth_user_id: string | null
          candidate_id: string
          contract_hours: number | null
          contract_type: string | null
          created_at: string
          employee_number: string | null
          end_date: string | null
          end_reason: string | null
          id: string
          insurance_notes: string | null
          insurance_type: string | null
          notes: string | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          organization_id: string
          pay_frequency: string | null
          pension_scheme: string | null
          pension_start_date: string | null
          portal_activated_at: string | null
          portal_enabled: boolean | null
          portal_language: string | null
          portal_last_login: string | null
          senior_days: number | null
          start_date: string
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
          vacation_days_total: number | null
          vacation_days_used: number | null
          vacation_money_percentage: number | null
        }
        Insert: {
          auth_user_id?: string | null
          candidate_id: string
          contract_hours?: number | null
          contract_type?: string | null
          created_at?: string
          employee_number?: string | null
          end_date?: string | null
          end_reason?: string | null
          id?: string
          insurance_notes?: string | null
          insurance_type?: string | null
          notes?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          organization_id: string
          pay_frequency?: string | null
          pension_scheme?: string | null
          pension_start_date?: string | null
          portal_activated_at?: string | null
          portal_enabled?: boolean | null
          portal_language?: string | null
          portal_last_login?: string | null
          senior_days?: number | null
          start_date: string
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          vacation_days_total?: number | null
          vacation_days_used?: number | null
          vacation_money_percentage?: number | null
        }
        Update: {
          auth_user_id?: string | null
          candidate_id?: string
          contract_hours?: number | null
          contract_type?: string | null
          created_at?: string
          employee_number?: string | null
          end_date?: string | null
          end_reason?: string | null
          id?: string
          insurance_notes?: string | null
          insurance_type?: string | null
          notes?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          organization_id?: string
          pay_frequency?: string | null
          pension_scheme?: string | null
          pension_start_date?: string | null
          portal_activated_at?: string | null
          portal_enabled?: boolean | null
          portal_language?: string | null
          portal_last_login?: string | null
          senior_days?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
          vacation_days_total?: number | null
          vacation_days_used?: number | null
          vacation_money_percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exact_config: {
        Row: {
          base_url: string | null
          company_name: string | null
          created_at: string
          division: number | null
          id: string
          is_active: boolean
          organization_id: string
          region: string | null
          tenant_id: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          base_url?: string | null
          company_name?: string | null
          created_at?: string
          division?: number | null
          id?: string
          is_active?: boolean
          organization_id: string
          region?: string | null
          tenant_id?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          base_url?: string | null
          company_name?: string | null
          created_at?: string
          division?: number | null
          id?: string
          is_active?: boolean
          organization_id?: string
          region?: string | null
          tenant_id?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exact_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exact_glaccount_mappings: {
        Row: {
          created_at: string
          description: string | null
          gl_account_code: string | null
          gl_account_id: string
          hour_type_code: string
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          gl_account_code?: string | null
          gl_account_id: string
          hour_type_code: string
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          gl_account_code?: string | null
          gl_account_id?: string
          hour_type_code?: string
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exact_glaccount_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_mappings: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          external_id: string
          external_system: string
          id: string
          metadata: Json | null
          organization_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          external_id: string
          external_system: string
          id?: string
          metadata?: Json | null
          organization_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          external_id?: string
          external_system?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_card_transactions: {
        Row: {
          amount_eur: number
          candidate_id: string | null
          created_at: string
          employee_id: string | null
          flag_excessive_consumption: boolean | null
          flag_multiple_same_day: boolean | null
          flag_notes: string | null
          flag_over_capacity: boolean | null
          fuel_card_reference: string
          id: string
          import_batch_id: string | null
          license_plate: string | null
          liters: number
          organization_id: string
          price_per_liter: number | null
          raw_data: Json | null
          reviewed: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          station_location: string | null
          station_name: string | null
          transaction_date: string
          vehicle_id: string | null
        }
        Insert: {
          amount_eur: number
          candidate_id?: string | null
          created_at?: string
          employee_id?: string | null
          flag_excessive_consumption?: boolean | null
          flag_multiple_same_day?: boolean | null
          flag_notes?: string | null
          flag_over_capacity?: boolean | null
          fuel_card_reference: string
          id?: string
          import_batch_id?: string | null
          license_plate?: string | null
          liters: number
          organization_id: string
          price_per_liter?: number | null
          raw_data?: Json | null
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          station_location?: string | null
          station_name?: string | null
          transaction_date: string
          vehicle_id?: string | null
        }
        Update: {
          amount_eur?: number
          candidate_id?: string | null
          created_at?: string
          employee_id?: string | null
          flag_excessive_consumption?: boolean | null
          flag_multiple_same_day?: boolean | null
          flag_notes?: string | null
          flag_over_capacity?: boolean | null
          fuel_card_reference?: string
          id?: string
          import_batch_id?: string | null
          license_plate?: string | null
          liters?: number
          organization_id?: string
          price_per_liter?: number | null
          raw_data?: Json | null
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          station_location?: string | null
          station_name?: string | null
          transaction_date?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fuel_card_transactions_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_card_transactions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_card_transactions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "fuel_card_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_card_transactions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_card_transactions_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      hour_letters: {
        Row: {
          allowances_total: number | null
          approved_at: string | null
          approved_by: string | null
          candidate_id: string | null
          created_at: string
          deductions_total: number | null
          employee_id: string
          id: string
          line_items: Json | null
          notes: string | null
          organization_id: string
          overtime_hours: number | null
          pdf_url: string | null
          placement_id: string | null
          reservations_total: number | null
          status: string
          total_hours: number | null
          total_km: number | null
          updated_at: string
          week_number: number
          year: number
        }
        Insert: {
          allowances_total?: number | null
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string | null
          created_at?: string
          deductions_total?: number | null
          employee_id: string
          id?: string
          line_items?: Json | null
          notes?: string | null
          organization_id: string
          overtime_hours?: number | null
          pdf_url?: string | null
          placement_id?: string | null
          reservations_total?: number | null
          status?: string
          total_hours?: number | null
          total_km?: number | null
          updated_at?: string
          week_number: number
          year: number
        }
        Update: {
          allowances_total?: number | null
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string | null
          created_at?: string
          deductions_total?: number | null
          employee_id?: string
          id?: string
          line_items?: Json | null
          notes?: string | null
          organization_id?: string
          overtime_hours?: number | null
          pdf_url?: string | null
          placement_id?: string | null
          reservations_total?: number | null
          status?: string
          total_hours?: number | null
          total_km?: number | null
          updated_at?: string
          week_number?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "hour_letters_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hour_letters_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hour_letters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hour_letters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "hour_letters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hour_letters_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hour_letters_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
        ]
      }
      housing_assignments: {
        Row: {
          candidate_id: string | null
          check_in_date: string
          check_out_date: string | null
          created_at: string
          deduction_amount: number | null
          deposit_paid: boolean
          employee_id: string
          id: string
          monthly_deduction: number | null
          notes: string | null
          organization_id: string
          payment_frequency: string | null
          rent_paid_until: string | null
          status: Database["public"]["Enums"]["housing_assignment_status"]
          unit_id: string
          updated_at: string
        }
        Insert: {
          candidate_id?: string | null
          check_in_date: string
          check_out_date?: string | null
          created_at?: string
          deduction_amount?: number | null
          deposit_paid?: boolean
          employee_id: string
          id?: string
          monthly_deduction?: number | null
          notes?: string | null
          organization_id: string
          payment_frequency?: string | null
          rent_paid_until?: string | null
          status?: Database["public"]["Enums"]["housing_assignment_status"]
          unit_id: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string | null
          check_in_date?: string
          check_out_date?: string | null
          created_at?: string
          deduction_amount?: number | null
          deposit_paid?: boolean
          employee_id?: string
          id?: string
          monthly_deduction?: number | null
          notes?: string | null
          organization_id?: string
          payment_frequency?: string | null
          rent_paid_until?: string | null
          status?: Database["public"]["Enums"]["housing_assignment_status"]
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "housing_assignments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "housing_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_assignments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_assignments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_occupancy"
            referencedColumns: ["unit_id"]
          },
        ]
      }
      housing_inspections: {
        Row: {
          condition_notes: string | null
          condition_rating: number | null
          confirmed_at: string | null
          confirmed_by_resident: boolean | null
          created_at: string
          description: string
          housing_assignment_id: string | null
          id: string
          inspected_by: string | null
          inspection_date: string
          inspection_type: Database["public"]["Enums"]["inspection_type"] | null
          notes: string | null
          organization_id: string
          photo_bathroom: string | null
          photo_damage: string | null
          photo_kitchen: string | null
          photo_mattress: string | null
          photo_room_overview: string | null
          photos: string[] | null
          property_id: string | null
          resolved: boolean
          resolved_at: string | null
          unit_id: string | null
        }
        Insert: {
          condition_notes?: string | null
          condition_rating?: number | null
          confirmed_at?: string | null
          confirmed_by_resident?: boolean | null
          created_at?: string
          description: string
          housing_assignment_id?: string | null
          id?: string
          inspected_by?: string | null
          inspection_date: string
          inspection_type?:
            | Database["public"]["Enums"]["inspection_type"]
            | null
          notes?: string | null
          organization_id: string
          photo_bathroom?: string | null
          photo_damage?: string | null
          photo_kitchen?: string | null
          photo_mattress?: string | null
          photo_room_overview?: string | null
          photos?: string[] | null
          property_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          unit_id?: string | null
        }
        Update: {
          condition_notes?: string | null
          condition_rating?: number | null
          confirmed_at?: string | null
          confirmed_by_resident?: boolean | null
          created_at?: string
          description?: string
          housing_assignment_id?: string | null
          id?: string
          inspected_by?: string | null
          inspection_date?: string
          inspection_type?:
            | Database["public"]["Enums"]["inspection_type"]
            | null
          notes?: string | null
          organization_id?: string
          photo_bathroom?: string | null
          photo_damage?: string | null
          photo_kitchen?: string | null
          photo_mattress?: string | null
          photo_room_overview?: string | null
          photos?: string[] | null
          property_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "housing_inspections_housing_assignment_id_fkey"
            columns: ["housing_assignment_id"]
            isOneToOne: false
            referencedRelation: "housing_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_inspections_inspected_by_fkey"
            columns: ["inspected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_inspections_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_inspections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_inspections_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_occupancy"
            referencedColumns: ["unit_id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          allowances_amount: number
          candidate_id: string | null
          created_at: string
          description: string
          employee_id: string | null
          hourly_rate: number
          hours: number
          id: string
          invoice_id: string
          line_total: number
          organization_id: string
          overtime_hours: number
          overtime_rate: number
          placement_id: string | null
          sort_order: number
          surcharge_amount: number
          travel_amount: number
        }
        Insert: {
          allowances_amount?: number
          candidate_id?: string | null
          created_at?: string
          description: string
          employee_id?: string | null
          hourly_rate?: number
          hours?: number
          id?: string
          invoice_id: string
          line_total?: number
          organization_id: string
          overtime_hours?: number
          overtime_rate?: number
          placement_id?: string | null
          sort_order?: number
          surcharge_amount?: number
          travel_amount?: number
        }
        Update: {
          allowances_amount?: number
          candidate_id?: string | null
          created_at?: string
          description?: string
          employee_id?: string | null
          hourly_rate?: number
          hours?: number
          id?: string
          invoice_id?: string
          line_total?: number
          organization_id?: string
          overtime_hours?: number
          overtime_rate?: number
          placement_id?: string | null
          sort_order?: number
          surcharge_amount?: number
          travel_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          next_number: number
          organization_id: string
          prefix: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          organization_id: string
          prefix?: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          organization_id?: string
          prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          exact_invoice_id: string | null
          exact_sync_error: string | null
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          organization_id: string
          paid_amount: number
          paid_at: string | null
          pdf_url: string | null
          period_end: string
          period_start: string
          reference: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          total: number
          updated_at: string
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          exact_invoice_id?: string | null
          exact_sync_error?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          notes?: string | null
          organization_id: string
          paid_amount?: number
          paid_at?: string | null
          pdf_url?: string | null
          period_end: string
          period_start: string
          reference?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          exact_invoice_id?: string | null
          exact_sync_error?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          organization_id?: string
          paid_amount?: number
          paid_at?: string | null
          pdf_url?: string | null
          period_end?: string
          period_start?: string
          reference?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_import_logs: {
        Row: {
          filters_used: Json | null
          id: string
          imported_at: string
          new_jobs: number
          organization_id: string
          status: string
          total_jobs: number
        }
        Insert: {
          filters_used?: Json | null
          id?: string
          imported_at?: string
          new_jobs?: number
          organization_id: string
          status?: string
          total_jobs?: number
        }
        Update: {
          filters_used?: Json | null
          id?: string
          imported_at?: string
          new_jobs?: number
          organization_id?: string
          status?: string
          total_jobs?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_import_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_listings: {
        Row: {
          ai_benefits: string[] | null
          ai_core_responsibilities: string | null
          ai_education_requirements: string[] | null
          ai_employment_type: string[] | null
          ai_experience_level: string | null
          ai_hiring_manager_email: string | null
          ai_hiring_manager_name: string | null
          ai_key_skills: string[] | null
          ai_keywords: string[] | null
          ai_requirements_summary: string | null
          ai_salary_currency: string | null
          ai_salary_max: number | null
          ai_salary_min: number | null
          ai_salary_unit: string | null
          ai_taxonomies: string[] | null
          ai_visa_sponsorship: boolean | null
          ai_working_hours: number | null
          city: string | null
          country: string | null
          date_imported: string
          date_posted: string | null
          description_text: string | null
          domain_derived: string | null
          employment_type: string[] | null
          external_id: string
          id: string
          linkedin_org_description: string | null
          linkedin_org_employees: number | null
          linkedin_org_followers: number | null
          linkedin_org_founded_date: string | null
          linkedin_org_headquarters: string | null
          linkedin_org_industry: string | null
          linkedin_org_recruitment_agency: boolean | null
          linkedin_org_size: string | null
          linkedin_org_slug: string | null
          linkedin_org_specialties: string[] | null
          linkedin_org_type: string | null
          linkedin_org_url: string | null
          locations_derived: Json | null
          organization_id: string
          organization_logo: string | null
          organization_name: string | null
          organization_url: string | null
          raw_data: Json | null
          remote_derived: boolean | null
          source: string | null
          source_type: string | null
          title: string
          url: string | null
          work_arrangement: string | null
        }
        Insert: {
          ai_benefits?: string[] | null
          ai_core_responsibilities?: string | null
          ai_education_requirements?: string[] | null
          ai_employment_type?: string[] | null
          ai_experience_level?: string | null
          ai_hiring_manager_email?: string | null
          ai_hiring_manager_name?: string | null
          ai_key_skills?: string[] | null
          ai_keywords?: string[] | null
          ai_requirements_summary?: string | null
          ai_salary_currency?: string | null
          ai_salary_max?: number | null
          ai_salary_min?: number | null
          ai_salary_unit?: string | null
          ai_taxonomies?: string[] | null
          ai_visa_sponsorship?: boolean | null
          ai_working_hours?: number | null
          city?: string | null
          country?: string | null
          date_imported?: string
          date_posted?: string | null
          description_text?: string | null
          domain_derived?: string | null
          employment_type?: string[] | null
          external_id: string
          id?: string
          linkedin_org_description?: string | null
          linkedin_org_employees?: number | null
          linkedin_org_followers?: number | null
          linkedin_org_founded_date?: string | null
          linkedin_org_headquarters?: string | null
          linkedin_org_industry?: string | null
          linkedin_org_recruitment_agency?: boolean | null
          linkedin_org_size?: string | null
          linkedin_org_slug?: string | null
          linkedin_org_specialties?: string[] | null
          linkedin_org_type?: string | null
          linkedin_org_url?: string | null
          locations_derived?: Json | null
          organization_id: string
          organization_logo?: string | null
          organization_name?: string | null
          organization_url?: string | null
          raw_data?: Json | null
          remote_derived?: boolean | null
          source?: string | null
          source_type?: string | null
          title: string
          url?: string | null
          work_arrangement?: string | null
        }
        Update: {
          ai_benefits?: string[] | null
          ai_core_responsibilities?: string | null
          ai_education_requirements?: string[] | null
          ai_employment_type?: string[] | null
          ai_experience_level?: string | null
          ai_hiring_manager_email?: string | null
          ai_hiring_manager_name?: string | null
          ai_key_skills?: string[] | null
          ai_keywords?: string[] | null
          ai_requirements_summary?: string | null
          ai_salary_currency?: string | null
          ai_salary_max?: number | null
          ai_salary_min?: number | null
          ai_salary_unit?: string | null
          ai_taxonomies?: string[] | null
          ai_visa_sponsorship?: boolean | null
          ai_working_hours?: number | null
          city?: string | null
          country?: string | null
          date_imported?: string
          date_posted?: string | null
          description_text?: string | null
          domain_derived?: string | null
          employment_type?: string[] | null
          external_id?: string
          id?: string
          linkedin_org_description?: string | null
          linkedin_org_employees?: number | null
          linkedin_org_followers?: number | null
          linkedin_org_founded_date?: string | null
          linkedin_org_headquarters?: string | null
          linkedin_org_industry?: string | null
          linkedin_org_recruitment_agency?: boolean | null
          linkedin_org_size?: string | null
          linkedin_org_slug?: string | null
          linkedin_org_specialties?: string[] | null
          linkedin_org_type?: string | null
          linkedin_org_url?: string | null
          locations_derived?: Json | null
          organization_id?: string
          organization_logo?: string | null
          organization_name?: string | null
          organization_url?: string | null
          raw_data?: Json | null
          remote_derived?: boolean | null
          source?: string | null
          source_type?: string | null
          title?: string
          url?: string | null
          work_arrangement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_listings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      key_registrations: {
        Row: {
          candidate_id: string | null
          employee_id: string
          id: string
          issued_at: string
          key_number: string
          notes: string | null
          organization_id: string
          returned_at: string | null
          unit_id: string
        }
        Insert: {
          candidate_id?: string | null
          employee_id: string
          id?: string
          issued_at?: string
          key_number: string
          notes?: string | null
          organization_id: string
          returned_at?: string | null
          unit_id: string
        }
        Update: {
          candidate_id?: string | null
          employee_id?: string
          id?: string
          issued_at?: string
          key_number?: string
          notes?: string | null
          organization_id?: string
          returned_at?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_registrations_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_registrations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_registrations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "key_registrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_registrations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_registrations_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "v_unit_occupancy"
            referencedColumns: ["unit_id"]
          },
        ]
      }
      knowledge_base: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          organization_id: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          organization_id: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          organization_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          match_reasoning: string | null
          match_score: number | null
          notes: string | null
          organization_id: string
          proposed_at: string
          proposed_by: string | null
          screening_completed_at: string | null
          screening_completed_by: string | null
          source: string | null
          status: Database["public"]["Enums"]["match_status"]
          status_changed_at: string | null
          updated_at: string
          vacancy_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          match_reasoning?: string | null
          match_score?: number | null
          notes?: string | null
          organization_id: string
          proposed_at?: string
          proposed_by?: string | null
          screening_completed_at?: string | null
          screening_completed_by?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          status_changed_at?: string | null
          updated_at?: string
          vacancy_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          match_reasoning?: string | null
          match_score?: number | null
          notes?: string | null
          organization_id?: string
          proposed_at?: string
          proposed_by?: string | null
          screening_completed_at?: string | null
          screening_completed_by?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["match_status"]
          status_changed_at?: string | null
          updated_at?: string
          vacancy_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_screening_completed_by_fkey"
            columns: ["screening_completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      microsoft_config: {
        Row: {
          access_token: string | null
          created_at: string
          id: string
          is_active: boolean
          microsoft_email: string | null
          microsoft_tenant_id: string | null
          microsoft_user_id: string | null
          organization_id: string
          refresh_token: string | null
          refreshing_at: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          microsoft_email?: string | null
          microsoft_tenant_id?: string | null
          microsoft_user_id?: string | null
          organization_id: string
          refresh_token?: string | null
          refreshing_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          microsoft_email?: string | null
          microsoft_tenant_id?: string | null
          microsoft_user_id?: string | null
          organization_id?: string
          refresh_token?: string | null
          refreshing_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "microsoft_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_entries: {
        Row: {
          candidate_id: string | null
          created_at: string
          employee_id: string
          end_km: number
          entry_date: string
          id: string
          is_private: boolean
          notes: string | null
          organization_id: string
          start_km: number
          vehicle_id: string
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          employee_id: string
          end_km: number
          entry_date: string
          id?: string
          is_private?: boolean
          notes?: string | null
          organization_id: string
          start_km: number
          vehicle_id: string
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          employee_id?: string
          end_km?: number
          entry_date?: string
          id?: string
          is_private?: boolean
          notes?: string | null
          organization_id?: string
          start_km?: number
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mileage_entries_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "mileage_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          created_at: string
          created_by: string
          id: string
          is_internal: boolean
          organization_id: string
          related_entity_id: string
          related_entity_type: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          id?: string
          is_internal?: boolean
          organization_id: string
          related_entity_id: string
          related_entity_type: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          id?: string
          is_internal?: boolean
          organization_id?: string
          related_entity_id?: string
          related_entity_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_form_fields: {
        Row: {
          conditional_field_id: string | null
          conditional_value: string | null
          created_at: string
          document_type: string | null
          field_type: string
          help_text: string | null
          id: string
          is_active: boolean | null
          is_required: boolean | null
          label: string
          maps_to_column: string | null
          maps_to_table: string | null
          max_value: number | null
          min_value: number | null
          options: Json | null
          organization_id: string
          placeholder: string | null
          require_expiry_date: boolean | null
          sort_order: number
          step_id: string
          validation_message: string | null
          validation_regex: string | null
          width: string | null
        }
        Insert: {
          conditional_field_id?: string | null
          conditional_value?: string | null
          created_at?: string
          document_type?: string | null
          field_type: string
          help_text?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          label: string
          maps_to_column?: string | null
          maps_to_table?: string | null
          max_value?: number | null
          min_value?: number | null
          options?: Json | null
          organization_id: string
          placeholder?: string | null
          require_expiry_date?: boolean | null
          sort_order?: number
          step_id: string
          validation_message?: string | null
          validation_regex?: string | null
          width?: string | null
        }
        Update: {
          conditional_field_id?: string | null
          conditional_value?: string | null
          created_at?: string
          document_type?: string | null
          field_type?: string
          help_text?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          label?: string
          maps_to_column?: string | null
          maps_to_table?: string | null
          max_value?: number | null
          min_value?: number | null
          options?: Json | null
          organization_id?: string
          placeholder?: string | null
          require_expiry_date?: boolean | null
          sort_order?: number
          step_id?: string
          validation_message?: string | null
          validation_regex?: string | null
          width?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_form_fields_conditional_field_id_fkey"
            columns: ["conditional_field_id"]
            isOneToOne: false
            referencedRelation: "onboarding_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_form_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_form_fields_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "onboarding_form_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_form_regulations: {
        Row: {
          form_id: string
          id: string
          is_required: boolean | null
          regulation_id: string
          sort_order: number | null
        }
        Insert: {
          form_id: string
          id?: string
          is_required?: boolean | null
          regulation_id: string
          sort_order?: number | null
        }
        Update: {
          form_id?: string
          id?: string
          is_required?: boolean | null
          regulation_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_form_regulations_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "onboarding_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_form_regulations_regulation_id_fkey"
            columns: ["regulation_id"]
            isOneToOne: false
            referencedRelation: "regulations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_form_steps: {
        Row: {
          created_at: string
          description: string | null
          form_id: string
          id: string
          is_active: boolean | null
          organization_id: string
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          form_id: string
          id?: string
          is_active?: boolean | null
          organization_id: string
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          form_id?: string
          id?: string
          is_active?: boolean | null
          organization_id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_form_steps_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "onboarding_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_form_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_forms: {
        Row: {
          contract_type: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          nationality_filter: string[] | null
          organization_id: string
          sector: string | null
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          contract_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          nationality_filter?: string[] | null
          organization_id: string
          sector?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          contract_type?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          nationality_filter?: string[] | null
          organization_id?: string
          sector?: string | null
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_responses: {
        Row: {
          candidate_id: string | null
          created_at: string
          employee_id: string
          field_id: string
          file_path: string | null
          form_id: string
          id: string
          organization_id: string
          value: string | null
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          employee_id: string
          field_id: string
          file_path?: string | null
          form_id: string
          id?: string
          organization_id: string
          value?: string | null
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          employee_id?: string
          field_id?: string
          file_path?: string | null
          form_id?: string
          id?: string
          organization_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_responses_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_responses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_responses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "onboarding_responses_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "onboarding_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "onboarding_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tokens: {
        Row: {
          candidate_id: string | null
          created_at: string
          employee_id: string
          expires_at: string
          form_id: string | null
          id: string
          organization_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          employee_id: string
          expires_at?: string
          form_id?: string | null
          id?: string
          organization_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          employee_id?: string
          expires_at?: string
          form_id?: string | null
          id?: string
          organization_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tokens_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tokens_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tokens_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "onboarding_tokens_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "onboarding_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_modules: {
        Row: {
          enabled: boolean | null
          id: string
          module_name: string
          organization_id: string
        }
        Insert: {
          enabled?: boolean | null
          id?: string
          module_name: string
          organization_id: string
        }
        Update: {
          enabled?: boolean | null
          id?: string
          module_name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_city: string | null
          address_postal: string | null
          address_street: string | null
          btw_number: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          kvk_number: string | null
          logo_url: string | null
          name: string
          phone: string | null
          plan_id: string | null
          settings: Json | null
          slug: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_city?: string | null
          address_postal?: string | null
          address_street?: string | null
          btw_number?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kvk_number?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          plan_id?: string | null
          settings?: Json | null
          slug: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_city?: string | null
          address_postal?: string | null
          address_street?: string | null
          btw_number?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kvk_number?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          plan_id?: string | null
          settings?: Json | null
          slug?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          allowances_total: number | null
          approved_at: string | null
          approved_by: string | null
          candidate_id: string | null
          created_at: string
          deductions_total: number | null
          employee_id: string
          exported_at: string | null
          gross_salary: number
          id: string
          line_items: Json | null
          net_salary: number
          notes: string | null
          organization_id: string
          overtime_hours: number | null
          pdf_url: string | null
          pension_reserved: number | null
          period_end: string
          period_number: number
          period_start: string
          period_year: number
          reservations_total: number | null
          social_premiums: number | null
          status: string
          surcharges_total: number | null
          tax_withheld: number | null
          total_hours: number | null
          updated_at: string
          vacation_money_reserved: number | null
        }
        Insert: {
          allowances_total?: number | null
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string | null
          created_at?: string
          deductions_total?: number | null
          employee_id: string
          exported_at?: string | null
          gross_salary?: number
          id?: string
          line_items?: Json | null
          net_salary?: number
          notes?: string | null
          organization_id: string
          overtime_hours?: number | null
          pdf_url?: string | null
          pension_reserved?: number | null
          period_end: string
          period_number: number
          period_start: string
          period_year: number
          reservations_total?: number | null
          social_premiums?: number | null
          status?: string
          surcharges_total?: number | null
          tax_withheld?: number | null
          total_hours?: number | null
          updated_at?: string
          vacation_money_reserved?: number | null
        }
        Update: {
          allowances_total?: number | null
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string | null
          created_at?: string
          deductions_total?: number | null
          employee_id?: string
          exported_at?: string | null
          gross_salary?: number
          id?: string
          line_items?: Json | null
          net_salary?: number
          notes?: string | null
          organization_id?: string
          overtime_hours?: number | null
          pdf_url?: string | null
          pension_reserved?: number | null
          period_end?: string
          period_number?: number
          period_start?: string
          period_year?: number
          reservations_total?: number | null
          social_premiums?: number | null
          status?: string
          surcharges_total?: number | null
          tax_withheld?: number | null
          total_hours?: number | null
          updated_at?: string
          vacation_money_reserved?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payslips_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      people_search_results: {
        Row: {
          date_imported: string
          external_id: string
          highlight_scores: number[] | null
          highlights: string[] | null
          id: string
          image_url: string | null
          name: string | null
          organization_id: string
          published_date: string | null
          raw_data: Json | null
          search_query: string | null
          text_content: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          date_imported?: string
          external_id: string
          highlight_scores?: number[] | null
          highlights?: string[] | null
          id?: string
          image_url?: string | null
          name?: string | null
          organization_id: string
          published_date?: string | null
          raw_data?: Json | null
          search_query?: string | null
          text_content?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          date_imported?: string
          external_id?: string
          highlight_scores?: number[] | null
          highlights?: string[] | null
          id?: string
          image_url?: string | null
          name?: string | null
          organization_id?: string
          published_date?: string | null
          raw_data?: Json | null
          search_query?: string | null
          text_content?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_search_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      placement_allowances: {
        Row: {
          amount: number
          code: string
          created_at: string
          description: string
          frequency: string
          id: string
          is_taxable: boolean | null
          organization_id: string
          placement_id: string
          sort_order: number | null
        }
        Insert: {
          amount: number
          code: string
          created_at?: string
          description: string
          frequency?: string
          id?: string
          is_taxable?: boolean | null
          organization_id: string
          placement_id: string
          sort_order?: number | null
        }
        Update: {
          amount?: number
          code?: string
          created_at?: string
          description?: string
          frequency?: string
          id?: string
          is_taxable?: boolean | null
          organization_id?: string
          placement_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "placement_allowances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_allowances_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_allowances_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
        ]
      }
      placement_hour_types: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          is_default: boolean | null
          multiplier: number
          organization_id: string
          placement_id: string
          sort_order: number | null
          surcharge_amount: number | null
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          is_default?: boolean | null
          multiplier?: number
          organization_id: string
          placement_id: string
          sort_order?: number | null
          surcharge_amount?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          is_default?: boolean | null
          multiplier?: number
          organization_id?: string
          placement_id?: string
          sort_order?: number | null
          surcharge_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "placement_hour_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_hour_types_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_hour_types_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
        ]
      }
      placement_travel_types: {
        Row: {
          code: string
          created_at: string
          description: string
          fixed_amount: number | null
          id: string
          is_taxable: boolean | null
          max_km_per_day: number | null
          organization_id: string
          placement_id: string
          rate_per_km: number | null
          sort_order: number | null
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          fixed_amount?: number | null
          id?: string
          is_taxable?: boolean | null
          max_km_per_day?: number | null
          organization_id: string
          placement_id: string
          rate_per_km?: number | null
          sort_order?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          fixed_amount?: number | null
          id?: string
          is_taxable?: boolean | null
          max_km_per_day?: number | null
          organization_id?: string
          placement_id?: string
          rate_per_km?: number | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "placement_travel_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_travel_types_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placement_travel_types_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
        ]
      }
      placements: {
        Row: {
          candidate_id: string | null
          cao_hours: number | null
          client_hourly_rate: number | null
          company_id: string
          compliance_check_at: string | null
          compliance_check_passed: boolean
          compliance_override: boolean
          compliance_override_by: string | null
          compliance_override_reason: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          end_date: string | null
          expected_end_date: string | null
          function_name: string
          hourly_rate: number
          housing_assignment_id: string | null
          housing_payment_type: string | null
          id: string
          is_seasonal: boolean | null
          is_time_for_time: boolean | null
          match_id: string | null
          notes: string | null
          organization_id: string
          overtime_rate: number | null
          payroller: Database["public"]["Enums"]["payroller_type"] | null
          rate_agreement_id: string | null
          salary_indication: string | null
          start_date: string
          status: Database["public"]["Enums"]["placement_status"]
          terminated_at: string | null
          terminated_by:
            | Database["public"]["Enums"]["terminated_by_type"]
            | null
          termination_notes: string | null
          termination_reason: string | null
          updated_at: string
          vacancy_id: string | null
          work_days: string[] | null
          work_location: string | null
        }
        Insert: {
          candidate_id?: string | null
          cao_hours?: number | null
          client_hourly_rate?: number | null
          company_id: string
          compliance_check_at?: string | null
          compliance_check_passed?: boolean
          compliance_override?: boolean
          compliance_override_by?: string | null
          compliance_override_reason?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_date?: string | null
          expected_end_date?: string | null
          function_name: string
          hourly_rate: number
          housing_assignment_id?: string | null
          housing_payment_type?: string | null
          id?: string
          is_seasonal?: boolean | null
          is_time_for_time?: boolean | null
          match_id?: string | null
          notes?: string | null
          organization_id: string
          overtime_rate?: number | null
          payroller?: Database["public"]["Enums"]["payroller_type"] | null
          rate_agreement_id?: string | null
          salary_indication?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["placement_status"]
          terminated_at?: string | null
          terminated_by?:
            | Database["public"]["Enums"]["terminated_by_type"]
            | null
          termination_notes?: string | null
          termination_reason?: string | null
          updated_at?: string
          vacancy_id?: string | null
          work_days?: string[] | null
          work_location?: string | null
        }
        Update: {
          candidate_id?: string | null
          cao_hours?: number | null
          client_hourly_rate?: number | null
          company_id?: string
          compliance_check_at?: string | null
          compliance_check_passed?: boolean
          compliance_override?: boolean
          compliance_override_by?: string | null
          compliance_override_reason?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_date?: string | null
          expected_end_date?: string | null
          function_name?: string
          hourly_rate?: number
          housing_assignment_id?: string | null
          housing_payment_type?: string | null
          id?: string
          is_seasonal?: boolean | null
          is_time_for_time?: boolean | null
          match_id?: string | null
          notes?: string | null
          organization_id?: string
          overtime_rate?: number | null
          payroller?: Database["public"]["Enums"]["payroller_type"] | null
          rate_agreement_id?: string | null
          salary_indication?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["placement_status"]
          terminated_at?: string | null
          terminated_by?:
            | Database["public"]["Enums"]["terminated_by_type"]
            | null
          termination_notes?: string | null
          termination_reason?: string | null
          updated_at?: string
          vacancy_id?: string | null
          work_days?: string[] | null
          work_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "placements_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_compliance_override_by_fkey"
            columns: ["compliance_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "placements_housing_assignment_id_fkey"
            columns: ["housing_assignment_id"]
            isOneToOne: false
            referencedRelation: "housing_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_rate_agreement_id_fkey"
            columns: ["rate_agreement_id"]
            isOneToOne: false
            referencedRelation: "rate_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "placements_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_invites: {
        Row: {
          candidate_id: string | null
          created_at: string
          email: string
          employee_id: string
          expires_at: string
          id: string
          organization_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          candidate_id?: string | null
          created_at?: string
          email: string
          employee_id: string
          expires_at?: string
          id?: string
          organization_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          candidate_id?: string | null
          created_at?: string
          email?: string
          employee_id?: string
          expires_at?: string
          id?: string
          organization_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_invites_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_invites_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_invites_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "portal_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          organization_id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          organization_id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address_city: string
          address_lat: number | null
          address_lng: number | null
          address_postal: string
          address_street: string
          cost_electra: number | null
          cost_gas: number | null
          cost_municipal_tax: number | null
          cost_other: number | null
          cost_price: number | null
          cost_water: number | null
          created_at: string
          energy_wizard_id: string | null
          energy_wizard_linked: boolean | null
          has_rental_permit: boolean | null
          has_snf_certificate: boolean | null
          id: string
          is_active: boolean
          max_persons_permit: number | null
          monthly_rent: number | null
          name: string
          notes: string | null
          organization_id: string
          owner_contact_person: string | null
          owner_email: string | null
          owner_name: string | null
          owner_notes: string | null
          owner_phone: string | null
          ownership_type: string | null
          rental_contract_url: string | null
          rental_permit_expiry: string | null
          rental_permit_number: string | null
          snf_certificate_expiry: string | null
          snf_certificate_number: string | null
          total_capacity: number
          updated_at: string
        }
        Insert: {
          address_city: string
          address_lat?: number | null
          address_lng?: number | null
          address_postal: string
          address_street: string
          cost_electra?: number | null
          cost_gas?: number | null
          cost_municipal_tax?: number | null
          cost_other?: number | null
          cost_price?: number | null
          cost_water?: number | null
          created_at?: string
          energy_wizard_id?: string | null
          energy_wizard_linked?: boolean | null
          has_rental_permit?: boolean | null
          has_snf_certificate?: boolean | null
          id?: string
          is_active?: boolean
          max_persons_permit?: number | null
          monthly_rent?: number | null
          name: string
          notes?: string | null
          organization_id: string
          owner_contact_person?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_notes?: string | null
          owner_phone?: string | null
          ownership_type?: string | null
          rental_contract_url?: string | null
          rental_permit_expiry?: string | null
          rental_permit_number?: string | null
          snf_certificate_expiry?: string | null
          snf_certificate_number?: string | null
          total_capacity?: number
          updated_at?: string
        }
        Update: {
          address_city?: string
          address_lat?: number | null
          address_lng?: number | null
          address_postal?: string
          address_street?: string
          cost_electra?: number | null
          cost_gas?: number | null
          cost_municipal_tax?: number | null
          cost_other?: number | null
          cost_price?: number | null
          cost_water?: number | null
          created_at?: string
          energy_wizard_id?: string | null
          energy_wizard_linked?: boolean | null
          has_rental_permit?: boolean | null
          has_snf_certificate?: boolean | null
          id?: string
          is_active?: boolean
          max_persons_permit?: number | null
          monthly_rent?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          owner_contact_person?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_notes?: string | null
          owner_phone?: string | null
          ownership_type?: string | null
          rental_contract_url?: string | null
          rental_permit_expiry?: string | null
          rental_permit_number?: string | null
          snf_certificate_expiry?: string | null
          snf_certificate_number?: string | null
          total_capacity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_agreements: {
        Row: {
          company_id: string
          created_at: string
          function_name: string
          hourly_rate: number
          id: string
          notes: string | null
          organization_id: string
          overtime_rate: number | null
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          function_name: string
          hourly_rate: number
          id?: string
          notes?: string | null
          organization_id: string
          overtime_rate?: number | null
          valid_from: string
          valid_until?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          function_name?: string
          hourly_rate?: number
          id?: string
          notes?: string | null
          organization_id?: string
          overtime_rate?: number | null
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_agreements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_tracking: {
        Row: {
          channel: Database["public"]["Enums"]["communication_channel"]
          created_at: string
          id: string
          messages_sent: number
          organization_id: string
          window_start: string
          window_type: Database["public"]["Enums"]["rate_limit_window"]
        }
        Insert: {
          channel: Database["public"]["Enums"]["communication_channel"]
          created_at?: string
          id?: string
          messages_sent?: number
          organization_id: string
          window_start: string
          window_type: Database["public"]["Enums"]["rate_limit_window"]
        }
        Update: {
          channel?: Database["public"]["Enums"]["communication_channel"]
          created_at?: string
          id?: string
          messages_sent?: number
          organization_id?: string
          window_start?: string
          window_type?: Database["public"]["Enums"]["rate_limit_window"]
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recruiter_tasks: {
        Row: {
          ai_generated: boolean
          ai_reasoning: string | null
          assigned_to: string | null
          category: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          organization_id: string
          priority: string
          related_entity_id: string | null
          related_entity_type: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_generated?: boolean
          ai_reasoning?: string | null
          assigned_to?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          organization_id: string
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_generated?: boolean
          ai_reasoning?: string | null
          assigned_to?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recruiter_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recruiter_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      regulation_acknowledgements: {
        Row: {
          candidate_id: string | null
          employee_id: string
          id: string
          ip_address: string | null
          organization_id: string
          regulation_id: string
          signed_at: string
        }
        Insert: {
          candidate_id?: string | null
          employee_id: string
          id?: string
          ip_address?: string | null
          organization_id: string
          regulation_id: string
          signed_at?: string
        }
        Update: {
          candidate_id?: string | null
          employee_id?: string
          id?: string
          ip_address?: string | null
          organization_id?: string
          regulation_id?: string
          signed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulation_acknowledgements_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulation_acknowledgements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulation_acknowledgements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "regulation_acknowledgements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulation_acknowledgements_regulation_id_fkey"
            columns: ["regulation_id"]
            isOneToOne: false
            referencedRelation: "regulations"
            referencedColumns: ["id"]
          },
        ]
      }
      regulations: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          organization_id: string
          published_at: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          published_at?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          published_at?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "regulations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sick_reports: {
        Row: {
          actual_return_date: string | null
          candidate_id: string | null
          client_notified: boolean
          client_notified_at: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          expected_return_date: string | null
          id: string
          notes: string | null
          organization_id: string
          placement_id: string | null
          reported_at: string
          updated_at: string
        }
        Insert: {
          actual_return_date?: string | null
          candidate_id?: string | null
          client_notified?: boolean
          client_notified_at?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          expected_return_date?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          placement_id?: string | null
          reported_at?: string
          updated_at?: string
        }
        Update: {
          actual_return_date?: string | null
          candidate_id?: string | null
          client_notified?: boolean
          client_notified_at?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          expected_return_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          placement_id?: string | null
          reported_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sick_reports_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sick_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sick_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sick_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "sick_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sick_reports_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sick_reports_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_default: boolean | null
          modules: string[]
          name: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          modules?: string[]
          name: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_default?: boolean | null
          modules?: string[]
          name?: string
        }
        Relationships: []
      }
      superadmins: {
        Row: {
          created_at: string | null
          email: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      termination_reasons: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          reason: string
          sort_order: number | null
          terminated_by: Database["public"]["Enums"]["terminated_by_type"]
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          reason: string
          sort_order?: number | null
          terminated_by: Database["public"]["Enums"]["terminated_by_type"]
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          reason?: string
          sort_order?: number | null
          terminated_by?: Database["public"]["Enums"]["terminated_by_type"]
        }
        Relationships: [
          {
            foreignKeyName: "termination_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          ai_validated_at: string | null
          ai_validation_result: Json | null
          allowances_amount: number | null
          approved_at: string | null
          approved_by: string | null
          candidate_id: string | null
          client_approved: boolean | null
          client_approved_at: string | null
          created_at: string
          employee_confirmed: boolean | null
          employee_confirmed_at: string | null
          employee_id: string
          hour_type_id: string | null
          hourly_rate: number | null
          hours: number
          id: string
          invoice_line_id: string | null
          notes: string | null
          organization_id: string
          overtime_hours: number | null
          placement_id: string
          rate_code: string | null
          source: Database["public"]["Enums"]["timesheet_source"]
          status: Database["public"]["Enums"]["timesheet_status"]
          surcharge_amount: number | null
          travel_amount: number | null
          travel_km: number | null
          travel_type_id: string | null
          updated_at: string
          work_date: string
        }
        Insert: {
          ai_validated_at?: string | null
          ai_validation_result?: Json | null
          allowances_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string | null
          client_approved?: boolean | null
          client_approved_at?: string | null
          created_at?: string
          employee_confirmed?: boolean | null
          employee_confirmed_at?: string | null
          employee_id: string
          hour_type_id?: string | null
          hourly_rate?: number | null
          hours: number
          id?: string
          invoice_line_id?: string | null
          notes?: string | null
          organization_id: string
          overtime_hours?: number | null
          placement_id: string
          rate_code?: string | null
          source?: Database["public"]["Enums"]["timesheet_source"]
          status?: Database["public"]["Enums"]["timesheet_status"]
          surcharge_amount?: number | null
          travel_amount?: number | null
          travel_km?: number | null
          travel_type_id?: string | null
          updated_at?: string
          work_date: string
        }
        Update: {
          ai_validated_at?: string | null
          ai_validation_result?: Json | null
          allowances_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          candidate_id?: string | null
          client_approved?: boolean | null
          client_approved_at?: string | null
          created_at?: string
          employee_confirmed?: boolean | null
          employee_confirmed_at?: string | null
          employee_id?: string
          hour_type_id?: string | null
          hourly_rate?: number | null
          hours?: number
          id?: string
          invoice_line_id?: string | null
          notes?: string | null
          organization_id?: string
          overtime_hours?: number | null
          placement_id?: string
          rate_code?: string | null
          source?: Database["public"]["Enums"]["timesheet_source"]
          status?: Database["public"]["Enums"]["timesheet_status"]
          surcharge_amount?: number | null
          travel_amount?: number | null
          travel_km?: number | null
          travel_type_id?: string | null
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "timesheets_hour_type_id_fkey"
            columns: ["hour_type_id"]
            isOneToOne: false
            referencedRelation: "placement_hour_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_invoice_line_id_fkey"
            columns: ["invoice_line_id"]
            isOneToOne: false
            referencedRelation: "invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "v_active_placements"
            referencedColumns: ["placement_id"]
          },
          {
            foreignKeyName: "timesheets_travel_type_id_fkey"
            columns: ["travel_type_id"]
            isOneToOne: false
            referencedRelation: "placement_travel_types"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          capacity: number
          created_at: string
          deposit_amount: number | null
          floor: number | null
          id: string
          monthly_cost: number | null
          name: string
          notes: string | null
          organization_id: string
          property_id: string
          status: Database["public"]["Enums"]["unit_status"]
          updated_at: string
          weekly_cost: number | null
        }
        Insert: {
          capacity?: number
          created_at?: string
          deposit_amount?: number | null
          floor?: number | null
          id?: string
          monthly_cost?: number | null
          name: string
          notes?: string | null
          organization_id: string
          property_id: string
          status?: Database["public"]["Enums"]["unit_status"]
          updated_at?: string
          weekly_cost?: number | null
        }
        Update: {
          capacity?: number
          created_at?: string
          deposit_amount?: number | null
          floor?: number | null
          id?: string
          monthly_cost?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          property_id?: string
          status?: Database["public"]["Enums"]["unit_status"]
          updated_at?: string
          weekly_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      vacancies: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          filled_count: number
          hourly_rate: number | null
          id: string
          location: string | null
          notes: string | null
          organization_id: string
          required_certifications: string[] | null
          required_count: number
          required_skills: string[] | null
          requires_drivers_license: boolean | null
          salary_display: string | null
          salary_max: number | null
          salary_min: number | null
          skills_required: string[] | null
          start_date: string | null
          status: Database["public"]["Enums"]["vacancy_status"]
          title: string
          updated_at: string
          urgency: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          filled_count?: number
          hourly_rate?: number | null
          id?: string
          location?: string | null
          notes?: string | null
          organization_id: string
          required_certifications?: string[] | null
          required_count?: number
          required_skills?: string[] | null
          requires_drivers_license?: boolean | null
          salary_display?: string | null
          salary_max?: number | null
          salary_min?: number | null
          skills_required?: string[] | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["vacancy_status"]
          title: string
          updated_at?: string
          urgency?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          filled_count?: number
          hourly_rate?: number | null
          id?: string
          location?: string | null
          notes?: string | null
          organization_id?: string
          required_certifications?: string[] | null
          required_count?: number
          required_skills?: string[] | null
          requires_drivers_license?: boolean | null
          salary_display?: string | null
          salary_max?: number | null
          salary_min?: number | null
          skills_required?: string[] | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["vacancy_status"]
          title?: string
          updated_at?: string
          urgency?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vacancies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacancies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_assignments: {
        Row: {
          assigned_date: string
          candidate_id: string | null
          created_at: string
          employee_id: string
          end_mileage: number | null
          id: string
          notes: string | null
          organization_id: string
          returned_date: string | null
          start_mileage: number | null
          vehicle_id: string
        }
        Insert: {
          assigned_date: string
          candidate_id?: string | null
          created_at?: string
          employee_id: string
          end_mileage?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          returned_date?: string | null
          start_mileage?: number | null
          vehicle_id: string
        }
        Update: {
          assigned_date?: string
          candidate_id?: string | null
          created_at?: string
          employee_id?: string
          end_mileage?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          returned_date?: string | null
          start_mileage?: number | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_assignments_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "vehicle_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_assignments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_damage_reports: {
        Row: {
          candidate_id: string | null
          cost_estimate: number | null
          created_at: string
          damage_type: string
          description: string | null
          employee_id: string
          garage_email: string | null
          garage_notified: boolean | null
          garage_notified_at: string | null
          id: string
          organization_id: string
          photos: string[] | null
          reported_at: string
          resolution_notes: string | null
          resolved: boolean | null
          resolved_at: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          candidate_id?: string | null
          cost_estimate?: number | null
          created_at?: string
          damage_type: string
          description?: string | null
          employee_id: string
          garage_email?: string | null
          garage_notified?: boolean | null
          garage_notified_at?: string | null
          id?: string
          organization_id: string
          photos?: string[] | null
          reported_at?: string
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          candidate_id?: string | null
          cost_estimate?: number | null
          created_at?: string
          damage_type?: string
          description?: string | null
          employee_id?: string
          garage_email?: string | null
          garage_notified?: boolean | null
          garage_notified_at?: string | null
          id?: string
          organization_id?: string
          photos?: string[] | null
          reported_at?: string
          resolution_notes?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_damage_reports_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_damage_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_damage_reports_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "vehicle_damage_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_damage_reports_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_fines: {
        Row: {
          amount: number
          candidate_id: string | null
          created_at: string
          description: string | null
          employee_id: string | null
          fine_date: string
          id: string
          notes: string | null
          organization_id: string
          paid: boolean
          paid_at: string | null
          reference_number: string | null
          vehicle_id: string
        }
        Insert: {
          amount: number
          candidate_id?: string | null
          created_at?: string
          description?: string | null
          employee_id?: string | null
          fine_date: string
          id?: string
          notes?: string | null
          organization_id: string
          paid?: boolean
          paid_at?: string | null
          reference_number?: string | null
          vehicle_id: string
        }
        Update: {
          amount?: number
          candidate_id?: string | null
          created_at?: string
          description?: string | null
          employee_id?: string | null
          fine_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          paid?: boolean
          paid_at?: string | null
          reference_number?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_fines_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_compliance"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "vehicle_fines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fines_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          apk_expiry: string | null
          avg_consumption_per_100km: number | null
          brand: string | null
          color: string | null
          created_at: string
          current_mileage: number | null
          first_registration: string | null
          fuel_card_reference: string | null
          fuel_type: string | null
          id: string
          license_plate: string
          model: string | null
          notes: string | null
          organization_id: string
          seats: number | null
          status: Database["public"]["Enums"]["vehicle_status"]
          tank_capacity_liters: number | null
          updated_at: string
          weight: number | null
          year: number | null
        }
        Insert: {
          apk_expiry?: string | null
          avg_consumption_per_100km?: number | null
          brand?: string | null
          color?: string | null
          created_at?: string
          current_mileage?: number | null
          first_registration?: string | null
          fuel_card_reference?: string | null
          fuel_type?: string | null
          id?: string
          license_plate: string
          model?: string | null
          notes?: string | null
          organization_id: string
          seats?: number | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          tank_capacity_liters?: number | null
          updated_at?: string
          weight?: number | null
          year?: number | null
        }
        Update: {
          apk_expiry?: string | null
          avg_consumption_per_100km?: number | null
          brand?: string | null
          color?: string | null
          created_at?: string
          current_mileage?: number | null
          first_registration?: string | null
          fuel_card_reference?: string | null
          fuel_type?: string | null
          id?: string
          license_plate?: string
          model?: string | null
          notes?: string | null
          organization_id?: string
          seats?: number | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          tank_capacity_liters?: number | null
          updated_at?: string
          weight?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          access_token: string | null
          created_at: string
          display_phone: string | null
          id: string
          is_active: boolean
          organization_id: string
          phone_number_id: string | null
          tenant_id: string | null
          updated_at: string
          waba_id: string | null
          webhook_secret: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          display_phone?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          phone_number_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          waba_id?: string | null
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          display_phone?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          phone_number_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          waba_id?: string | null
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_active_placements: {
        Row: {
          company_name: string | null
          compliance_check_passed: boolean | null
          employee_name: string | null
          end_date: string | null
          function_name: string | null
          has_housing: boolean | null
          hourly_rate: number | null
          organization_id: string | null
          placement_id: string | null
          property_name: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["placement_status"] | null
          unit_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "placements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_employee_compliance: {
        Row: {
          compliance_status:
            | Database["public"]["Enums"]["compliance_status"]
            | null
          drivers_license_expiry: string | null
          employee_id: string | null
          employee_status: Database["public"]["Enums"]["employee_status"] | null
          expired_documents: number | null
          expiring_documents: number | null
          full_name: string | null
          has_drivers_license: boolean | null
          onboarding_completed: boolean | null
          organization_id: string | null
          valid_documents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_unit_occupancy: {
        Row: {
          address_city: string | null
          address_lat: number | null
          address_lng: number | null
          address_postal: string | null
          available_spots: number | null
          capacity: number | null
          current_occupancy: number | null
          monthly_cost: number | null
          organization_id: string | null
          property_name: string | null
          status: Database["public"]["Enums"]["unit_status"] | null
          unit_id: string | null
          unit_name: string | null
          weekly_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_channel: Database["public"]["Enums"]["communication_channel"]
          p_org_id: string
          p_window_type: Database["public"]["Enums"]["rate_limit_window"]
        }
        Returns: boolean
      }
      decrypt_sensitive: { Args: { ciphertext: string }; Returns: string }
      encrypt_sensitive: { Args: { plaintext: string }; Returns: string }
      get_campaign_candidates: {
        Args: {
          p_channel: Database["public"]["Enums"]["communication_channel"]
          p_filter: Json
          p_org_id: string
        }
        Returns: {
          candidate_id: string
          first_name: string
          last_name: string
          phone: string
        }[]
      }
      get_candidate_decrypted: {
        Args: { p_candidate_id: string }
        Returns: {
          decrypted_bsn: string
          decrypted_iban: string
        }[]
      }
      get_employee_id: { Args: never; Returns: string }
      get_exact_token: {
        Args: { p_org_id: string }
        Returns: {
          base_url: string
          decrypted_webhook_secret: string
          division: number
          region: string
          tenant_id: string
        }[]
      }
      get_microsoft_token: {
        Args: { p_org_id: string }
        Returns: {
          access_token: string
          microsoft_email: string
          microsoft_tenant_id: string
          refresh_token: string
          refreshing_at: string
          token_expires_at: string
        }[]
      }
      get_my_sensitive_data: {
        Args: never
        Returns: {
          decrypted_bsn: string
          decrypted_iban: string
        }[]
      }
      get_user_org_id: { Args: never; Returns: string }
      get_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_whatsapp_token: {
        Args: { p_org_id: string }
        Returns: {
          decrypted_access_token: string
          decrypted_webhook_secret: string
          phone_number_id: string
          waba_id: string
        }[]
      }
      is_employee_user: { Args: never; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      next_invoice_number: { Args: { org_id: string }; Returns: string }
      record_rate_limit: {
        Args: {
          p_channel: Database["public"]["Enums"]["communication_channel"]
          p_org_id: string
        }
        Returns: undefined
      }
      sa_get_audit_log: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at: string
          id: string
          ip_address: string
          new_values: Json
          old_values: Json
          organization_id: string
          reason: string
          record_id: string
          table_name: string
          user_id: string
        }[]
      }
      sa_get_org_stats: {
        Args: { org_uuid: string }
        Returns: {
          candidates_count: number
          companies_count: number
          employees_count: number
          placements_count: number
          properties_count: number
          vehicles_count: number
        }[]
      }
      sa_get_organizations: {
        Args: never
        Returns: {
          address_city: string
          address_postal: string
          address_street: string
          btw_number: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          kvk_number: string
          logo_url: string
          name: string
          phone: string
          plan_id: string
          settings: Json
          slug: string
          updated_at: string
          website: string
        }[]
      }
      sa_get_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          organization_id: string
          phone: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }[]
      }
      sa_update_org_active: {
        Args: { active: boolean; org_uuid: string }
        Returns: undefined
      }
      sa_update_org_plan: {
        Args: { new_plan_id: string; org_uuid: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      audit_action:
        | "create"
        | "update"
        | "delete"
        | "status_change"
        | "login"
        | "export"
        | "override"
      campaign_recipient_status: "pending" | "sent" | "failed" | "opted_out"
      campaign_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "completed"
        | "cancelled"
      candidate_status:
        | "nieuw"
        | "in_behandeling"
        | "beschikbaar"
        | "geplaatst"
        | "inactief"
        | "afgewezen"
      communication_channel: "whatsapp" | "email" | "voip" | "notitie" | "sms"
      compliance_status: "incompleet" | "compleet" | "verlopen"
      contact_role: "admin" | "plaatsing" | "hr" | "overig"
      contract_status: "concept" | "verzonden" | "getekend" | "verlopen"
      document_status:
        | "geldig"
        | "verloopt_binnenkort"
        | "verlopen"
        | "ongeldig"
      document_type:
        | "id_bewijs"
        | "rijbewijs"
        | "certificaat"
        | "contract"
        | "reglement"
        | "overig"
        | "bankbewijs"
        | "loonstrook"
        | "jaaropgave"
        | "urenbrief"
      employee_status: "onboarding" | "actief" | "ziek" | "uit_dienst"
      housing_assignment_status: "gereserveerd" | "ingecheckt" | "uitgecheckt"
      inspection_type:
        | "check_in"
        | "check_out"
        | "periodiek"
        | "onderhoud"
        | "klacht"
      invoice_status:
        | "concept"
        | "definitief"
        | "verzonden"
        | "betaald"
        | "gecrediteerd"
      match_status:
        | "nieuwe_match"
        | "gescreend"
        | "voorgesteld"
        | "in_gesprek"
        | "geaccepteerd"
        | "afgewezen"
        | "geplaatst"
      payroller_type: "flexpedia" | "brioworks" | "bromida" | "retiva"
      placement_status:
        | "gepland"
        | "actief"
        | "afgerond"
        | "voortijdig_beeindigd"
      rate_limit_window: "minute" | "hour"
      terminated_by_type: "opdrachtgever" | "medewerker" | "uitzendbureau"
      timesheet_source:
        | "handmatig"
        | "klantportaal"
        | "csv_import"
        | "kloksysteem"
      timesheet_status:
        | "concept"
        | "ingediend"
        | "groen"
        | "oranje"
        | "rood"
        | "goedgekeurd"
        | "afgekeurd"
      unit_status:
        | "beschikbaar"
        | "gereserveerd"
        | "bezet"
        | "onderhoud"
        | "geblokkeerd"
      user_role:
        | "admin"
        | "intercedent"
        | "backoffice"
        | "finance"
        | "medewerker"
      vacancy_status: "open" | "on_hold" | "vervuld" | "gesloten"
      vehicle_status: "beschikbaar" | "toegewezen" | "onderhoud" | "uit_dienst"
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
      audit_action: [
        "create",
        "update",
        "delete",
        "status_change",
        "login",
        "export",
        "override",
      ],
      campaign_recipient_status: ["pending", "sent", "failed", "opted_out"],
      campaign_status: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "completed",
        "cancelled",
      ],
      candidate_status: [
        "nieuw",
        "in_behandeling",
        "beschikbaar",
        "geplaatst",
        "inactief",
        "afgewezen",
      ],
      communication_channel: ["whatsapp", "email", "voip", "notitie", "sms"],
      compliance_status: ["incompleet", "compleet", "verlopen"],
      contact_role: ["admin", "plaatsing", "hr", "overig"],
      contract_status: ["concept", "verzonden", "getekend", "verlopen"],
      document_status: [
        "geldig",
        "verloopt_binnenkort",
        "verlopen",
        "ongeldig",
      ],
      document_type: [
        "id_bewijs",
        "rijbewijs",
        "certificaat",
        "contract",
        "reglement",
        "overig",
        "bankbewijs",
        "loonstrook",
        "jaaropgave",
        "urenbrief",
      ],
      employee_status: ["onboarding", "actief", "ziek", "uit_dienst"],
      housing_assignment_status: ["gereserveerd", "ingecheckt", "uitgecheckt"],
      inspection_type: [
        "check_in",
        "check_out",
        "periodiek",
        "onderhoud",
        "klacht",
      ],
      invoice_status: [
        "concept",
        "definitief",
        "verzonden",
        "betaald",
        "gecrediteerd",
      ],
      match_status: [
        "nieuwe_match",
        "gescreend",
        "voorgesteld",
        "in_gesprek",
        "geaccepteerd",
        "afgewezen",
        "geplaatst",
      ],
      payroller_type: ["flexpedia", "brioworks", "bromida", "retiva"],
      placement_status: [
        "gepland",
        "actief",
        "afgerond",
        "voortijdig_beeindigd",
      ],
      rate_limit_window: ["minute", "hour"],
      terminated_by_type: ["opdrachtgever", "medewerker", "uitzendbureau"],
      timesheet_source: [
        "handmatig",
        "klantportaal",
        "csv_import",
        "kloksysteem",
      ],
      timesheet_status: [
        "concept",
        "ingediend",
        "groen",
        "oranje",
        "rood",
        "goedgekeurd",
        "afgekeurd",
      ],
      unit_status: [
        "beschikbaar",
        "gereserveerd",
        "bezet",
        "onderhoud",
        "geblokkeerd",
      ],
      user_role: [
        "admin",
        "intercedent",
        "backoffice",
        "finance",
        "medewerker",
      ],
      vacancy_status: ["open", "on_hold", "vervuld", "gesloten"],
      vehicle_status: ["beschikbaar", "toegewezen", "onderhoud", "uit_dienst"],
    },
  },
} as const
