-- Fase 8B: diagnóstico NO destructivo, sin invocar webhooks ni enviar correos.
WITH permisos AS (
 SELECT jsonb_build_object(
  'anon_registrar',has_function_privilege('anon','public.talentai_registrar_webhook_resend(text,text,text,timestamptz)','EXECUTE'),
  'authenticated_registrar',has_function_privilege('authenticated','public.talentai_registrar_webhook_resend(text,text,text,timestamptz)','EXECUTE'),
  'service_role_registrar',has_function_privilege('service_role','public.talentai_registrar_webhook_resend(text,text,text,timestamptz)','EXECUTE'),
  'anon_conciliar',has_function_privilege('anon','public.talentai_conciliar_webhooks_resend(integer)','EXECUTE'),
  'service_role_conciliar',has_function_privilege('service_role','public.talentai_conciliar_webhooks_resend(integer)','EXECUTE'),
  'anon_tabla',has_table_privilege('anon','public.notificaciones_resend_webhook_eventos','SELECT'),
  'authenticated_tabla',has_table_privilege('authenticated','public.notificaciones_resend_webhook_eventos','SELECT'),
  'rls',(SELECT relrowsecurity FROM pg_class WHERE oid='public.notificaciones_resend_webhook_eventos'::regclass)
 ) as resultado
)
SELECT '01_PERMISOS' AS seccion, resultado FROM permisos
UNION ALL
SELECT '02_TRIGGERS', coalesce(jsonb_agg(jsonb_build_object('nombre',tgname,'activo',tgenabled='O')),'[]'::jsonb)
FROM pg_trigger WHERE tgrelid='public.notificaciones_email'::regclass AND tgname='trg_talentai_webhook_resend_aceptacion'
UNION ALL
SELECT '03_ESTADO', jsonb_build_object(
 'aceptadas',(SELECT count(*) FROM public.notificaciones_email WHERE estado='aceptado_proveedor'),
 'con_entrega',(SELECT count(*) FROM public.notificaciones_email WHERE entrega_estado IS NOT NULL),
 'entregados',(SELECT count(*) FROM public.notificaciones_email WHERE entrega_estado='entregado'),
 'rebotados',(SELECT count(*) FROM public.notificaciones_email WHERE entrega_estado='rebotado'),
 'eventos',(SELECT count(*) FROM public.notificaciones_resend_webhook_eventos),
 'eventos_sin_correlacion',(SELECT count(*) FROM public.notificaciones_resend_webhook_eventos WHERE procesado=false)
)
UNION ALL
SELECT '04_COLUMNAS', jsonb_build_object('total',count(*),'nombres',jsonb_agg(column_name ORDER BY column_name))
FROM information_schema.columns WHERE table_schema='public' AND table_name='notificaciones_email'
 AND column_name IN ('entrega_estado','entrega_evento_en','entrega_verificado_en');
