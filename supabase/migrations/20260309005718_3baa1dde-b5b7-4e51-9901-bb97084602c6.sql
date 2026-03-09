-- Create enums for campaign management
CREATE TYPE campaign_status AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled');
CREATE TYPE campaign_recipient_status AS ENUM ('pending', 'sent', 'failed', 'opted_out');
CREATE TYPE rate_limit_window AS ENUM ('minute', 'hour');

-- Table 1: communication_preferences
CREATE TABLE public.communication_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  channel communication_channel NOT NULL,
  opted_out BOOLEAN NOT NULL DEFAULT false,
  opted_out_at TIMESTAMPTZ,
  opted_out_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, channel, organization_id)
);

-- Table 2: bulk_campaigns
CREATE TABLE public.bulk_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel communication_channel NOT NULL DEFAULT 'whatsapp',
  status campaign_status NOT NULL DEFAULT 'draft',
  message_template TEXT NOT NULL,
  segment_filter JSONB,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  opted_out_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 20,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table 3: campaign_recipients
CREATE TABLE public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.bulk_campaigns(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  status campaign_recipient_status NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  communication_id UUID REFERENCES public.communications(id),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_recipients_campaign_status ON public.campaign_recipients(campaign_id, status);
CREATE INDEX idx_campaign_recipients_org_candidate ON public.campaign_recipients(organization_id, candidate_id);

-- Table 4: rate_limit_tracking
CREATE TABLE public.rate_limit_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel communication_channel NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_type rate_limit_window NOT NULL,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, channel, window_type, window_start)
);

-- Enable RLS on all tables
ALTER TABLE public.communication_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_tracking ENABLE ROW LEVEL SECURITY;

-- RLS Policies for communication_preferences
CREATE POLICY tenant_select ON public.communication_preferences
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY tenant_insert ON public.communication_preferences
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY tenant_update ON public.communication_preferences
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY tenant_delete ON public.communication_preferences
  FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

-- RLS Policies for bulk_campaigns
CREATE POLICY tenant_select ON public.bulk_campaigns
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY tenant_insert ON public.bulk_campaigns
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY tenant_update ON public.bulk_campaigns
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY tenant_delete ON public.bulk_campaigns
  FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

-- RLS Policies for campaign_recipients
CREATE POLICY tenant_select ON public.campaign_recipients
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY tenant_insert ON public.campaign_recipients
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY tenant_update ON public.campaign_recipients
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY tenant_delete ON public.campaign_recipients
  FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

-- RLS Policies for rate_limit_tracking
CREATE POLICY tenant_select ON public.rate_limit_tracking
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY tenant_insert ON public.rate_limit_tracking
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY tenant_update ON public.rate_limit_tracking
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY tenant_delete ON public.rate_limit_tracking
  FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

-- Triggers for updated_at
CREATE TRIGGER update_communication_preferences_updated_at
  BEFORE UPDATE ON public.communication_preferences
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER update_bulk_campaigns_updated_at
  BEFORE UPDATE ON public.bulk_campaigns
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Function 1: get_campaign_candidates
CREATE OR REPLACE FUNCTION public.get_campaign_candidates(
  p_org_id UUID,
  p_filter JSONB,
  p_channel communication_channel
)
RETURNS TABLE (
  candidate_id UUID,
  phone TEXT,
  first_name TEXT,
  last_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.phone,
    c.first_name,
    c.last_name
  FROM public.candidates c
  LEFT JOIN public.communication_preferences cp 
    ON cp.candidate_id = c.id 
    AND cp.channel = p_channel 
    AND cp.organization_id = p_org_id
  WHERE c.organization_id = p_org_id
    AND c.phone IS NOT NULL
    AND c.phone != ''
    AND (cp.opted_out IS NULL OR cp.opted_out = false)
    -- Status filter
    AND (
      p_filter->>'status' IS NULL 
      OR c.status::text = ANY(
        SELECT jsonb_array_elements_text(p_filter->'status')
      )
    )
    -- Skills filter
    AND (
      p_filter->>'skills' IS NULL
      OR c.skills && ARRAY(
        SELECT jsonb_array_elements_text(p_filter->'skills')
      )::text[]
    )
    -- Compliance status filter
    AND (
      p_filter->>'compliance_status' IS NULL
      OR c.compliance_status::text = ANY(
        SELECT jsonb_array_elements_text(p_filter->'compliance_status')
      )
    )
    -- City filter
    AND (
      p_filter->>'city' IS NULL
      OR c.address_city ILIKE '%' || (p_filter->>'city') || '%'
    );
END;
$$;

-- Function 2: check_rate_limit
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_org_id UUID,
  p_channel communication_channel,
  p_window_type rate_limit_window
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_messages_sent INTEGER;
  v_limit INTEGER;
  v_campaign_limit INTEGER;
BEGIN
  -- Determine window start based on type
  IF p_window_type = 'minute' THEN
    v_window_start := date_trunc('minute', now());
    v_limit := 20; -- Default minute limit
    
    -- Get campaign-specific limit if available
    SELECT rate_limit_per_minute INTO v_campaign_limit
    FROM public.bulk_campaigns
    WHERE organization_id = p_org_id
      AND status = 'running'
    LIMIT 1;
    
    IF v_campaign_limit IS NOT NULL THEN
      v_limit := v_campaign_limit;
    END IF;
  ELSE
    v_window_start := date_trunc('hour', now());
    v_limit := 1000; -- Default hour limit
    
    -- Get campaign-specific limit if available
    SELECT rate_limit_per_hour INTO v_campaign_limit
    FROM public.bulk_campaigns
    WHERE organization_id = p_org_id
      AND status = 'running'
    LIMIT 1;
    
    IF v_campaign_limit IS NOT NULL THEN
      v_limit := v_campaign_limit;
    END IF;
  END IF;

  -- Get current count for this window
  SELECT COALESCE(SUM(messages_sent), 0) INTO v_messages_sent
  FROM public.rate_limit_tracking
  WHERE organization_id = p_org_id
    AND channel = p_channel
    AND window_type = p_window_type
    AND window_start = v_window_start;

  -- Return true if under limit
  RETURN v_messages_sent < v_limit;
END;
$$;

-- Function 3: record_rate_limit
CREATE OR REPLACE FUNCTION public.record_rate_limit(
  p_org_id UUID,
  p_channel communication_channel
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_minute_start TIMESTAMPTZ;
  v_hour_start TIMESTAMPTZ;
BEGIN
  v_minute_start := date_trunc('minute', now());
  v_hour_start := date_trunc('hour', now());

  -- Increment minute counter
  INSERT INTO public.rate_limit_tracking (
    organization_id,
    channel,
    window_start,
    window_type,
    messages_sent
  )
  VALUES (
    p_org_id,
    p_channel,
    v_minute_start,
    'minute',
    1
  )
  ON CONFLICT (organization_id, channel, window_type, window_start)
  DO UPDATE SET messages_sent = rate_limit_tracking.messages_sent + 1;

  -- Increment hour counter
  INSERT INTO public.rate_limit_tracking (
    organization_id,
    channel,
    window_start,
    window_type,
    messages_sent
  )
  VALUES (
    p_org_id,
    p_channel,
    v_hour_start,
    'hour',
    1
  )
  ON CONFLICT (organization_id, channel, window_type, window_start)
  DO UPDATE SET messages_sent = rate_limit_tracking.messages_sent + 1;
END;
$$;