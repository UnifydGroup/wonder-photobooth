-- Requires pg_net (enabled on the live project) and pg_cron.
create extension if not exists pg_net;
create extension if not exists pg_cron;
-- Runs daily at 16:17 UTC (03:17 Melbourne summer time). Replace the project ref if you fork this.
select cron.schedule(
  'photobooth-daily-cleanup',
  '17 16 * * *',
  $$ select net.http_post(
       url := 'https://nujmjxzcmygseilwplgf.supabase.co/functions/v1/booth-api/cron/cleanup',
       headers := jsonb_build_object('content-type','application/json','x-cron-key',(select value from public.app_secrets where key='cron_key')),
       body := '{}'::jsonb,
       timeout_milliseconds := 60000) $$
);
