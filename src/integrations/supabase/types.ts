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
      candidates: {
        Row: {
          address_city: string | null
          address_country: string | null
          address_postal: string | null
          address_street: string | null
          availability_notes: string | null
          bsn: string | null
          certifications: string[] | null
          compliance_status: Database["public"]["Enums"]["compliance_status"]
          created_at: string
          date_of_birth: string | null
          drivers_license_expiry: string | null
          email: string | null
          external_id: string | null
          first_name: string
          has_drivers_license: boolean | null
          iban: string | null
          id: string
          languages: string[] | null
          last_name: string
          nationality: string | null
          notes: string | null
          organization_id: string
          phone: string | null
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
          availability_notes?: string | null
          bsn?: string | null
          certifications?: string[] | null
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          date_of_birth?: string | null
          drivers_license_expiry?: string | null
          email?: string | null
          external_id?: string | null
          first_name: string
          has_drivers_license?: boolean | null
          iban?: string | null
          id?: string
          languages?: string[] | null
          last_name: string
          nationality?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
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
          availability_notes?: string | null
          bsn?: string | null
          certifications?: string[] | null
          compliance_status?: Database["public"]["Enums"]["compliance_status"]
          created_at?: string
          date_of_birth?: string | null
          drivers_license_expiry?: string | null
          email?: string | null
          external_id?: string | null
          first_name?: string
          has_drivers_license?: boolean | null
          iban?: string | null
          id?: string
          languages?: string[] | null
          last_name?: string
          nationality?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
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
          address_postal: string | null
          address_street: string | null
          btw_number: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          kvk_number: string | null
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address_city?: string | null
          address_country?: string | null
          address_postal?: string | null
          address_street?: string | null
          btw_number?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kvk_number?: string | null
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_city?: string | null
          address_country?: string | null
          address_postal?: string | null
          address_street?: string | null
          btw_number?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          kvk_number?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
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
          full_name: string
          function_title: string | null
          id: string
          is_primary: boolean
          organization_id: string
          phone: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          full_name: string
          function_title?: string | null
          id?: string
          is_primary?: boolean
          organization_id: string
          phone?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          function_title?: string | null
          id?: string
          is_primary?: boolean
          organization_id?: string
          phone?: string | null
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
      documents: {
        Row: {
          ai_verification_result: Json | null
          candidate_id: string
          created_at: string
          expiry_date: string | null
          file_path: string | null
          id: string
          issued_date: string | null
          name: string
          notes: string | null
          organization_id: string
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
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          issued_date?: string | null
          name: string
          notes?: string | null
          organization_id: string
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
          expiry_date?: string | null
          file_path?: string | null
          id?: string
          issued_date?: string | null
          name?: string
          notes?: string | null
          organization_id?: string
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
      employees: {
        Row: {
          candidate_id: string
          contract_hours: number | null
          contract_type: string | null
          created_at: string
          employee_number: string | null
          end_date: string | null
          id: string
          notes: string | null
          onboarding_completed: boolean
          onboarding_completed_at: string | null
          organization_id: string
          start_date: string
          status: Database["public"]["Enums"]["employee_status"]
          updated_at: string
        }
        Insert: {
          candidate_id: string
          contract_hours?: number | null
          contract_type?: string | null
          created_at?: string
          employee_number?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          organization_id: string
          start_date: string
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          contract_hours?: number | null
          contract_type?: string | null
          created_at?: string
          employee_number?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          onboarding_completed?: boolean
          onboarding_completed_at?: string | null
          organization_id?: string
          start_date?: string
          status?: Database["public"]["Enums"]["employee_status"]
          updated_at?: string
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
      housing_assignments: {
        Row: {
          check_in_date: string
          check_out_date: string | null
          created_at: string
          deposit_paid: boolean
          employee_id: string
          id: string
          monthly_deduction: number | null
          notes: string | null
          organization_id: string
          rent_paid_until: string | null
          status: Database["public"]["Enums"]["housing_assignment_status"]
          unit_id: string
          updated_at: string
        }
        Insert: {
          check_in_date: string
          check_out_date?: string | null
          created_at?: string
          deposit_paid?: boolean
          employee_id: string
          id?: string
          monthly_deduction?: number | null
          notes?: string | null
          organization_id: string
          rent_paid_until?: string | null
          status?: Database["public"]["Enums"]["housing_assignment_status"]
          unit_id: string
          updated_at?: string
        }
        Update: {
          check_in_date?: string
          check_out_date?: string | null
          created_at?: string
          deposit_paid?: boolean
          employee_id?: string
          id?: string
          monthly_deduction?: number | null
          notes?: string | null
          organization_id?: string
          rent_paid_until?: string | null
          status?: Database["public"]["Enums"]["housing_assignment_status"]
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
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
          created_at: string
          description: string
          id: string
          inspected_by: string | null
          inspection_date: string
          notes: string | null
          organization_id: string
          photos: string[] | null
          property_id: string | null
          resolved: boolean
          resolved_at: string | null
          unit_id: string | null
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          inspected_by?: string | null
          inspection_date: string
          notes?: string | null
          organization_id: string
          photos?: string[] | null
          property_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          unit_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          inspected_by?: string | null
          inspection_date?: string
          notes?: string | null
          organization_id?: string
          photos?: string[] | null
          property_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          unit_id?: string | null
        }
        Relationships: [
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
            foreignKeyName: "matches_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      mileage_entries: {
        Row: {
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
      placements: {
        Row: {
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
          function_name: string
          hourly_rate: number
          housing_assignment_id: string | null
          id: string
          match_id: string | null
          notes: string | null
          organization_id: string
          overtime_rate: number | null
          rate_agreement_id: string | null
          start_date: string
          status: Database["public"]["Enums"]["placement_status"]
          updated_at: string
          vacancy_id: string | null
        }
        Insert: {
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
          function_name: string
          hourly_rate: number
          housing_assignment_id?: string | null
          id?: string
          match_id?: string | null
          notes?: string | null
          organization_id: string
          overtime_rate?: number | null
          rate_agreement_id?: string | null
          start_date: string
          status?: Database["public"]["Enums"]["placement_status"]
          updated_at?: string
          vacancy_id?: string | null
        }
        Update: {
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
          function_name?: string
          hourly_rate?: number
          housing_assignment_id?: string | null
          id?: string
          match_id?: string | null
          notes?: string | null
          organization_id?: string
          overtime_rate?: number | null
          rate_agreement_id?: string | null
          start_date?: string
          status?: Database["public"]["Enums"]["placement_status"]
          updated_at?: string
          vacancy_id?: string | null
        }
        Relationships: [
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
          address_postal: string
          address_street: string
          cost_price: number | null
          created_at: string
          id: string
          is_active: boolean
          monthly_rent: number | null
          name: string
          notes: string | null
          organization_id: string
          owner_name: string | null
          total_capacity: number
          updated_at: string
        }
        Insert: {
          address_city: string
          address_postal: string
          address_street: string
          cost_price?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_rent?: number | null
          name: string
          notes?: string | null
          organization_id: string
          owner_name?: string | null
          total_capacity?: number
          updated_at?: string
        }
        Update: {
          address_city?: string
          address_postal?: string
          address_street?: string
          cost_price?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          monthly_rent?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          owner_name?: string | null
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
      sick_reports: {
        Row: {
          actual_return_date: string | null
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
      timesheets: {
        Row: {
          ai_validated_at: string | null
          ai_validation_result: Json | null
          approved_at: string | null
          approved_by: string | null
          client_approved: boolean | null
          client_approved_at: string | null
          created_at: string
          employee_confirmed: boolean | null
          employee_confirmed_at: string | null
          employee_id: string
          hourly_rate: number | null
          hours: number
          id: string
          notes: string | null
          organization_id: string
          overtime_hours: number | null
          placement_id: string
          rate_code: string | null
          source: Database["public"]["Enums"]["timesheet_source"]
          status: Database["public"]["Enums"]["timesheet_status"]
          updated_at: string
          work_date: string
        }
        Insert: {
          ai_validated_at?: string | null
          ai_validation_result?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          client_approved?: boolean | null
          client_approved_at?: string | null
          created_at?: string
          employee_confirmed?: boolean | null
          employee_confirmed_at?: string | null
          employee_id: string
          hourly_rate?: number | null
          hours: number
          id?: string
          notes?: string | null
          organization_id: string
          overtime_hours?: number | null
          placement_id: string
          rate_code?: string | null
          source?: Database["public"]["Enums"]["timesheet_source"]
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          work_date: string
        }
        Update: {
          ai_validated_at?: string | null
          ai_validation_result?: Json | null
          approved_at?: string | null
          approved_by?: string | null
          client_approved?: boolean | null
          client_approved_at?: string | null
          created_at?: string
          employee_confirmed?: boolean | null
          employee_confirmed_at?: string | null
          employee_id?: string
          hourly_rate?: number | null
          hours?: number
          id?: string
          notes?: string | null
          organization_id?: string
          overtime_hours?: number | null
          placement_id?: string
          rate_code?: string | null
          source?: Database["public"]["Enums"]["timesheet_source"]
          status?: Database["public"]["Enums"]["timesheet_status"]
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
      vehicle_fines: {
        Row: {
          amount: number
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
          brand: string | null
          created_at: string
          current_mileage: number | null
          fuel_type: string | null
          id: string
          license_plate: string
          model: string | null
          notes: string | null
          organization_id: string
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
          year: number | null
        }
        Insert: {
          brand?: string | null
          created_at?: string
          current_mileage?: number | null
          fuel_type?: string | null
          id?: string
          license_plate: string
          model?: string | null
          notes?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          year?: number | null
        }
        Update: {
          brand?: string | null
          created_at?: string
          current_mileage?: number | null
          fuel_type?: string | null
          id?: string
          license_plate?: string
          model?: string | null
          notes?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
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
          available_spots: number | null
          capacity: number | null
          current_occupancy: number | null
          organization_id: string | null
          property_name: string | null
          status: Database["public"]["Enums"]["unit_status"] | null
          unit_id: string | null
          unit_name: string | null
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
      get_user_org_id: { Args: never; Returns: string }
      get_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      is_superadmin: { Args: never; Returns: boolean }
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
      candidate_status:
        | "nieuw"
        | "in_behandeling"
        | "beschikbaar"
        | "geplaatst"
        | "inactief"
        | "afgewezen"
      communication_channel: "whatsapp" | "email" | "voip" | "notitie" | "sms"
      compliance_status: "incompleet" | "compleet" | "verlopen"
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
      employee_status: "onboarding" | "actief" | "ziek" | "uit_dienst"
      housing_assignment_status: "gereserveerd" | "ingecheckt" | "uitgecheckt"
      match_status:
        | "voorgesteld"
        | "in_gesprek"
        | "geaccepteerd"
        | "afgewezen"
        | "geplaatst"
      placement_status:
        | "gepland"
        | "actief"
        | "afgerond"
        | "voortijdig_beeindigd"
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
      unit_status: "beschikbaar" | "bezet" | "onderhoud" | "geblokkeerd"
      user_role: "admin" | "intercedent" | "backoffice" | "finance"
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
      ],
      employee_status: ["onboarding", "actief", "ziek", "uit_dienst"],
      housing_assignment_status: ["gereserveerd", "ingecheckt", "uitgecheckt"],
      match_status: [
        "voorgesteld",
        "in_gesprek",
        "geaccepteerd",
        "afgewezen",
        "geplaatst",
      ],
      placement_status: [
        "gepland",
        "actief",
        "afgerond",
        "voortijdig_beeindigd",
      ],
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
      unit_status: ["beschikbaar", "bezet", "onderhoud", "geblokkeerd"],
      user_role: ["admin", "intercedent", "backoffice", "finance"],
      vacancy_status: ["open", "on_hold", "vervuld", "gesloten"],
      vehicle_status: ["beschikbaar", "toegewezen", "onderhoud", "uit_dienst"],
    },
  },
} as const
