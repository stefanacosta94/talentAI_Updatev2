-- TalentAI Fase 8A.2 / 16c: solo lectura, no cambia datos ni envía mensajes.
SELECT '01_POLICY' AS seccion,
  (SELECT jsonb_build_object('habilitado',p.habilitado,'existe',true,'habilitado_en',p.habilitado_en)
   FROM public.notificaciones_auto_ats_politica p WHERE p.id=1)::text AS resultado
UNION ALL
SELECT '02_TRIGGERS', (
  SELECT jsonb_agg(jsonb_build_object('nombre',t.tgname,'activo',t.tgenabled='O'))
  FROM pg_trigger t WHERE t.tgrelid='public.notificaciones_email'::regclass
    AND NOT t.tgisinternal AND t.tgname LIKE 'trg_talentai_preparar_autodespacho_%'
)::text
UNION ALL
SELECT '03_PERMISSIONS', jsonb_build_object(
  'anon_config',has_function_privilege('anon','public.talentai_configurar_autodespacho_ats(boolean,uuid)','EXECUTE'),
  'authenticated_config',has_function_privilege('authenticated','public.talentai_configurar_autodespacho_ats(boolean,uuid)','EXECUTE'),
  'service_config',has_function_privilege('service_role','public.talentai_configurar_autodespacho_ats(boolean,uuid)','EXECUTE'),
  'anon_policy_select',has_table_privilege('anon','public.notificaciones_auto_ats_politica','SELECT'),
  'authenticated_policy_select',has_table_privilege('authenticated','public.notificaciones_auto_ats_politica','SELECT')
)::text
UNION ALL
SELECT '04_EXISTING', jsonb_build_object(
  'total',(SELECT count(*) FROM public.notificaciones_email),
  'eventos_marcados_politica',(SELECT count(*) FROM public.notificaciones_email n WHERE n.datos ? 'auto_ats_version'),
  'autorizados_politica',(SELECT count(*) FROM public.notificaciones_email n
    WHERE n.datos ? 'auto_ats_version' AND n.auto_resend_autorizado)
)::text
UNION ALL
SELECT '05_GUARDS', jsonb_build_object(
  'auto_reclamo_version',pg_get_functiondef('public.talentai_reclamar_notificaciones_resend_auto(integer)'::regprocedure) LIKE '%auto_ats_version%',
  'manual_excluye_auto',pg_get_functiondef('public.talentai_reclamar_notificaciones_resend_prueba(integer)'::regprocedure) LIKE '%auto_resend_autorizado=false%',
  'terminales_requieren_aprobacion',pg_get_functiondef('public.talentai_preparar_autodespacho_evento_ats()'::regprocedure) LIKE '%NEW.aprobado_por IS NOT NULL%'
)::text
ORDER BY seccion;
