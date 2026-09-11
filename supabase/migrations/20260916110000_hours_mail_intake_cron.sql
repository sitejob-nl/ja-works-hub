-- The unattended run, scheduled.
--
-- Without this the intake is only "unattended" in the sense that a person has to
-- press a button, which is the one thing the ticket asks it not to be. Same
-- shape as the four released cron targets: pg_cron posts to the edge function
-- with `x-cron-secret`, and the function validates it against CRON_SECRET.
--
-- Every quarter of an hour, because a reply to the hours request is something
-- the office wants to see the same morning, and because a run is deliberately
-- small: at most ten folders and five messages per folder. A folder larger than
-- one run stores where it got to, so it catches up over a few passes rather than
-- reading the same first pages forever.
begin;

select cron.unschedule('hours-mail-intake-quarterly')
  where exists (select 1 from cron.job where jobname = 'hours-mail-intake-quarterly');

select cron.schedule('hours-mail-intake-quarterly', '*/15 * * * *', $job$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/hours-mail-intake',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
$job$);

commit;
