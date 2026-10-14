/*
=========================================================
TALENTAI - FASE 3A: PREFLIGHT DEL MODELO DE DATOS
SOLO LECTURA. NO MODIFICA NINGUN OBJETO NI DATO.

Objetivo:
- Detectar inconsistencias antes de agregar constraints e indices.
- Verificar FK nulas/huerfanas, duplicados, dominios de estado,
  normalizacion de correos, score ATS y configuracion de pgvector.
=========================================================
*/

WITH
row_counts AS (
  SELECT jsonb_agg(x ORDER BY x->>'table') AS data
  FROM (
    SELECT jsonb_build_object('table','usuarios','rows',count(*)) x FROM public.usuarios
    UNION ALL SELECT jsonb_build_object('table','empleados','rows',count(*)) FROM public.empleados
    UNION ALL SELECT jsonb_build_object('table','departamentos','rows',count(*)) FROM public.departamentos
    UNION ALL SELECT jsonb_build_object('table','roles','rows',count(*)) FROM public.roles
    UNION ALL SELECT jsonb_build_object('table','vacantes','rows',count(*)) FROM public.vacantes
    UNION ALL SELECT jsonb_build_object('table','candidatos','rows',count(*)) FROM public.candidatos
    UNION ALL SELECT jsonb_build_object('table','aplicaciones_ats','rows',count(*)) FROM public.aplicaciones_ats
    UNION ALL SELECT jsonb_build_object('table','base_conocimiento','rows',count(*)) FROM public.base_conocimiento
    UNION ALL SELECT jsonb_build_object('table','bitacora_auditoria','rows',count(*)) FROM public.bitacora_auditoria
    UNION ALL SELECT jsonb_build_object('table','logs_interaccion_ia','rows',count(*)) FROM public.logs_interaccion_ia
    UNION ALL SELECT jsonb_build_object('table','solicitudes_rrhh','rows',count(*)) FROM public.solicitudes_rrhh
  ) q
),

fk_health AS (
  SELECT jsonb_agg(x ORDER BY x->>'relationship') AS data
  FROM (
    SELECT jsonb_build_object(
      'relationship','aplicaciones_ats.id_candidato -> candidatos',
      'null_fk',count(*) FILTER (WHERE a.id_candidato IS NULL),
      'orphan_fk',count(*) FILTER (WHERE a.id_candidato IS NOT NULL AND c.id_candidato IS NULL)
    ) x
    FROM public.aplicaciones_ats a
    LEFT JOIN public.candidatos c ON c.id_candidato = a.id_candidato

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','aplicaciones_ats.id_vacante -> vacantes',
      'null_fk',count(*) FILTER (WHERE a.id_vacante IS NULL),
      'orphan_fk',count(*) FILTER (WHERE a.id_vacante IS NOT NULL AND v.id_vacante IS NULL)
    )
    FROM public.aplicaciones_ats a
    LEFT JOIN public.vacantes v ON v.id_vacante = a.id_vacante

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','empleados.id_departamento -> departamentos',
      'null_fk',count(*) FILTER (WHERE e.id_departamento IS NULL),
      'orphan_fk',count(*) FILTER (WHERE e.id_departamento IS NOT NULL AND d.id_departamento IS NULL)
    )
    FROM public.empleados e
    LEFT JOIN public.departamentos d ON d.id_departamento = e.id_departamento

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','empleados.id_rol -> roles',
      'null_fk',count(*) FILTER (WHERE e.id_rol IS NULL),
      'orphan_fk',count(*) FILTER (WHERE e.id_rol IS NOT NULL AND r.id_rol IS NULL)
    )
    FROM public.empleados e
    LEFT JOIN public.roles r ON r.id_rol = e.id_rol

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','vacantes.id_departamento -> departamentos',
      'null_fk',count(*) FILTER (WHERE v.id_departamento IS NULL),
      'orphan_fk',count(*) FILTER (WHERE v.id_departamento IS NOT NULL AND d.id_departamento IS NULL)
    )
    FROM public.vacantes v
    LEFT JOIN public.departamentos d ON d.id_departamento = v.id_departamento

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','bitacora_auditoria.id_usuario -> usuarios',
      'null_fk',count(*) FILTER (WHERE b.id_usuario IS NULL),
      'orphan_fk',count(*) FILTER (WHERE b.id_usuario IS NOT NULL AND u.id IS NULL)
    )
    FROM public.bitacora_auditoria b
    LEFT JOIN public.usuarios u ON u.id = b.id_usuario

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','logs_interaccion_ia.id_empleado -> empleados',
      'null_fk',count(*) FILTER (WHERE l.id_empleado IS NULL),
      'orphan_fk',count(*) FILTER (WHERE l.id_empleado IS NOT NULL AND e.id_empleado IS NULL)
    )
    FROM public.logs_interaccion_ia l
    LEFT JOIN public.empleados e ON e.id_empleado = l.id_empleado

    UNION ALL
    SELECT jsonb_build_object(
      'relationship','solicitudes_rrhh.id_empleado -> empleados',
      'null_fk',count(*) FILTER (WHERE s.id_empleado IS NULL),
      'orphan_fk',count(*) FILTER (WHERE s.id_empleado IS NOT NULL AND e.id_empleado IS NULL)
    )
    FROM public.solicitudes_rrhh s
    LEFT JOIN public.empleados e ON e.id_empleado = s.id_empleado
  ) q
),

email_health AS (
  SELECT jsonb_build_object(
    'usuarios_case_insensitive_duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', email_norm, 'count', n))
      FROM (
        SELECT lower(trim(email)) email_norm, count(*) n
        FROM public.usuarios
        GROUP BY lower(trim(email))
        HAVING count(*) > 1
      ) d
    ), '[]'::jsonb),
    'empleados_case_insensitive_duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', email_norm, 'count', n))
      FROM (
        SELECT lower(trim(correo)) email_norm, count(*) n
        FROM public.empleados
        GROUP BY lower(trim(correo))
        HAVING count(*) > 1
      ) d
    ), '[]'::jsonb),
    'candidatos_case_insensitive_duplicates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('email', email_norm, 'count', n))
      FROM (
        SELECT lower(trim(correo)) email_norm, count(*) n
        FROM public.candidatos
        GROUP BY lower(trim(correo))
        HAVING count(*) > 1
      ) d
    ), '[]'::jsonb),
    'usuarios_not_normalized', (SELECT count(*) FROM public.usuarios WHERE email <> lower(trim(email))),
    'empleados_not_normalized', (SELECT count(*) FROM public.empleados WHERE correo <> lower(trim(correo))),
    'candidatos_not_normalized', (SELECT count(*) FROM public.candidatos WHERE correo <> lower(trim(correo)))
  ) AS data
),

catalog_duplicates AS (
  SELECT jsonb_build_object(
    'departamentos_duplicate_names', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nombre', nombre_norm, 'count', n))
      FROM (
        SELECT lower(trim(nombre)) nombre_norm, count(*) n
        FROM public.departamentos
        GROUP BY lower(trim(nombre))
        HAVING count(*) > 1
      ) d
    ), '[]'::jsonb),
    'roles_duplicate_names', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('nombre', nombre_norm, 'count', n))
      FROM (
        SELECT lower(trim(nombre_rol)) nombre_norm, count(*) n
        FROM public.roles
        GROUP BY lower(trim(nombre_rol))
        HAVING count(*) > 1
      ) d
    ), '[]'::jsonb)
  ) AS data
),

application_duplicates AS (
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'id_candidato', id_candidato,
      'id_vacante', id_vacante,
      'count', n
    ) ORDER BY n DESC),
    '[]'::jsonb
  ) AS data
  FROM (
    SELECT id_candidato, id_vacante, count(*) n
    FROM public.aplicaciones_ats
    WHERE id_candidato IS NOT NULL AND id_vacante IS NOT NULL
    GROUP BY id_candidato, id_vacante
    HAVING count(*) > 1
  ) d
),

domain_values AS (
  SELECT jsonb_build_object(
    'usuarios.rol', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', rol, 'count', n) ORDER BY rol)
      FROM (SELECT rol, count(*) n FROM public.usuarios GROUP BY rol) s
    ), '[]'::jsonb),
    'empleados.estado', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', estado, 'count', n) ORDER BY estado)
      FROM (SELECT estado, count(*) n FROM public.empleados GROUP BY estado) s
    ), '[]'::jsonb),
    'vacantes.estado', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', estado, 'count', n) ORDER BY estado)
      FROM (SELECT estado, count(*) n FROM public.vacantes GROUP BY estado) s
    ), '[]'::jsonb),
    'aplicaciones_ats.estado_proceso', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', estado_proceso, 'count', n) ORDER BY estado_proceso)
      FROM (SELECT estado_proceso, count(*) n FROM public.aplicaciones_ats GROUP BY estado_proceso) s
    ), '[]'::jsonb),
    'solicitudes_rrhh.estado', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', estado, 'count', n) ORDER BY estado)
      FROM (SELECT estado, count(*) n FROM public.solicitudes_rrhh GROUP BY estado) s
    ), '[]'::jsonb),
    'roles.nivel_permiso', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', nivel_permiso, 'count', n) ORDER BY nivel_permiso)
      FROM (SELECT nivel_permiso, count(*) n FROM public.roles GROUP BY nivel_permiso) s
    ), '[]'::jsonb)
  ) AS data
),

ats_score_health AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'null_score', count(*) FILTER (WHERE ai_match_score IS NULL),
    'below_zero', count(*) FILTER (WHERE ai_match_score < 0),
    'above_100', count(*) FILTER (WHERE ai_match_score > 100),
    'non_integer_numeric', count(*) FILTER (WHERE ai_match_score IS NOT NULL AND ai_match_score <> trunc(ai_match_score)),
    'min', min(ai_match_score),
    'max', max(ai_match_score)
  ) AS data
  FROM public.aplicaciones_ats
),

business_nulls AS (
  SELECT jsonb_build_object(
    'aplicaciones_without_candidate', (SELECT count(*) FROM public.aplicaciones_ats WHERE id_candidato IS NULL),
    'aplicaciones_without_vacancy', (SELECT count(*) FROM public.aplicaciones_ats WHERE id_vacante IS NULL),
    'vacantes_without_department', (SELECT count(*) FROM public.vacantes WHERE id_departamento IS NULL),
    'empleados_without_department', (SELECT count(*) FROM public.empleados WHERE id_departamento IS NULL),
    'empleados_without_role', (SELECT count(*) FROM public.empleados WHERE id_rol IS NULL),
    'knowledge_without_file', (SELECT count(*) FROM public.base_conocimiento WHERE url_archivo IS NULL OR trim(url_archivo) = ''),
    'knowledge_without_embedding', (SELECT count(*) FROM public.base_conocimiento WHERE vector_embedding IS NULL)
  ) AS data
),

vector_definition AS (
  SELECT jsonb_build_object(
    'column_type', format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull
  ) AS data
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'base_conocimiento'
    AND a.attname = 'vector_embedding'
    AND a.attnum > 0
    AND NOT a.attisdropped
),

fk_definitions AS (
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'table', c.relname,
      'constraint', con.conname,
      'definition', pg_get_constraintdef(con.oid, true)
    ) ORDER BY c.relname, con.conname),
    '[]'::jsonb
  ) AS data
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND con.contype = 'f'
),

existing_indexes AS (
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'table', tablename,
      'index', indexname,
      'definition', indexdef
    ) ORDER BY tablename, indexname),
    '[]'::jsonb
  ) AS data
  FROM pg_indexes
  WHERE schemaname = 'public'
)

SELECT '01_ROW_COUNTS' AS section, data FROM row_counts
UNION ALL SELECT '02_FK_HEALTH', data FROM fk_health
UNION ALL SELECT '03_EMAIL_HEALTH', data FROM email_health
UNION ALL SELECT '04_CATALOG_DUPLICATES', data FROM catalog_duplicates
UNION ALL SELECT '05_DUPLICATE_APPLICATIONS', data FROM application_duplicates
UNION ALL SELECT '06_DOMAIN_VALUES', data FROM domain_values
UNION ALL SELECT '07_ATS_SCORE_HEALTH', data FROM ats_score_health
UNION ALL SELECT '08_BUSINESS_NULLS', data FROM business_nulls
UNION ALL SELECT '09_VECTOR_DEFINITION', data FROM vector_definition
UNION ALL SELECT '10_FK_DEFINITIONS', data FROM fk_definitions
UNION ALL SELECT '11_EXISTING_INDEXES', data FROM existing_indexes
ORDER BY section;
