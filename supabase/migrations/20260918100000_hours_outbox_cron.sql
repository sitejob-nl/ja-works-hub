-- The unattended run of the outgoing hours mail, scheduled.
--
-- Without this the outbox is only "scheduled" in the sense that a person has to
-- press a button, which is the one thing the ticket asks it not to be. Same
-- shape as the five released cron targets: pg_cron posts to the edge function
-- with `x-cron-secret`, and the function validates it against CRON_SECRET.
--
-- Every five minutes, not every quarter: a send moment is configured to the
-- minute, so a quarter-hour grid would quietly turn a nine o'clock request into
-- a quarter past nine one. A run stays small by its own bounds - at most
-- twenty-five weeks planned and ten messages sent - so a short interval costs
-- little and a backlog still drains over a few passes.
begin;

select cron.unschedule('hours-outbox-every-five-minutes')
  where exists (select 1 from cron.job where jobname = 'hours-outbox-every-five-minutes');

select cron.schedule('hours-outbox-every-five-minutes', '*/5 * * * *', $job$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/hours-outbox',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
$job$);

commit;
