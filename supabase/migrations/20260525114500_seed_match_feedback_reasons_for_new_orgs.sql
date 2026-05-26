-- Ensure organizations created after Phase 1 matching v2 also receive default match feedback reasons.

CREATE OR REPLACE FUNCTION public.seed_default_match_feedback_reasons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.match_feedback_reasons (organization_id, applies_to, reason, sort_order)
  VALUES
    (NEW.id, 'afgewezen', 'Mist verplichte vaardigheden', 10),
    (NEW.id, 'afgewezen', 'Mist certificaat of rijbewijs', 20),
    (NEW.id, 'afgewezen', 'Reistijd te hoog', 30),
    (NEW.id, 'afgewezen', 'Niet beschikbaar', 40),
    (NEW.id, 'afgewezen', 'Kandidaat niet geïnteresseerd', 50),
    (NEW.id, 'geaccepteerd', 'Sterke inhoudelijke match', 10),
    (NEW.id, 'geaccepteerd', 'Goede beschikbaarheid', 20),
    (NEW.id, 'geplaatst', 'Geplaatst na klantakkoord', 10)
  ON CONFLICT (organization_id, applies_to, reason) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_default_match_feedback_reasons() FROM PUBLIC;

DROP TRIGGER IF EXISTS seed_default_match_feedback_reasons_trg ON public.organizations;
CREATE TRIGGER seed_default_match_feedback_reasons_trg
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.seed_default_match_feedback_reasons();
