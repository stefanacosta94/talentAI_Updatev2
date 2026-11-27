-- Verificación posterior a Fase 18 (solo lectura).
SELECT estado, count(*) AS tareas FROM public.ats_evaluaciones_ia GROUP BY estado ORDER BY estado;
SELECT count(*) AS aplicaciones_sin_puntaje FROM public.aplicaciones_ats WHERE ai_match_score IS NULL;
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.aplicaciones_ats'::regclass AND tgname = 'trg_ats_encolar_evaluacion_ia';
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('ats_tomar_evaluacion','ats_finalizar_evaluacion','ats_encolar_evaluacion_ia');
